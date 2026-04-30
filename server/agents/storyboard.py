"""Storyboard Agent.

Generates shot list + Jimeng prompts + storyboard reference image prompts.
Persists Shot rows in DB and creates draft ShotAsset entries:
  - storyboard_prompt (text)
  - storyboard_image (placeholder; M3 lets user replace)
  - jimeng_video_prompt (text, for manual Jimeng)

Pilot contract (docs/documentary-pilot.md):
  Each project produces SHOT_COUNT = 5 core shots covering 5 standard
  shot types: establishing / craft_close / material_close / silhouette /
  imagery. With 3 heritage topics this yields 15 prompts total.

Fallback (no LLM key) honours the same contract — see _fallback_shots.
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
from server.utils.json_extract import extract_json_payload


SHOT_COUNT = 5
CORE_SHOT_TYPES = ("establishing", "craft_close", "material_close", "silhouette", "imagery")


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

        brief = (
            agent_input.payload.get("brief")
            or agent_input.upstream.get("brief", "")
            or ""
        )
        emitter.progress(
            f"基于 {len(script)} 场剧本拆 {SHOT_COUNT} 个核心镜头", visibility="detail"
        )
        prompt = (
            sb_prompt
            + "\n\n## 剧本\n"
            + json.dumps(script, ensure_ascii=False, indent=2)[:6000]
            + "\n\n## 旁白\n"
            + json.dumps(narration, ensure_ascii=False)[:2000]
            + f"\n\n输出 {SHOT_COUNT} 条核心镜头分镜表(每种 shot_type 各 1: "
            + ", ".join(CORE_SHOT_TYPES)
            + "),JSON 数组。"
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
            shots = _fallback_shots(brief, fact_cards, script, narration)
        shots = shots[:SHOT_COUNT]

        # Generate Jimeng video prompts per shot (skip portrait_interview / ritual_real).
        for idx, shot in enumerate(shots, start=1):
            _normalize_model_shot(shot, idx, fact_cards)
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
    return extract_json_payload(text)


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


_TRUE_VALUES = {"true", "1", "yes", "y", "是", "对", "需要", "required"}
_REAL_ONLY_FACT_PHRASES = (
    "真实拍摄范畴",
    "不能用AI合成替代",
    "不能用 AI 合成替代",
    "必须真拍",
    "不生成 AI 视频",
    "不生成AI视频",
    "人工拍摄",
    "授权素材",
)


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in _TRUE_VALUES
    return bool(value)


def _normalize_model_shot(shot: dict[str, Any], idx: int, fact_cards: list[dict[str, Any]]) -> None:
    """Normalize model-authored shot fields before prompt generation.

    Real models often follow "shot_id: leave blank" literally and may return
    string booleans. They can also reference FactCards that explicitly say a
    subject must be real footage. Normalize those cases before persistence.
    """
    if not shot.get("sequence"):
        shot["sequence"] = idx
    if not shot.get("shot_id"):
        shot["shot_id"] = new_id("shot")
    requests_real = _shot_requests_real_footage(shot)
    shot["requires_real_footage"] = bool(
        requests_real
        and (_coerce_bool(shot.get("requires_real_footage")) or _references_real_only_fact(shot, fact_cards))
    )


def _references_real_only_fact(shot: dict[str, Any], fact_cards: list[dict[str, Any]]) -> bool:
    refs = set(shot.get("fact_refs") or [])
    if not refs:
        return False
    fact_map = {fc.get("fact_id"): fc for fc in fact_cards}
    for ref in refs:
        content = str((fact_map.get(ref) or {}).get("content", ""))
        if any(phrase in content for phrase in _REAL_ONLY_FACT_PHRASES):
            return True
    return False


_REAL_REQUEST_PHRASES = (
    "采访",
    "口述",
    "实录",
    "真实演出",
    "现场演出",
    "真实仪式",
    "授权档案",
    "真实档案",
)


def _shot_requests_real_footage(shot: dict[str, Any]) -> bool:
    text = " ".join(
        str(shot.get(k, ""))
        for k in ("shot_type", "subject", "composition", "camera_motion", "lighting")
    )
    return any(phrase in text for phrase in _REAL_REQUEST_PHRASES)


_TYPE_TIPS = {
    "establishing": "去掉人/手部描述,强化环境氛围",
    "craft_close": "特写镜头,主体居中,景深浅,聚焦工具与手部局部",
    "material_close": "微距镜头,纹理清晰,自然光从侧面打入",
    "silhouette": "逆光剪影,人物只见轮廓,不展示面部",
    "imagery": "象征性意象,不声称真实记录",
}


def _extract_template_skeleton(template: str) -> str:
    """Pull out the first ```text fenced block; ignore markdown around it."""
    match = re.search(r"```text\s*\n([\s\S]*?)```", template)
    if match:
        return match.group(1).strip()
    return template.strip()


def _build_jimeng_prompt(template: str, shot: dict[str, Any], fact_cards: list[dict[str, Any]]) -> str:
    skeleton = _extract_template_skeleton(template)
    body = skeleton.replace("【非遗项目】", shot.get("topic") or "非遗")
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
    # collapse runs of blank lines so the copy-paste payload stays tight
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip() + extra


def _build_image_prompt(shot: dict[str, Any]) -> str:
    return (
        f"纪录片分镜参考图,{shot.get('shot_type','')}, 主体: {shot.get('subject','')}; "
        f"构图: {shot.get('composition','')}; 光线: {shot.get('lighting','')}; "
        "真实材质,低饱和,自然光,人物可为非特定 AI 生成角色,不得冒充真实传承人。"
    )


# --- topic detection + per-shot-type templates ---

_TOPIC_PROFILES: list[dict[str, Any]] = [
    {
        "id": "porcelain",
        "label": "瓷器",
        "keywords": ("瓷", "窑", "拉坯", "修坯", "釉", "青花", "陶轮", "瓷土", "高岭"),
        "tools": ("修坯刀", "毛笔", "陶轮"),
        "materials": ("瓷土", "釉料", "钴蓝料"),
        "establishing_subject": "清晨老作坊外景,旧砖墙、木架、陶轮与窑口烟气",
        "craft_close_subject": "工匠双手在陶轮上拉坯,湿润瓷泥在指间成形,泥水与细微颤动可见",
        "material_close_subject": "桌面瓷土与釉料颗粒的微距,粉尘飘落,纹理粗糙真实",
        "silhouette_subject": "工坊逆光中工匠半身剪影,只见双手与轮转动作",
        "imagery_subject": "窑口火光与烟气意象,器物轮廓在余烬中若隐若现",
    },
    {
        "id": "embroidery",
        "label": "刺绣",
        "keywords": ("绣", "丝线", "针脚", "绷架", "苏绣", "湘绣", "绸缎", "纹样"),
        "tools": ("绣针", "绷架", "剪刀"),
        "materials": ("丝线", "绸缎", "底料"),
        "establishing_subject": "窗边老绣坊空镜,布面、线轴、木绷架与旧剪刀静置",
        "craft_close_subject": "绣针穿过绸缎,丝线反光,手部动作缓慢,针脚细密",
        "material_close_subject": "不同色阶的丝线被手指分开,纤维与光泽的微距细节",
        "silhouette_subject": "绣娘坐姿背影,头微低,只见双手与肩部轮廓",
        "imagery_subject": "花鸟纹样在针脚中逐渐显现,克制的纹样动效意象",
    },
    {
        "id": "opera",
        "label": "戏曲",
        "keywords": ("戏", "脸谱", "变脸", "戏服", "唱腔", "锣鼓", "戏台", "演员"),
        "tools": ("画笔", "脸谱"),
        "materials": ("脸谱", "戏服", "丝线"),
        "establishing_subject": "戏台后台空镜,旧木桌、脸谱、戏服与暖色镜灯",
        "craft_close_subject": "画笔在脸谱纸样上落色,色块层叠,不出现真人脸部",
        "material_close_subject": "戏服刺绣、布料与肩甲在指间翻动的纹理特写",
        "silhouette_subject": "舞台侧光中的非特定演员剪影或侧脸,甩袖瞬间,不冒充真实演出记录",
        "imagery_subject": "面具、袖口、灯光快速切换的象征性意象,不声称真实演出",
        # opera materials commonly include real performances / interviews —
        # mark silhouette as needing real footage when brief implies live.
        "real_footage_signals": ("真实演出", "现场演出", "采访", "口述史", "口述", "实录", "授权档案"),
    },
    {
        "id": "generic",
        "label": "非遗",
        "keywords": (),
        "tools": (),
        "materials": (),
        "establishing_subject": "传统工坊外景空镜,自然光,旧木结构与工具静置",
        "craft_close_subject": "工匠手部在工具上的特写动作,材料表面纹理可见",
        "material_close_subject": "原料与工具的微距,真实材质与磨损细节",
        "silhouette_subject": "逆光剪影,人物只见轮廓,不展示面部",
        "imagery_subject": "材料、光线与时间感构成的意象镜头,不冒充真实档案",
    },
]


def _detect_profile(brief: str, fact_cards: list[dict[str, Any]]) -> dict[str, Any]:
    haystack = brief + " " + " ".join(fc.get("content", "") for fc in (fact_cards or [])[:30])
    best = _TOPIC_PROFILES[-1]  # generic default
    best_score = 0
    for prof in _TOPIC_PROFILES[:-1]:
        score = sum(haystack.count(k) for k in prof["keywords"])
        if score > best_score:
            best_score = score
            best = prof
    return best


_REAL_FOOTAGE_SIGNALS_GLOBAL = (
    "真实传承人正脸",
    "具体传承人肖像",
    "传承人采访",
    "传承人口述",
    "口述史",
    "现场演出",
    "真实演出",
    "实录",
    "授权档案",
)


def _needs_real_footage(profile: dict[str, Any], shot_type: str, brief: str, haystack: str) -> bool:
    """A specific (profile × shot_type) requires real footage when the
    user brief mentions live/portrait/interview signals.

    Only the silhouette slot converts. Rationale (per docs/documentary-pilot.md):
    - establishing / craft_close / material_close are explicitly AI-friendly
      and must stay AI to keep the pilot quota meaningful (we cannot validate
      AI's value if every shot is real).
    - imagery is symbolic/abstract and should never be misread as a real
      record, so it stays AI by design.
    - silhouette is the only category that overlaps human likeness, so when
      the brief signals real performers/interviews we promote it to a
      portrait_interview shot the user must capture in person. FactCards may
      contain cautionary boundary notes, so they should not convert a generic
      AI-friendly silhouette on their own.
    """
    signals = list(profile.get("real_footage_signals", ())) + list(_REAL_FOOTAGE_SIGNALS_GLOBAL)
    if not any(s in brief for s in signals):
        return False
    return shot_type == "silhouette"


def _pick_fact_refs(profile: dict[str, Any], shot_type: str, fact_cards: list[dict[str, Any]]) -> list[str]:
    """Choose up to 2 fact_card IDs whose content best matches the shot type."""
    if not fact_cards:
        return []
    if shot_type not in {"portrait_interview", "ritual_real"}:
        fact_cards = [
            fc
            for fc in fact_cards
            if not any(phrase in str(fc.get("content", "")) for phrase in _REAL_ONLY_FACT_PHRASES)
        ]
        if not fact_cards:
            return []
    priorities = {
        "craft_close": ("craft_step",),
        "material_close": ("material", "tool"),
        "establishing": ("location", "history"),
        "silhouette": ("persona", "history"),
        "imagery": ("folklore", "history"),
    }.get(shot_type, ())
    by_priority = [
        fc for fc in fact_cards if fc.get("category") in priorities and fc.get("fact_id")
    ]
    if not by_priority:
        # fall back to keyword match against profile materials/tools
        keywords = tuple(profile.get("tools", ())) + tuple(profile.get("materials", ()))
        by_priority = [
            fc for fc in fact_cards
            if fc.get("fact_id") and any(k in (fc.get("content") or "") for k in keywords)
        ]
    if not by_priority:
        by_priority = [fc for fc in fact_cards if fc.get("fact_id")][:2]
    return [fc["fact_id"] for fc in by_priority[:2] if fc.get("fact_id")]


def _fallback_shots(
    brief: str,
    fact_cards: list[dict[str, Any]],
    script: list[dict[str, Any]] | None = None,
    narration: list[dict[str, Any]] | None = None,
):
    """Produce SHOT_COUNT core shots covering the 5 canonical shot types.

    Subject/composition/camera/lighting come from a topic-aware template
    (porcelain / embroidery / opera / generic), NOT from raw FactCard
    sentences. FactCards are referenced via shot.fact_refs so the prompt
    builder can splice the relevant craft step into the Jimeng prompt
    without leaking metadata.
    """
    profile = _detect_profile(brief or "", fact_cards or [])
    haystack = (brief or "") + " " + " ".join(
        fc.get("content", "") for fc in (fact_cards or [])[:30]
    )
    topic_label = profile.get("label", "非遗")
    narration_seq = {n.get("shot_seq"): n for n in (narration or []) if isinstance(n, dict)}

    shots: list[dict[str, Any]] = []
    for idx, t in enumerate(CORE_SHOT_TYPES, start=1):
        subject = profile.get(f"{t}_subject", "")
        camera = (
            "缓慢推近" if t == "establishing"
            else "缓慢平移" if t == "imagery"
            else "固定机位"
        )
        lighting = "自然光" if t != "imagery" else "自然光配合微弱火光"
        composition = {
            "establishing": "中远景,前景留白",
            "craft_close": "特写,主体居中,景深浅",
            "material_close": "微距,光线从侧面打入",
            "silhouette": "中景,逆光,主体居中",
            "imagery": "中近景,主体偏左,留呼吸空间",
        }.get(t, "中景")
        real = _needs_real_footage(profile, t, brief or "", haystack)
        if real and t == "silhouette":
            # convert the slot semantically — the shot now stages a real-footage
            # portrait/interview, so its subject should reflect that.
            subject = f"传承人采访或现场演出实录(必须真拍,不生成 AI 视频)"
            composition = "中景,自然光下的正脸或现场"
            camera = "固定机位,长焦"
            lighting = "现场光"
        shots.append(
            {
                "shot_id": new_id("shot"),
                "scene_id": (script[0].get("scene_id") if script else None) or "scene_1",
                "sequence": idx,
                "shot_type": t if not real else "portrait_interview",
                "subject": subject,
                "composition": composition,
                "camera_motion": camera,
                "lighting": lighting,
                "duration_estimate": 5.0 if t != "establishing" else 7.0,
                "narration_ref": narration_seq.get(idx, {}).get("shot_seq") if narration_seq else None,
                "requires_real_footage": bool(real),
                "fact_refs": _pick_fact_refs(profile, t, fact_cards or []),
                "topic": topic_label,
            }
        )
    return shots


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
