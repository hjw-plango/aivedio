"""Project memory agent.

Stores a production bible and reference-image prompt plan as project-level
ShotAsset rows so downstream agents can retrieve consistent subjects,
environments, objects, and missing state variants.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from server.agents.base import AgentInput, AgentOutput, BaseAgent, Plan, PlannedSubstep
from server.agents.documentary_profiles import detect_profile
from server.data.models import ShotAsset
from server.data.session import session_scope
from server.engine.events import StepEmitter
from server.utils.ids import new_id


class MemoryAgent(BaseAgent):
    name = "memory"
    version = "1.0.0"

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(
            substeps=[
                PlannedSubstep(name="load_seed", description="读取编剧阶段的一致性种子"),
                PlannedSubstep(name="reference_bible", description="生成主体/环境/物品参考图计划"),
                PlannedSubstep(name="state_slots", description="预留表情/姿态/环境状态变体"),
                PlannedSubstep(name="persist", description="落库项目记忆与参考图提示词"),
            ]
        )

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:
        writer = agent_input.upstream.get("writer") or {}
        research = agent_input.upstream.get("research") or {}
        fact_cards = research.get("fact_cards", [])
        brief = agent_input.payload.get("brief") or agent_input.upstream.get("brief", "")

        memory = _build_memory(writer, fact_cards, str(brief))
        emitter.progress(
            f"生成项目记忆: {len(memory['references'])} 个主体参考, {len(memory['state_slots'])} 个状态槽",
            visibility="detail",
        )
        ids = _persist_memory(agent_input.project_id, memory)
        emitter.artifact("production_memory", ids["memory_asset_id"], summary="项目记忆 JSON")
        emitter.artifact(
            "reference_image_prompts",
            f"refs:{len(ids['reference_asset_ids'])}",
            summary=f"{len(ids['reference_asset_ids'])} 条参考图提示词",
        )
        emitter.finish("项目记忆与参考图计划完成")

        return AgentOutput(
            summary=f"记忆 {len(memory['references'])} 主体,状态槽 {len(memory['state_slots'])}",
            artifacts=[
                {"kind": "production_memory", "ref": ids["memory_asset_id"]},
                {"kind": "reference_image_prompts", "ref": "reference_image_prompts"},
            ],
            data={"memory": memory, **ids},
        )


def _build_memory(
    writer_output: dict[str, Any],
    fact_cards: list[dict[str, Any]],
    brief: str,
) -> dict[str, Any]:
    seed = writer_output.get("memory_seed") or {}
    profile = detect_profile(brief, fact_cards)
    style = seed.get("style_bible") or {}
    subjects = seed.get("subjects") or []
    if not subjects:
        subjects = [
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
        ]

    references: list[dict[str, Any]] = []
    for subject in subjects:
        ref_type = str(subject.get("type", "object"))
        reference_id = str(subject.get("id") or _reference_id(ref_type, subject.get("name", "")))
        description = str(subject.get("description", "")).strip()
        references.append(
            {
                "reference_id": reference_id,
                "type": ref_type,
                "name": subject.get("name") or reference_id,
                "description": description,
                "aspect_ratio": "3:4" if ref_type == "person" else "16:9",
                "quality": (
                    "4K documentary reference photo, exact continuity bible, natural light,"
                    " realistic skin/material texture, no beauty retouching, no watermark"
                ),
                "base_prompt": _base_reference_prompt(reference_id, ref_type, description, profile, style),
                "status": "needed",
            }
        )

    state_slots = _default_state_slots(profile)
    return {
        "version": "1.0",
        "topic": profile["label"],
        "style_bible": {
            "aspect_ratio": style.get("aspect_ratio", "16:9"),
            "visual_quality": style.get(
                "visual_quality",
                "4K documentary realism, low saturation, natural texture, restrained composition",
            ),
            "palette": style.get("palette", profile["palette"]),
            "sound_bed": style.get("sound_bed", profile["sound"]),
            "continuity_rules": [
                "同一人物服装、发型、年龄感、手部特征保持一致",
                "同一工坊的墙面、窗户、桌面磨损、工具位置保持一致",
                "同一物品的材质、颜色、污渍、磨损痕迹保持一致",
                "章节内镜头默认使用同一色彩和自然光逻辑",
            ],
        },
        "references": references,
        "state_slots": state_slots,
    }


def _reference_id(ref_type: str, name: str) -> str:
    slug = "".join(ch for ch in name.upper() if ch.isalnum())[:18] or "SUBJECT"
    return f"REF_{ref_type.upper()}_{slug}"


def _base_reference_prompt(
    reference_id: str,
    ref_type: str,
    description: str,
    profile: dict[str, Any],
    style: dict[str, Any],
) -> str:
    ratio = "3:4" if ref_type == "person" else "16:9"
    if ref_type == "person":
        return (
            f"{reference_id} 主体人物参考图,{ratio},半身到全身均可裁切。"
            f"人物:{description}。"
            "要求:面部可见但自然克制,皮肤真实,手部细节清楚,衣服有工作痕迹,"
            "不要明星脸,不要精修棚拍,不要夸张表演。"
            f"整体风格:{style.get('visual_quality') or '4K documentary realism'}。"
        )
    if ref_type == "environment":
        return (
            f"{reference_id} 主体环境参考图,{ratio}。"
            f"空间:{description}。"
            f"保留可复用锚点:{profile['tool']}、{profile['material']}。"
            "要求:真实空间透视,自然杂物,灰尘、磨损、墙面纹理清楚,不要广告布景。"
        )
    return (
        f"{reference_id} 主体物品参考图,{ratio}。"
        f"物品:{description}。"
        "要求:单独清楚展示主体,材质纹理、污渍、磨损、边缘细节可见,"
        "背景简洁但不纯白棚拍,可作为后续状态图参考。"
    )


def _default_state_slots(profile: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "slot_id": "REF_PERSON_PRIMARY_CRAFTSPERSON_FACE_FOCUSED",
            "variant_of": "REF_PERSON_PRIMARY_CRAFTSPERSON",
            "state": "focused_expression",
            "description": "专注、轻微皱眉、低头观察材料的表情参考",
            "trigger": "镜头需要专注表情或正脸观察",
        },
        {
            "slot_id": "REF_PERSON_PRIMARY_CRAFTSPERSON_HANDS_WORKING",
            "variant_of": "REF_PERSON_PRIMARY_CRAFTSPERSON",
            "state": "hands_working_pose",
            "description": f"双手正在处理{profile['material']}的姿态参考,手部、袖口和材料接触清楚",
            "trigger": "镜头需要手部操作、跑动、转身、弯腰等具体姿态",
        },
        {
            "slot_id": "REF_ENV_PRIMARY_WORKSHOP_EARLY_MORNING",
            "variant_of": "REF_ENV_PRIMARY_WORKSHOP",
            "state": "early_morning_light",
            "description": "同一工坊清晨自然光状态,窗边光束、灰尘、桌面阴影位置明确",
            "trigger": "清晨、开场、空镜需要统一环境光",
        },
        {
            "slot_id": "REF_MAT_PRIMARY_MATERIAL_ACTIVE_STATE",
            "variant_of": "REF_MAT_PRIMARY_MATERIAL",
            "state": "active_material_state",
            "description": f"{profile['material']}在被处理时的状态参考,湿度、纤维、粉尘或油彩细节明确",
            "trigger": "材料发生形变、湿润、展开、被工具接触时",
        },
    ]


def _variant_prompt(slot: dict[str, Any], memory: dict[str, Any]) -> str:
    refs = {r["reference_id"]: r for r in memory.get("references", [])}
    base = refs.get(slot.get("variant_of", ""))
    base_desc = base.get("description", "") if base else ""
    return (
        f"{slot['slot_id']} 状态参考图,基于 {slot['variant_of']} 的主体一致性。"
        f"基础主体:{base_desc}。"
        f"新增状态:{slot['description']}。"
        "必须保持主体身份、服装、材质、空间锚点一致,只改变表情/姿态/光线/材料状态。"
    )


def _persist_memory(project_id: str, memory: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    memory_asset_id = new_id("sa")
    reference_asset_ids: list[str] = []
    with session_scope() as session:
        session.add(
            ShotAsset(
                id=memory_asset_id,
                project_id=project_id,
                shot_id=None,
                asset_type="production_memory",
                version=1,
                status="draft",
                prompt=json.dumps(memory, ensure_ascii=False, indent=2),
                rights={},
                meta={"topic": memory.get("topic"), "kind": "production_memory"},
                created_at=now,
                updated_at=now,
            )
        )
        for ref in memory.get("references", []):
            asset_id = new_id("sa")
            session.add(
                ShotAsset(
                    id=asset_id,
                    project_id=project_id,
                    shot_id=None,
                    asset_type="reference_image_prompt",
                    version=1,
                    status="draft",
                    prompt=ref["base_prompt"],
                    rights={},
                    meta={
                        "reference_id": ref["reference_id"],
                        "reference_type": ref["type"],
                        "state": "base",
                        "aspect_ratio": ref["aspect_ratio"],
                    },
                    created_at=now,
                    updated_at=now,
                )
            )
            reference_asset_ids.append(asset_id)
        for slot in memory.get("state_slots", []):
            asset_id = new_id("sa")
            session.add(
                ShotAsset(
                    id=asset_id,
                    project_id=project_id,
                    shot_id=None,
                    asset_type="reference_image_prompt",
                    version=1,
                    status="draft",
                    prompt=_variant_prompt(slot, memory),
                    rights={},
                    meta={
                        "reference_id": slot["slot_id"],
                        "reference_type": "state_variant",
                        "variant_of": slot["variant_of"],
                        "state": slot["state"],
                        "trigger": slot["trigger"],
                    },
                    created_at=now,
                    updated_at=now,
                )
            )
            reference_asset_ids.append(asset_id)
    return {"memory_asset_id": memory_asset_id, "reference_asset_ids": reference_asset_ids}
