"""Writer Agent for long-form documentary planning.

P0 now produces a usable documentary production blueprint instead of a tiny
five-shot pilot: full outline, chapter timing, first-chapter script, and a
continuity seed for the memory agent.
"""

from __future__ import annotations

import json
from typing import Any

from server.agents.base import AgentInput, AgentOutput, BaseAgent, Plan, PlannedSubstep
from server.agents.documentary_profiles import (
    CHAPTER_ONE_TARGET_SECONDS,
    compact_fact_text,
    detect_profile,
    pick_fact_refs,
    timecode,
)
from server.engine.config_loader import load_direction
from server.engine.events import StepEmitter
from server.engine.router import ModelRouter
from server.utils.json_extract import extract_json_payload


class WriterAgent(BaseAgent):
    name = "writer"
    version = "1.0.0"

    def __init__(self, router: ModelRouter | None = None, direction: str = "documentary") -> None:
        self.router = router or ModelRouter.from_settings()
        self.direction = direction

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(
            substeps=[
                PlannedSubstep(name="documentary_outline", description="生成完整纪录片大纲"),
                PlannedSubstep(name="chapter_timing", description="按章节拆分钟秒数与叙事职责"),
                PlannedSubstep(name="chapter_01_script", description="展开第一章剧本与旁白"),
                PlannedSubstep(name="continuity_seed", description="提取人物/环境/物品一致性种子"),
            ]
        )

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:
        cfg = load_direction(self.direction)
        prompt_tpl = cfg.prompts.get("writing", "")

        research = agent_input.upstream.get("research") or {}
        fact_cards = research.get("fact_cards", [])
        brief = agent_input.payload.get("brief") or agent_input.upstream.get("brief", "")

        if not fact_cards:
            emitter.warning("没有 FactCard,无法生成真实可追踪的纪录片结构")
            emitter.finish("no facts")
            return AgentOutput(
                summary="no facts",
                data={"plan": {}, "script": [], "narration": [], "documentary_plan": {}},
            )

        emitter.progress(
            f"基于 {len(fact_cards)} 条 FactCard 生成完整纪录片大纲与第一章", visibility="detail"
        )
        prompt = (
            prompt_tpl
            + "\n\n## 项目 brief\n"
            + str(brief)
            + "\n\n## FactCard\n"
            + json.dumps(
                [
                    {
                        "fact_id": f.get("fact_id"),
                        "category": f.get("category"),
                        "content": f.get("content"),
                    }
                    for f in fact_cards[:80]
                ],
                ensure_ascii=False,
                indent=2,
            )
        )

        emitter.tool_call("model.writing.longform", f"prompt={len(prompt)}chars")
        result = self.router.call(
            "writing",
            prompt,
            context={
                "system": (
                    "你是纪录片总编剧。输出可生产的长纪录片结构,先完整大纲,再只展开第一章。"
                ),
                "temperature": 0.5,
            },
            step_id=emitter.step_id,
        )
        emitter.tool_result("model.writing.longform", f"len={len(result.text)}")

        parsed = _parse_writer_output(result.text)
        if not _looks_like_longform(parsed):
            emitter.progress("模型未返回可用长纪录片结构,使用本地纪录片蓝图兜底", visibility="detail")
            parsed = _fallback_longform(fact_cards, str(brief))

        # Keep legacy keys for existing UI/API consumers, but point them at the
        # first chapter instead of a fake whole film.
        first_chapter = parsed["first_chapter"]
        script = first_chapter.get("scenes", [])
        narration = first_chapter.get("narration", [])
        parsed["plan"] = parsed["documentary_plan"]
        parsed["script"] = script
        parsed["narration"] = narration

        emitter.artifact("documentary_plan", "writer:documentary_plan", summary="完整纪录片大纲")
        emitter.artifact(
            "chapter_plan",
            f"writer:chapters:{len(parsed['documentary_plan'].get('chapters', []))}",
            summary=f"{len(parsed['documentary_plan'].get('chapters', []))} 章",
        )
        emitter.artifact(
            "chapter_01_script",
            f"writer:chapter_01:{len(script)}",
            summary=f"第一章 {first_chapter.get('target_duration_seconds', 0)} 秒",
        )
        emitter.finish("长纪录片编剧蓝图完成")

        return AgentOutput(
            summary=(
                f"完整大纲 {len(parsed['documentary_plan'].get('chapters', []))} 章,"
                f"第一章 {first_chapter.get('target_duration_seconds', 0)} 秒"
            ),
            artifacts=[
                {"kind": "documentary_plan", "ref": "writer:documentary_plan"},
                {"kind": "chapter_01_script", "ref": "writer:chapter_01"},
            ],
            data=parsed,
        )


def _strip_json_fence(text: str) -> str:
    return extract_json_payload(text)


def _parse_writer_output(text: str) -> dict[str, Any]:
    try:
        data = json.loads(_strip_json_fence(text))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    plan = data.get("documentary_plan") or data.get("plan") or {}
    first_chapter = data.get("first_chapter") or data.get("chapter_01") or {}
    memory_seed = data.get("memory_seed") or {}
    return {
        "documentary_plan": plan if isinstance(plan, dict) else {},
        "first_chapter": first_chapter if isinstance(first_chapter, dict) else {},
        "memory_seed": memory_seed if isinstance(memory_seed, dict) else {},
    }


def _looks_like_longform(data: dict[str, Any]) -> bool:
    plan = data.get("documentary_plan") or {}
    first = data.get("first_chapter") or {}
    chapters = plan.get("chapters") or []
    scenes = first.get("scenes") or []
    narration = first.get("narration") or []
    return isinstance(chapters, list) and len(chapters) >= 3 and scenes and narration


def _fallback_longform(fact_cards: list[dict[str, Any]], brief: str) -> dict[str, Any]:
    profile = detect_profile(brief, fact_cards)
    title = _title_from_brief(brief, profile["label"])
    fact_refs = pick_fact_refs(fact_cards, limit=4)
    chapter_seconds = [180, 210, 210, 120]
    chapter_titles = [
        "第一章: 进入现场",
        "第二章: 材料与手",
        "第三章: 工序的节奏",
        "第四章: 留在物上的时间",
    ]
    chapters: list[dict[str, Any]] = []
    cursor = 0
    for idx, seconds in enumerate(chapter_seconds, start=1):
        end = cursor + seconds
        chapters.append(
            {
                "chapter_id": f"ch_{idx:02d}",
                "sequence": idx,
                "title": chapter_titles[idx - 1],
                "start_timecode": timecode(cursor),
                "end_timecode": timecode(end),
                "target_duration_seconds": seconds,
                "narrative_function": [
                    "建立空间、主题与观看方式",
                    "让观众认识材料、工具和身体动作",
                    "把核心步骤按时间顺序讲清楚",
                    "收束到成品、现场余韵和开放结尾",
                ][idx - 1],
                "content": _chapter_content(profile, idx),
                "visual_strategy": _chapter_visual_strategy(profile, idx),
                "sound_strategy": profile["sound"],
                "fact_refs": fact_refs,
            }
        )
        cursor = end

    scenes, narration = _first_chapter_scenes(profile, fact_cards, title)
    memory_seed = {
        "style_bible": {
            "format": "observational documentary",
            "aspect_ratio": "16:9",
            "visual_quality": "4K documentary still, natural texture, low saturation, no commercial gloss",
            "palette": profile["palette"],
            "sound_bed": profile["sound"],
        },
        "subjects": [
            {
                "id": "REF_PERSON_PRIMARY_CRAFTSPERSON",
                "type": "person",
                "name": "匿名主手艺人",
                "description": profile["person"],
            },
            {
                "id": "REF_ENV_PRIMARY_WORKSHOP",
                "type": "environment",
                "name": "主工坊环境",
                "description": profile["environment"],
            },
            {
                "id": "REF_OBJ_PRIMARY_TOOL",
                "type": "object",
                "name": "核心工具组",
                "description": profile["tool"],
            },
            {
                "id": "REF_MAT_PRIMARY_MATERIAL",
                "type": "material",
                "name": "核心材料",
                "description": profile["material"],
            },
        ],
    }
    return {
        "documentary_plan": {
            "title": title,
            "logline": f"用观察式镜头跟随{profile['label']}的现场,看见{profile['theme']}。",
            "target_duration_seconds": sum(chapter_seconds),
            "target_duration": timecode(sum(chapter_seconds)),
            "tone": "克制、具体、以现场声音和细节推进,避免口号式抒情",
            "audience": "对传统工艺、地方文化和真实制作过程感兴趣的普通观众",
            "narrative_line": f"从空间进入材料,再进入{', '.join(profile['process'][:3])}的动作链,最后把时间感留在成品和现场余韵中。",
            "chapters": chapters,
            "evidence_notes": compact_fact_text(fact_cards, 8),
        },
        "first_chapter": {
            "chapter_id": "ch_01",
            "title": "第一章: 进入现场",
            "target_duration_seconds": CHAPTER_ONE_TARGET_SECONDS,
            "start_timecode": "00:00",
            "end_timecode": timecode(CHAPTER_ONE_TARGET_SECONDS),
            "scenes": scenes,
            "narration": narration,
        },
        "memory_seed": memory_seed,
    }


def _title_from_brief(brief: str, fallback: str) -> str:
    clean = (brief or "").strip()
    if not clean:
        return f"{fallback}: 手艺的现场"
    return clean[:36].replace("\n", " ")


def _chapter_content(profile: dict[str, Any], idx: int) -> str:
    process = list(profile["process"])
    if idx == 1:
        return f"清晨或开工前进入{profile['environment']},用细节建立主题:{profile['theme']}。"
    if idx == 2:
        return f"围绕{profile['material']}与{profile['tool']}展开,让观众看清材料状态和工具痕迹。"
    if idx == 3:
        return "按工序推进:" + "、".join(process) + ",每一步用动作、声音与特写解释。"
    return f"回到{profile['motif']},用半成品、成品和现场余声收束。"


def _chapter_visual_strategy(profile: dict[str, Any], idx: int) -> str:
    if idx == 1:
        return "空镜、慢推、手部预备动作、环境细节,少解释,先建立可信空间。"
    if idx == 2:
        return "材料微距、工具磨损、手与材料接触,镜头保持稳定,让质感自己说话。"
    if idx == 3:
        return "连续工序镜头、动作匹配剪辑、局部运动特写,避免跳步。"
    return "成品静物、工作台余痕、人物背影或安静正脸,声音逐渐变少。"


def _first_chapter_scenes(
    profile: dict[str, Any],
    fact_cards: list[dict[str, Any]],
    title: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    scene_specs = [
        (
            "ch01_sc01",
            "开场空镜",
            0,
            45,
            f"进入{profile['environment']},没有解释性人物介绍,只让空间、工具和声音先出现。",
            ("location", "history"),
        ),
        (
            "ch01_sc02",
            "第一双手",
            45,
            105,
            f"匿名手艺人开始整理{profile['material']}与{profile['tool']},动作慢而准确。",
            ("tool", "material", "craft_step"),
        ),
        (
            "ch01_sc03",
            "工序的入口",
            105,
            150,
            f"进入{profile['process'][0]}和{profile['process'][1]}的前置动作,不急着讲完整流程。",
            ("craft_step", "material"),
        ),
        (
            "ch01_sc04",
            "第一章停顿",
            150,
            180,
            f"停在{profile['motif']}上,给第二章材料细讲留下入口。",
            ("history", "folklore", "material"),
        ),
    ]
    scenes: list[dict[str, Any]] = []
    for scene_id, name, start, end, beat, categories in scene_specs:
        scenes.append(
            {
                "scene_id": scene_id,
                "chapter_id": "ch_01",
                "title": name,
                "start_timecode": timecode(start),
                "end_timecode": timecode(end),
                "target_duration_seconds": end - start,
                "location": profile["environment"],
                "time": "清晨到上午",
                "beats": [
                    {
                        "description": beat,
                        "fact_refs": pick_fact_refs(fact_cards, categories=categories, limit=2),
                    }
                ],
                "narration_draft": "",
                "fact_refs": pick_fact_refs(fact_cards, categories=categories, limit=3),
            }
        )

    narration_texts = [
        f"片子从一个还没被解释的现场开始。{profile['label']}先以声音出现。",
        f"旧工具没有被摆正,它们只是留在昨天停下的位置。",
        f"材料被手拿起之前,先显出重量、湿度和纹理。",
        f"镜头不急着证明什么,只靠近一次普通的开工。",
        f"手艺人的脸可以出现,但重点仍是手、呼吸和停顿。",
        f"第一道动作很小,却决定后面所有形状的方向。",
        f"桌面上的粉尘、线头或油彩,记录了反复练习的痕迹。",
        f"这里的时间不是口号,而是一次次重复留下的秩序。",
        f"当{profile['process'][0]}开始,材料不再只是材料。",
        f"每一次触碰都在试探它能承受的边界。",
        f"旁白退后一点,让声音告诉观众动作的轻重。",
        f"第一章只打开门,不把答案说完。",
    ]
    narration: list[dict[str, Any]] = []
    cursor = 0
    for idx, text in enumerate(narration_texts, start=1):
        duration = 15 if idx in {1, 4, 8, 12} else 12
        narration.append(
            {
                "shot_seq": idx,
                "start_timecode": timecode(cursor),
                "end_timecode": timecode(min(CHAPTER_ONE_TARGET_SECONDS, cursor + duration)),
                "est_seconds": duration,
                "text": text,
                "voice_style": "低声、平稳、留白,不要播音腔",
                "fact_refs": pick_fact_refs(fact_cards, limit=2),
            }
        )
        cursor += duration
    return scenes, narration
