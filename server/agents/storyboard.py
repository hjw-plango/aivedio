"""Chapter storyboard agent.

Generates a real first-chapter production board: 18 timed shots, narration,
sound notes, reference-image usage, reference-state gaps, and detailed Jimeng
prompts. The output is still copy-paste friendly for manual Jimeng use.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from server.agents.base import AgentInput, AgentOutput, BaseAgent, Plan, PlannedSubstep
from server.agents.documentary_profiles import (
    CHAPTER_ONE_SHOT_COUNT,
    CHAPTER_ONE_TARGET_SECONDS,
    detect_profile,
    duration_from_shots,
    pick_fact_refs,
    timecode,
)
from server.data.models import Shot, ShotAsset
from server.data.session import session_scope
from server.engine.config_loader import load_direction
from server.engine.events import StepEmitter
from server.engine.router import ModelRouter
from server.utils.ids import new_id
from server.utils.json_extract import extract_json_payload


class StoryboardAgent(BaseAgent):
    name = "storyboard"
    version = "1.0.0"

    def __init__(self, router: ModelRouter | None = None, direction: str = "documentary") -> None:
        self.router = router or ModelRouter.from_settings()
        self.direction = direction

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(
            substeps=[
                PlannedSubstep(name="chapter_board", description="拆第一章完整分镜"),
                PlannedSubstep(name="reference_lookup", description="匹配记忆中的参考图与状态槽"),
                PlannedSubstep(name="missing_reference_slots", description="发现缺失参考图并生成补图提示词"),
                PlannedSubstep(name="jimeng_prompts", description="生成可复制的详细即梦提示词"),
                PlannedSubstep(name="persist", description="落库 Shot + ShotAsset"),
            ]
        )

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:
        cfg = load_direction(self.direction)
        sb_prompt = cfg.prompts.get("storyboard", "")
        shot_tpl = cfg.prompts.get("shot_prompt", "")

        writer = agent_input.upstream.get("writer") or {}
        research = agent_input.upstream.get("research") or {}
        memory_step = agent_input.upstream.get("memory") or {}
        memory = memory_step.get("memory") or {}
        fact_cards = research.get("fact_cards", [])
        documentary_plan = writer.get("documentary_plan") or writer.get("plan") or {}
        first_chapter = writer.get("first_chapter") or {
            "scenes": writer.get("script", []),
            "narration": writer.get("narration", []),
            "target_duration_seconds": CHAPTER_ONE_TARGET_SECONDS,
        }
        scenes = first_chapter.get("scenes", [])
        narration = first_chapter.get("narration", [])
        brief = agent_input.payload.get("brief") or agent_input.upstream.get("brief", "")

        if not scenes:
            emitter.warning("没有第一章剧本,无法生成分镜")
            emitter.finish("no first chapter")
            return AgentOutput(summary="no first chapter", data={"shots": []})

        emitter.progress(
            f"把第一章拆为 {CHAPTER_ONE_SHOT_COUNT} 个连续镜头,目标 {CHAPTER_ONE_TARGET_SECONDS} 秒",
            visibility="detail",
        )
        prompt = (
            sb_prompt
            + "\n\n## 完整纪录片大纲\n"
            + json.dumps(documentary_plan, ensure_ascii=False, indent=2)[:6000]
            + "\n\n## 第一章\n"
            + json.dumps(first_chapter, ensure_ascii=False, indent=2)[:7000]
            + "\n\n## 项目记忆/参考图\n"
            + json.dumps(memory, ensure_ascii=False, indent=2)[:6000]
            + "\n\n## FactCard\n"
            + json.dumps(
                [{"fact_id": f.get("fact_id"), "category": f.get("category"), "content": f.get("content")} for f in fact_cards[:80]],
                ensure_ascii=False,
            )[:6000]
        )

        emitter.tool_call("model.structure.chapter_storyboard", f"prompt={len(prompt)}chars")
        result = self.router.call(
            "structure",
            prompt,
            context={
                "system": "你是纪录片导演兼分镜师。输出第一章可生产分镜 JSON,不用写安全审查。",
                "temperature": 0.45,
            },
            step_id=emitter.step_id,
        )
        emitter.tool_result("model.structure.chapter_storyboard", f"len={len(result.text)}")

        shots = _parse_shots(result.text)
        if len(shots) < 12:
            emitter.progress("模型分镜数量或结构不足,使用本地长章节分镜兜底", visibility="detail")
            shots = _fallback_chapter_shots(str(brief), fact_cards, first_chapter, memory)
        shots = shots[:CHAPTER_ONE_SHOT_COUNT]
        _normalize_timing(shots, CHAPTER_ONE_TARGET_SECONDS)

        for idx, shot in enumerate(shots, start=1):
            _normalize_model_shot(shot, idx, fact_cards)
            shot["jimeng_prompt"] = _build_jimeng_prompt(shot_tpl, shot, memory, fact_cards)
            shot["image_prompt"] = _build_image_prompt(shot, memory)
            shot["reference_manifest"] = _reference_manifest(shot, memory)

        missing_refs = _missing_reference_assets(agent_input.project_id, shots, memory)
        ids = _persist_shots(agent_input.project_id, shots, missing_refs)
        total_seconds = duration_from_shots(shots)

        emitter.artifact("shots", f"shots:{len(ids['shot_ids'])}", summary=f"{len(ids['shot_ids'])} 个镜头")
        emitter.artifact(
            "jimeng_prompts",
            f"prompts:{ids['jimeng_count']}",
            summary=f"{ids['jimeng_count']} 条即梦提示词",
        )
        if missing_refs:
            emitter.artifact(
                "missing_reference_prompts",
                f"refs:auto:{len(missing_refs)}",
                summary=f"自动补 {len(missing_refs)} 条参考图状态",
            )
        emitter.finish(f"第一章分镜完成: {len(shots)} 镜头,约 {total_seconds} 秒")

        return AgentOutput(
            summary=f"第一章 {len(shots)} 镜头,约 {total_seconds} 秒,即梦提示词 {ids['jimeng_count']} 条",
            artifacts=[
                {"kind": "shots", "ref": "shots"},
                {"kind": "jimeng_prompts", "ref": "jimeng_prompts"},
            ],
            data={
                "chapter_id": "ch_01",
                "target_duration_seconds": CHAPTER_ONE_TARGET_SECONDS,
                "shots": shots,
                "shot_ids": ids["shot_ids"],
                "jimeng_count": ids["jimeng_count"],
                "auto_reference_count": len(missing_refs),
            },
        )


def _strip_json_fence(text: str) -> str:
    return extract_json_payload(text)


def _parse_shots(text: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(_strip_json_fence(text))
    except Exception:
        return []
    if isinstance(data, dict):
        data = data.get("shots") or data.get("chapter_shots") or []
    if not isinstance(data, list):
        return []
    return [s for s in data if isinstance(s, dict)]


_TRUE_VALUES = {"true", "1", "yes", "y", "是", "对", "需要", "required"}
_REAL_ONLY_FACT_PHRASES = (
    "真实拍摄范畴",
    "不能用AI合成替代",
    "不能用 AI 合成替代",
    "必须真拍",
    "不生成 AI 视频",
    "不生成AI视频",
    "授权素材",
)
_REAL_REQUEST_PHRASES = ("采访", "口述", "实录", "真实演出", "现场演出", "授权档案", "真实档案")


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in _TRUE_VALUES
    return bool(value)


def _normalize_model_shot(shot: dict[str, Any], idx: int, fact_cards: list[dict[str, Any]]) -> None:
    """Normalize model shot fields before prompt generation.

    Kept as a public helper for existing regression tests. The new workflow
    avoids real-footage skips by default, but still respects an explicit
    real interview/archive signal when both the shot and referenced facts say so.
    """
    if not shot.get("sequence"):
        shot["sequence"] = idx
    if not shot.get("shot_id"):
        shot["shot_id"] = new_id("shot")
    refs_real = _references_real_only_fact(shot, fact_cards)
    explicit_real = _coerce_bool(shot.get("requires_real_footage"))
    text = " ".join(str(shot.get(k, "")) for k in ("shot_type", "subject", "action"))
    shot["requires_real_footage"] = bool((explicit_real or refs_real) and any(p in text for p in _REAL_REQUEST_PHRASES))
    shot.setdefault("scene_id", "ch01_sc01")
    shot.setdefault("chapter_id", "ch_01")
    shot.setdefault("duration_estimate", 10.0)
    shot.setdefault("composition", "纪录片中景,主体明确,背景保留真实环境")
    shot.setdefault("camera_motion", "固定机位或缓慢推近")
    shot.setdefault("lighting", "自然光")
    shot.setdefault("narration", "")
    shot.setdefault("sound_design", "")
    shot.setdefault("reference_ids", [])
    shot.setdefault("reference_requirements", [])
    shot.setdefault("fact_refs", [])


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


def _normalize_timing(shots: list[dict[str, Any]], target_seconds: int) -> None:
    if not shots:
        return
    cursor = 0
    default_duration = max(5, int(target_seconds / len(shots)))
    for idx, shot in enumerate(shots, start=1):
        duration = int(float(shot.get("duration_estimate", 0) or 0)) or default_duration
        if idx == len(shots):
            duration = max(5, target_seconds - cursor)
        shot["duration_estimate"] = float(duration)
        shot["timecode_start"] = shot.get("timecode_start") or timecode(cursor)
        cursor += duration
        shot["timecode_end"] = shot.get("timecode_end") or timecode(cursor)


def _fallback_chapter_shots(
    brief: str,
    fact_cards: list[dict[str, Any]],
    first_chapter: dict[str, Any],
    memory: dict[str, Any],
) -> list[dict[str, Any]]:
    profile = detect_profile(brief, fact_cards)
    narrations = first_chapter.get("narration") or []
    scenes = first_chapter.get("scenes") or []
    scene_ids = [s.get("scene_id", "ch01_sc01") for s in scenes] or ["ch01_sc01"]
    process = list(profile["process"])
    refs = {
        "person": "REF_PERSON_PRIMARY_CRAFTSPERSON",
        "env": "REF_ENV_PRIMARY_WORKSHOP",
        "tool": "REF_OBJ_PRIMARY_TOOL",
        "material": "REF_MAT_PRIMARY_MATERIAL",
        "face": "REF_PERSON_PRIMARY_CRAFTSPERSON_FACE_FOCUSED",
        "hands": "REF_PERSON_PRIMARY_CRAFTSPERSON_HANDS_WORKING",
        "morning": "REF_ENV_PRIMARY_WORKSHOP_EARLY_MORNING",
        "active_material": "REF_MAT_PRIMARY_MATERIAL_ACTIVE_STATE",
    }
    beats = [
        ("opening_environment", scene_ids[0], profile["environment"], "空无一人的工坊开场,工具和材料先出现", "中远景,前景有真实杂物,主体空间占画面三分之二", "缓慢推近", "清晨自然侧光", [refs["env"], refs["morning"]], []),
        ("detail_anchor", scene_ids[0], profile["tool"], "旧工具和桌面磨损的静物特写", "近景,工具横向摆放,背景轻微虚化", "固定机位,轻微焦点呼吸", "窗边柔光", [refs["env"], refs["tool"]], []),
        ("material_macro", scene_ids[0], profile["material"], "材料表面纹理微距,显示湿度、纤维或粉尘", "微距,主体占满画面,边缘留少量环境", "极慢横移", "低角度自然光", [refs["material"], refs["active_material"]], []),
        ("character_intro", scene_ids[1] if len(scene_ids) > 1 else scene_ids[0], profile["person"], "匿名手艺人进入画面,不开口,先整理袖口和工具", "中景,人物在画面右侧,桌面在前景", "手持轻微跟随", "自然光落在手和侧脸", [refs["person"], refs["env"], refs["face"]], [{"reference_id": refs["face"], "reason": "需要专注正脸表情"}]),
        ("hands_prepare", scene_ids[1] if len(scene_ids) > 1 else scene_ids[0], f"双手准备{profile['material']}", "手部触碰材料,材料有真实阻力", "手部特写,袖口和材料同时入画", "固定机位", "侧逆光", [refs["person"], refs["material"], refs["hands"]], [{"reference_id": refs["hands"], "reason": "需要手部工作姿态"}]),
        ("process_step", scene_ids[1] if len(scene_ids) > 1 else scene_ids[0], process[0], f"{process[0]}开始,动作不要快剪,保持真实节奏", "近景,动作方向从左到右", "缓慢推近", "自然光加轻微环境阴影", [refs["person"], refs["material"], refs["hands"]], []),
        ("sound_cutaway", scene_ids[1] if len(scene_ids) > 1 else scene_ids[0], profile["motif"], "切到产生声音的局部,为剪辑提供声画连接", "特写,声音来源在画面中心", "固定机位", "低饱和真实光", [refs["tool"], refs["material"]], []),
        ("face_observe", scene_ids[1] if len(scene_ids) > 1 else scene_ids[0], profile["person"], "人物短暂停下观察材料,脸部自然专注", "中近景,眼神看向材料而非镜头", "轻微前推", "窗光半明半暗", [refs["person"], refs["face"]], [{"reference_id": refs["face"], "reason": "需要一致的专注表情"}]),
        ("process_step", scene_ids[2] if len(scene_ids) > 2 else scene_ids[-1], process[min(1, len(process)-1)], f"进入{process[min(1, len(process)-1)]}的第一个动作", "特写,工具与材料接触点清楚", "固定机位", "自然侧光", [refs["tool"], refs["material"], refs["hands"]], []),
        ("material_change", scene_ids[2] if len(scene_ids) > 2 else scene_ids[-1], profile["material"], "材料状态发生变化,形状、光泽或纹理改变", "微距,变化前后在同一画面内可比", "极慢推近", "低角度光强调纹理", [refs["material"], refs["active_material"]], [{"reference_id": refs["active_material"], "reason": "需要材料被处理后的状态"}]),
        ("environment_cut", scene_ids[2] if len(scene_ids) > 2 else scene_ids[-1], profile["environment"], "从动作切回空间,让观众知道人物所在位置", "广角中景,人物小,环境大", "缓慢横移", "清晨到上午的连续光", [refs["env"], refs["morning"]], []),
        ("tool_close", scene_ids[2] if len(scene_ids) > 2 else scene_ids[-1], profile["tool"], "工具留下痕迹,不要夸张火花或特效", "超近景,工具边缘和材料纹理清楚", "固定机位", "自然光", [refs["tool"], refs["material"]], []),
        ("body_rhythm", scene_ids[2] if len(scene_ids) > 2 else scene_ids[-1], profile["person"], "身体随着工序形成稳定节奏,动作连贯", "半身中景,头手同画,背景不虚成纯色", "手持跟随", "现场光", [refs["person"], refs["hands"], refs["env"]], [{"reference_id": refs["hands"], "reason": "需要稳定工作姿态"}]),
        ("object_lineup", scene_ids[3] if len(scene_ids) > 3 else scene_ids[-1], "半成品与工具排列", "半成品一排形成章节中的第一次小结", "中近景,多个物件有前后层次", "缓慢平移", "自然光从侧后方扫过", [refs["env"], refs["tool"], refs["material"]], []),
        ("narrative_pause", scene_ids[3] if len(scene_ids) > 3 else scene_ids[-1], profile["motif"], "停顿镜头,给旁白一句总结留空间", "静物近景,画面有呼吸空间", "固定机位", "柔和自然光", [refs["env"], refs["material"]], []),
        ("chapter_bridge", scene_ids[3] if len(scene_ids) > 3 else scene_ids[-1], process[min(2, len(process)-1)], f"预告下一章会进入{process[min(2, len(process)-1)]}", "手和工具在画面边缘,主体是即将发生的步骤", "极慢推近", "光线稍暗", [refs["person"], refs["tool"], refs["material"]], []),
        ("wide_exit", scene_ids[3] if len(scene_ids) > 3 else scene_ids[-1], profile["environment"], "人物背影或侧身留在工坊里,空间声音继续", "中远景,门窗或桌面形成框架", "缓慢后退", "上午自然光", [refs["env"], refs["person"]], []),
        ("closing_detail", scene_ids[3] if len(scene_ids) > 3 else scene_ids[-1], profile["material"], "第一章最后停在材料和工具的接触点", "特写,画面稳定,留给下章切入", "固定机位", "低饱和自然光", [refs["material"], refs["tool"]], []),
    ]
    shots: list[dict[str, Any]] = []
    for idx, (shot_type, scene_id, subject, action, composition, camera, lighting, ref_ids, ref_reqs) in enumerate(beats, start=1):
        n = narrations[(idx - 1) % len(narrations)] if narrations else {}
        shots.append(
            {
                "shot_id": new_id("shot"),
                "chapter_id": "ch_01",
                "scene_id": scene_id,
                "sequence": idx,
                "shot_type": shot_type,
                "subject": subject,
                "action": action,
                "composition": composition,
                "camera_motion": camera,
                "lighting": lighting,
                "duration_estimate": 10.0,
                "narration": n.get("text", ""),
                "sound_design": profile["sound"],
                "music_cue": "极低音量环境铺底,不要煽情旋律",
                "reference_ids": ref_ids,
                "reference_requirements": ref_reqs,
                "requires_real_footage": False,
                "fact_refs": pick_fact_refs(fact_cards, limit=2),
                "topic": profile["label"],
            }
        )
    return shots


def _build_jimeng_prompt(
    template: str,
    shot: dict[str, Any],
    memory: dict[str, Any],
    fact_cards: list[dict[str, Any]],
) -> str:
    skeleton = _extract_template_skeleton(template)
    refs = _reference_descriptions(shot, memory)
    fact_text = _fact_text(shot, fact_cards)
    replacements = {
        "【chapter.timecode】": f"{shot.get('timecode_start','')} - {shot.get('timecode_end','')}",
        "【shot.duration】": str(int(float(shot.get("duration_estimate", 10) or 10))),
        "【shot.subject】": str(shot.get("subject", "")),
        "【shot.action】": str(shot.get("action", "")),
        "【shot.composition】": str(shot.get("composition", "")),
        "【shot.lighting】": str(shot.get("lighting", "")),
        "【shot.camera_motion】": str(shot.get("camera_motion", "")),
        "【shot.sound_design】": str(shot.get("sound_design", "")),
        "【shot.narration】": str(shot.get("narration", "")),
        "【reference.manifest】": refs,
        "【fact.detail】": fact_text,
        "【style.bible】": _style_text(memory),
    }
    body = skeleton
    for key, value in replacements.items():
        body = body.replace(key, value)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def _extract_template_skeleton(template: str) -> str:
    match = re.search(r"```text\s*\n([\s\S]*?)```", template)
    if match:
        return match.group(1).strip()
    return template.strip()


def _reference_descriptions(shot: dict[str, Any], memory: dict[str, Any]) -> str:
    refs = {r.get("reference_id"): r for r in memory.get("references", [])}
    slots = {s.get("slot_id"): s for s in memory.get("state_slots", [])}
    lines: list[str] = []
    for ref_id in shot.get("reference_ids") or []:
        if ref_id in refs:
            ref = refs[ref_id]
            lines.append(f"- [{ref_id}] {ref.get('name')}: {ref.get('description')}")
        elif ref_id in slots:
            slot = slots[ref_id]
            lines.append(f"- [{ref_id}] 状态图,基于 {slot.get('variant_of')}: {slot.get('description')}")
        else:
            lines.append(f"- [{ref_id}] 参考图待生成,按本镜头主体自动补图")
    return "\n".join(lines) if lines else "- 无参考图时按主体描述生成,但保持同一纪录片质感"


def _fact_text(shot: dict[str, Any], fact_cards: list[dict[str, Any]]) -> str:
    refs = set(shot.get("fact_refs") or [])
    if not refs:
        return "无直接事实句,仅使用视觉与现场细节。"
    fact_map = {fc.get("fact_id"): fc for fc in fact_cards}
    cited = [str(fact_map[r].get("content", "")) for r in refs if r in fact_map]
    return "；".join(cited[:3]) if cited else "事实引用未命中,按项目资料保持克制。"


def _style_text(memory: dict[str, Any]) -> str:
    style = memory.get("style_bible") or {}
    return (
        f"画幅 {style.get('aspect_ratio', '16:9')}; "
        f"质感 {style.get('visual_quality', '4K documentary realism')}; "
        f"色彩 {style.get('palette', '低饱和自然色')}; "
        f"连续性 {', '.join(style.get('continuity_rules', [])[:3])}"
    )


def _build_image_prompt(shot: dict[str, Any], memory: dict[str, Any]) -> str:
    return (
        f"第一章分镜参考图,镜头#{shot.get('sequence')},16:9。"
        f"主体:{shot.get('subject')}。动作:{shot.get('action')}。"
        f"构图:{shot.get('composition')}。光线:{shot.get('lighting')}。"
        f"参考图:{', '.join(shot.get('reference_ids') or [])}。"
        f"风格:{_style_text(memory)}。"
        "要求真实纪录片剧照感,不要广告棚拍,不要文字水印。"
    )


def _reference_manifest(shot: dict[str, Any], memory: dict[str, Any]) -> str:
    data = {
        "shot_id": shot.get("shot_id"),
        "sequence": shot.get("sequence"),
        "reference_ids": shot.get("reference_ids") or [],
        "reference_requirements": shot.get("reference_requirements") or [],
        "usage": "生成即梦视频前,先把上述 reference_image_prompt 资产生成为参考图；缺失状态图按 reference_requirements 自动补。",
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


def _missing_reference_assets(
    project_id: str,
    shots: list[dict[str, Any]],
    memory: dict[str, Any],
) -> list[dict[str, Any]]:
    required: dict[str, dict[str, Any]] = {}
    for shot in shots:
        for req in shot.get("reference_requirements") or []:
            ref_id = req.get("reference_id")
            if ref_id:
                required[str(ref_id)] = req
    if not required:
        return []
    with session_scope() as session:
        rows = (
            session.query(ShotAsset)
            .filter(ShotAsset.project_id == project_id, ShotAsset.asset_type == "reference_image_prompt")
            .all()
        )
        existing = {str((row.meta or {}).get("reference_id")) for row in rows}
    missing = []
    for ref_id, req in required.items():
        if ref_id not in existing:
            missing.append(_build_auto_reference(req, memory))
    return missing


def _build_auto_reference(req: dict[str, Any], memory: dict[str, Any]) -> dict[str, Any]:
    ref_id = str(req.get("reference_id"))
    refs = {r.get("reference_id"): r for r in memory.get("references", [])}
    slots = {s.get("slot_id"): s for s in memory.get("state_slots", [])}
    slot = slots.get(ref_id, {})
    variant_of = req.get("variant_of") or slot.get("variant_of") or ""
    base = refs.get(variant_of, {})
    desc = req.get("reason") or slot.get("description") or "本镜头需要的新状态参考"
    return {
        "reference_id": ref_id,
        "variant_of": variant_of,
        "prompt": (
            f"{ref_id} 自动补充参考图。基于 {variant_of}: {base.get('description','')}"
            f"。新增状态:{desc}。保持人物、环境、物品一致,只改变本状态需要的表情、姿态或材料状态。"
        ),
        "meta": {"reference_id": ref_id, "variant_of": variant_of, "state": "auto_required"},
    }


def _persist_shots(
    project_id: str,
    shots: list[dict[str, Any]],
    missing_refs: list[dict[str, Any]],
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    shot_ids: list[str] = []
    jimeng_count = 0
    with session_scope() as session:
        for ref in missing_refs:
            session.add(
                ShotAsset(
                    id=new_id("sa"),
                    project_id=project_id,
                    shot_id=None,
                    asset_type="reference_image_prompt",
                    version=1,
                    status="draft",
                    prompt=ref["prompt"],
                    rights={},
                    meta=ref.get("meta") or {},
                    created_at=now,
                    updated_at=now,
                )
            )
        for shot in shots:
            shot_id = shot["shot_id"]
            session.add(
                Shot(
                    id=shot_id,
                    project_id=project_id,
                    scene_id=shot.get("scene_id"),
                    sequence=int(shot.get("sequence", 0)),
                    shot_type=shot.get("shot_type", ""),
                    subject=shot.get("subject", ""),
                    composition=shot.get("composition", ""),
                    camera_motion=shot.get("camera_motion", ""),
                    lighting=shot.get("lighting", ""),
                    duration_estimate=float(shot.get("duration_estimate", 10)),
                    narration=str(shot.get("narration", "") or ""),
                    requires_real_footage=bool(shot.get("requires_real_footage", False)),
                    fact_refs=list(shot.get("fact_refs") or []),
                    created_at=now,
                )
            )
            shot_ids.append(shot_id)

            meta = {
                "chapter_id": shot.get("chapter_id", "ch_01"),
                "scene_id": shot.get("scene_id"),
                "timecode_start": shot.get("timecode_start"),
                "timecode_end": shot.get("timecode_end"),
                "aspect_ratio": "16:9",
                "duration_seconds": int(float(shot.get("duration_estimate", 10))),
                "shot_type": shot.get("shot_type"),
                "reference_ids": shot.get("reference_ids") or [],
                "sound_design": shot.get("sound_design", ""),
                "music_cue": shot.get("music_cue", ""),
            }
            session.add(
                ShotAsset(
                    id=new_id("sa"),
                    project_id=project_id,
                    shot_id=shot_id,
                    asset_type="jimeng_video_prompt",
                    version=1,
                    status="draft",
                    prompt=shot.get("jimeng_prompt", ""),
                    rights={},
                    meta=meta,
                    created_at=now,
                    updated_at=now,
                )
            )
            jimeng_count += 1
            session.add(
                ShotAsset(
                    id=new_id("sa"),
                    project_id=project_id,
                    shot_id=shot_id,
                    asset_type="storyboard_prompt",
                    version=1,
                    status="draft",
                    prompt=shot.get("image_prompt", ""),
                    rights={},
                    meta=meta,
                    created_at=now,
                    updated_at=now,
                )
            )
            session.add(
                ShotAsset(
                    id=new_id("sa"),
                    project_id=project_id,
                    shot_id=shot_id,
                    asset_type="shot_reference_manifest",
                    version=1,
                    status="draft",
                    prompt=shot.get("reference_manifest", ""),
                    rights={},
                    meta=meta,
                    created_at=now,
                    updated_at=now,
                )
            )
    return {"shot_ids": shot_ids, "jimeng_count": jimeng_count}
