"""Storyboard Agent.

Generates shot list + Jimeng prompts + storyboard reference image prompts.
Persists Shot rows in DB and creates draft ShotAsset entries:
  - storyboard_prompt (text)
  - storyboard_image (placeholder; M3 lets user replace)
  - jimeng_video_prompt (text, for manual Jimeng)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from server.agents.base import AgentInput, AgentOutput, BaseAgent, Plan, PlannedSubstep
from server.data.models import Shot, ShotAsset
from server.data.session import session_scope
from server.engine.config_loader import load_direction
from server.engine.events import StepEmitter
from server.engine.router import ModelRouter
from server.utils.ids import new_id


class StoryboardAgent(BaseAgent):
    name = "storyboard"
    version = "0.2.0"

    def __init__(self, router: ModelRouter | None = None, direction: str = "documentary") -> None:
        self.router = router or ModelRouter.from_settings()
        self.direction = direction

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(
            substeps=[
                PlannedSubstep(name="generate_shots", description="生成分镜表"),
                PlannedSubstep(name="jimeng_prompts", description="生成即梦提示词"),
                PlannedSubstep(name="image_prompts", description="生成分镜参考图提示词"),
                PlannedSubstep(name="culture_review", description="语气复核"),
                PlannedSubstep(name="persist", description="落库 Shot + ShotAsset"),
            ]
        )

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:
        cfg = load_direction(self.direction)
        sb_prompt = cfg.prompts.get("storyboard", "")
        shot_tpl = cfg.prompts.get("shot_prompt", "")

        writer = agent_input.upstream.get("writer") or {}
        research = agent_input.upstream.get("research") or {}
        script = writer.get("script", [])
        narration = writer.get("narration", [])
        fact_cards = research.get("fact_cards", [])

        if not script:
            emitter.warning("没有剧本输入,生成空分镜")
            emitter.finish("no script")
            return AgentOutput(summary="no script", data={"shots": []})

        emitter.progress(f"基于 {len(script)} 场剧本拆 15 个镜头", visibility="detail")
        prompt = (
            sb_prompt
            + "\n\n## 剧本\n"
            + json.dumps(script, ensure_ascii=False, indent=2)[:6000]
            + "\n\n## 旁白\n"
            + json.dumps(narration, ensure_ascii=False)[:2000]
            + f"\n\n输出 15 条镜头分镜表,JSON 数组。"
        )

        emitter.tool_call("model.structure.shot_list", "")
        result = self.router.call(
            "structure",
            prompt,
            context={"system": "你是纪录片摄影指导,克制写实,严格 JSON 输出"},
            step_id=emitter.step_id,
        )
        emitter.tool_result("model.structure.shot_list", f"len={len(result.text)}")

        shots = _parse_shots(result.text)
        if not shots:
            emitter.progress("模型未返回结构化分镜,触发本地兜底", visibility="detail")
            shots = _fallback_shots(script, narration, fact_cards)
        shots = shots[:15]

        # Generate Jimeng video prompts per shot (skip portrait_interview / ritual_real).
        for idx, shot in enumerate(shots, start=1):
            shot.setdefault("sequence", idx)
            shot.setdefault("shot_id", new_id("shot"))
            if shot.get("requires_real_footage"):
                shot["jimeng_prompt"] = ""
                shot["image_prompt"] = ""
                continue
            shot["jimeng_prompt"] = _build_jimeng_prompt(shot_tpl, shot, fact_cards)
            shot["image_prompt"] = _build_image_prompt(shot)

        # Tone review.
        review_prompt = (
            "审核以下即梦提示词与镜头描述是否广告化、是否触及红线规则,JSON 输出: "
            "[{shot_id, issue, severity}]\n\n"
            + json.dumps(shots, ensure_ascii=False)[:6000]
        )
        emitter.tool_call("model.writing.tone_review", "")
        review = self.router.call("writing", review_prompt, step_id=emitter.step_id)
        emitter.tool_result("model.writing.tone_review", f"len={len(review.text)}")
        issues = _parse_issues(review.text)
        for issue in issues:
            if issue.get("severity") == "error":
                emitter.warning(f"{issue.get('shot_id','?')}: {issue.get('issue','')}")

        # Persist.
        ids = _persist_shots(agent_input.project_id, shots)
        emitter.artifact("shots", f"shots:{len(ids['shot_ids'])}", summary=f"{len(ids['shot_ids'])} 个镜头")
        emitter.artifact(
            "jimeng_prompts",
            f"prompts:{ids['jimeng_count']}",
            summary=f"{ids['jimeng_count']} 条即梦提示词",
        )
        emitter.finish(
            f"生成 {len(ids['shot_ids'])} 镜头, 即梦提示词 {ids['jimeng_count']} 条 (跳过 {ids['real_count']} 真拍镜头)"
        )

        return AgentOutput(
            summary=f"{len(ids['shot_ids'])} 镜头, 即梦提示词 {ids['jimeng_count']} 条",
            artifacts=[
                {"kind": "shots", "ref": "shots"},
                {"kind": "jimeng_prompts", "ref": "jimeng_prompts"},
            ],
            data={
                "shots": shots,
                "shot_ids": ids["shot_ids"],
                "jimeng_count": ids["jimeng_count"],
                "real_count": ids["real_count"],
            },
            warnings=[i.get("issue", "") for i in issues if i.get("severity") in {"warning", "error"}],
        )


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def _parse_shots(text: str) -> list[dict[str, Any]]:
    body = _strip_json_fence(text)
    try:
        data = json.loads(body)
    except Exception:
        return []
    if isinstance(data, list):
        return [s for s in data if isinstance(s, dict)]
    if isinstance(data, dict) and isinstance(data.get("shots"), list):
        return [s for s in data["shots"] if isinstance(s, dict)]
    return []


def _parse_issues(text: str) -> list[dict[str, Any]]:
    body = _strip_json_fence(text)
    try:
        data = json.loads(body)
    except Exception:
        return []
    if isinstance(data, list):
        return [i for i in data if isinstance(i, dict)]
    if isinstance(data, dict) and isinstance(data.get("issues"), list):
        return data["issues"]
    return []


_TYPE_TIPS = {
    "establishing": "去掉人/手部描述,强化环境氛围",
    "craft_close": "特写镜头,主体居中,景深浅,聚焦工具与手部局部",
    "material_close": "微距镜头,纹理清晰,自然光从侧面打入",
    "silhouette": "逆光剪影,人物只见轮廓,不展示面部",
    "imagery": "象征性意象,不声称真实记录",
}


def _build_jimeng_prompt(template: str, shot: dict[str, Any], fact_cards: list[dict[str, Any]]) -> str:
    body = template.replace("【非遗项目】", shot.get("topic") or "非遗")
    body = body.replace("【shot.subject】", shot.get("subject", ""))
    body = body.replace("【shot.composition】", shot.get("composition", ""))
    body = body.replace("【shot.lighting】", shot.get("lighting", ""))
    body = body.replace("【shot.camera_motion】", shot.get("camera_motion", ""))
    fact_text = ""
    refs = shot.get("fact_refs") or []
    if refs:
        fact_map = {fc.get("fact_id"): fc for fc in fact_cards}
        cited = [fact_map[r]["content"] for r in refs if r in fact_map]
        if cited:
            fact_text = "\n工艺细节(必须复述,不演绎):" + "; ".join(cited)
    type_tip = _TYPE_TIPS.get(shot.get("shot_type", ""), "")
    extra = f"\n类型要点:{type_tip}" if type_tip else ""
    body = body.replace("【FactCard 引用的工艺细节,必须直接复述,不演绎】", fact_text or "")
    return body.strip() + extra


def _build_image_prompt(shot: dict[str, Any]) -> str:
    return (
        f"纪录片分镜参考图,{shot.get('shot_type','')}, 主体: {shot.get('subject','')}; "
        f"构图: {shot.get('composition','')}; 光线: {shot.get('lighting','')}; "
        "真实材质,低饱和,自然光,无 AI 合成感人脸。"
    )


def _fallback_shots(script: list[dict[str, Any]], narration: list[dict[str, Any]], fact_cards: list[dict[str, Any]]):
    types = ["establishing", "craft_close", "material_close", "silhouette", "imagery"]
    shots: list[dict[str, Any]] = []
    seq = 0
    nar_idx = 0
    for scene in script[:5]:
        for j in range(3):
            seq += 1
            t = types[(seq - 1) % len(types)]
            beats = scene.get("beats") or []
            beat = beats[j % max(1, len(beats))] if beats else {}
            shot = {
                "shot_id": new_id("shot"),
                "scene_id": scene.get("scene_id"),
                "sequence": seq,
                "shot_type": t,
                "subject": (beat.get("description") if isinstance(beat, dict) else "") or "工坊场景",
                "composition": "中近景,主体偏左",
                "camera_motion": "缓慢推近" if t == "establishing" else "固定机位",
                "lighting": "自然光",
                "duration_estimate": 5.0,
                "narration_ref": narration[nar_idx].get("shot_seq") if nar_idx < len(narration) else None,
                "requires_real_footage": False,
                "fact_refs": (beat.get("fact_refs") if isinstance(beat, dict) else None) or [],
                "topic": "非遗",
            }
            shots.append(shot)
            nar_idx += 1
            if seq >= 15:
                break
        if seq >= 15:
            break
    while len(shots) < 15 and fact_cards:
        seq += 1
        fc = fact_cards[(seq - 1) % len(fact_cards)]
        shots.append(
            {
                "shot_id": new_id("shot"),
                "scene_id": "scene_x",
                "sequence": seq,
                "shot_type": types[(seq - 1) % len(types)],
                "subject": fc.get("content", "")[:60],
                "composition": "中景",
                "camera_motion": "固定机位",
                "lighting": "自然光",
                "duration_estimate": 5.0,
                "requires_real_footage": False,
                "fact_refs": [fc.get("fact_id")],
                "topic": "非遗",
            }
        )
    return shots[:15]


def _persist_shots(project_id: str, shots: list[dict[str, Any]]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    shot_ids: list[str] = []
    jimeng_count = 0
    real_count = 0
    with session_scope() as session:
        for shot in shots:
            shot_id = shot["shot_id"]
            session.add(
                Shot(
                    id=shot_id,
                    project_id=project_id,
                    scene_id=shot.get("scene_id"),
                    sequence=shot.get("sequence", 0),
                    shot_type=shot.get("shot_type", ""),
                    subject=shot.get("subject", ""),
                    composition=shot.get("composition", ""),
                    camera_motion=shot.get("camera_motion", ""),
                    lighting=shot.get("lighting", ""),
                    duration_estimate=float(shot.get("duration_estimate", 5.0)),
                    narration=str(shot.get("narration_ref", "") or ""),
                    requires_real_footage=bool(shot.get("requires_real_footage", False)),
                    fact_refs=list(shot.get("fact_refs") or []),
                    created_at=now,
                )
            )
            shot_ids.append(shot_id)

            if shot.get("requires_real_footage"):
                real_count += 1
                continue

            jimeng_prompt = shot.get("jimeng_prompt", "")
            if jimeng_prompt:
                session.add(
                    ShotAsset(
                        id=new_id("sa"),
                        project_id=project_id,
                        shot_id=shot_id,
                        asset_type="jimeng_video_prompt",
                        version=1,
                        status="draft",
                        prompt=jimeng_prompt,
                        rights={
                            "source_type": "ai_generated",
                            "source_platform": "jimeng",
                            "license": "platform_tos",
                            "creator": "system",
                            "review_status": "pending",
                        },
                        meta={
                            "aspect_ratio": "16:9",
                            "duration_seconds": int(shot.get("duration_estimate", 5)),
                            "shot_type": shot.get("shot_type"),
                        },
                        created_at=now,
                        updated_at=now,
                    )
                )
                jimeng_count += 1

            image_prompt = shot.get("image_prompt", "")
            if image_prompt:
                session.add(
                    ShotAsset(
                        id=new_id("sa"),
                        project_id=project_id,
                        shot_id=shot_id,
                        asset_type="storyboard_prompt",
                        version=1,
                        status="draft",
                        prompt=image_prompt,
                        rights={
                            "source_type": "ai_generated",
                            "source_platform": "gpt_image",
                            "license": "platform_tos",
                            "creator": "system",
                            "review_status": "pending",
                        },
                        meta={"shot_type": shot.get("shot_type")},
                        created_at=now,
                        updated_at=now,
                    )
                )
    return {"shot_ids": shot_ids, "jimeng_count": jimeng_count, "real_count": real_count}
