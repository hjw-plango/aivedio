"""Writer Agent.

Input:
  - upstream.research.fact_cards
  - payload.brief
Output:
  - data.plan: 策划方案
  - data.script: 分场剧本
  - data.narration: 逐镜头旁白(草稿,真实分镜在 storyboard 阶段定稿)
"""

from __future__ import annotations

import json
import re
from typing import Any

from server.agents.base import AgentInput, AgentOutput, BaseAgent, Plan, PlannedSubstep
from server.engine.config_loader import load_direction
from server.engine.events import StepEmitter
from server.engine.router import ModelRouter


class WriterAgent(BaseAgent):
    name = "writer"
    version = "0.2.0"

    def __init__(self, router: ModelRouter | None = None, direction: str = "documentary") -> None:
        self.router = router or ModelRouter.from_settings()
        self.direction = direction

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(
            substeps=[
                PlannedSubstep(name="plan", description="生成策划方案"),
                PlannedSubstep(name="script", description="生成分场剧本"),
                PlannedSubstep(name="narration", description="生成逐镜头旁白草稿"),
                PlannedSubstep(name="culture_review", description="文化语气复核"),
            ]
        )

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:
        cfg = load_direction(self.direction)
        prompt_tpl = cfg.prompts.get("writing", "")

        research = agent_input.upstream.get("research") or {}
        fact_cards = research.get("fact_cards", [])
        brief = agent_input.payload.get("brief") or agent_input.upstream.get("brief", "")

        if not fact_cards:
            emitter.warning("没有 FactCard,生成空剧本")
            emitter.finish("no facts")
            return AgentOutput(summary="no facts", data={"plan": {}, "script": [], "narration": []})

        emitter.progress(f"基于 {len(fact_cards)} 条 FactCard 起草剧本", visibility="detail")
        prompt = (
            prompt_tpl
            + f"\n\n## brief\n{brief}\n"
            + "\n## FactCard\n"
            + json.dumps(
                [{"fact_id": f.get("fact_id"), "content": f.get("content")} for f in fact_cards[:60]],
                ensure_ascii=False,
                indent=2,
            )
        )

        emitter.tool_call("model.writing.script", f"prompt={len(prompt)}chars")
        result = self.router.call(
            "writing",
            prompt,
            context={"system": "你是非遗纪录片编剧,克制、观察式、不广告化"},
            step_id=emitter.step_id,
        )
        emitter.tool_result("model.writing.script", f"len={len(result.text)}")

        parsed = _parse_writer_output(result.text)
        if not parsed.get("script"):
            emitter.progress("模型未返回结构化剧本,触发本地兜底", visibility="detail")
            parsed = _fallback_script(fact_cards, brief)

        # Cross-check via secondary model (cultural tone).
        review_prompt = (
            "审核以下旁白与剧本是否符合非遗纪录片克制、观察式风格。命中广告化/虚构/不当类比时返回 issues 数组。"
            "只输出 JSON: {issues: [{target, issue, severity}]}\n\n"
            + json.dumps(parsed, ensure_ascii=False)[:6000]
        )
        emitter.tool_call("model.research.tone_review", "")
        review = self.router.call("research", review_prompt, step_id=emitter.step_id)
        emitter.tool_result("model.research.tone_review", f"len={len(review.text)}")
        issues = _parse_tone_review(review.text)
        for issue in issues:
            if issue.get("severity") in {"warning", "error"}:
                emitter.warning(f"{issue.get('target','?')}: {issue.get('issue','')}")

        emitter.artifact("plan", "writer:plan", summary="策划方案")
        emitter.artifact("script", f"writer:script:{len(parsed.get('script', []))}", summary=f"{len(parsed.get('script', []))} 场")
        emitter.artifact(
            "narration",
            f"writer:narration:{len(parsed.get('narration', []))}",
            summary=f"{len(parsed.get('narration', []))} 段旁白",
        )
        emitter.finish("剧本草稿完成")

        return AgentOutput(
            summary=f"剧本 {len(parsed.get('script', []))} 场,旁白 {len(parsed.get('narration', []))} 段",
            artifacts=[
                {"kind": "plan", "ref": "writer:plan"},
                {"kind": "script", "ref": "writer:script"},
                {"kind": "narration", "ref": "writer:narration"},
            ],
            data=parsed,
            warnings=[issue.get("issue", "") for issue in issues if issue.get("severity") in {"warning", "error"}],
        )


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def _parse_writer_output(text: str) -> dict[str, Any]:
    body = _strip_json_fence(text)
    try:
        data = json.loads(body)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    out = {
        "plan": data.get("plan") or {},
        "script": data.get("script") or [],
        "narration": data.get("narration") or [],
    }
    return out


def _parse_tone_review(text: str) -> list[dict[str, Any]]:
    body = _strip_json_fence(text)
    try:
        data = json.loads(body)
    except Exception:
        return []
    if isinstance(data, dict):
        return data.get("issues", []) or []
    if isinstance(data, list):
        return data
    return []


def _fallback_script(fact_cards: list[dict[str, Any]], brief: str) -> dict[str, Any]:
    """When LLM is unreachable, build a usable scaffold from FactCards."""
    topic = brief[:40] or "未命名主题"
    plan = {
        "theme": topic,
        "audience": "对非遗感兴趣的普通观众",
        "tone": "克制、观察式、不广告化",
        "chapters": [
            {"title": "环境", "intent": "建立空间与氛围"},
            {"title": "工艺", "intent": "展现工艺的具体细节"},
            {"title": "材质", "intent": "聚焦材料与工具"},
        ],
        "narrative_line": "由空间进入工艺,以材料结尾,留白意象",
    }
    chunks = [fact_cards[i : i + 3] for i in range(0, min(len(fact_cards), 9), 3)]
    script = []
    narration = []
    for idx, group in enumerate(chunks, start=1):
        scene_id = f"scene_{idx}"
        beats = [{"description": fc.get("content", "")[:80], "fact_refs": [fc.get("fact_id")]} for fc in group]
        narration_text = "".join(fc.get("content", "")[:30] for fc in group)
        script.append(
            {
                "scene_id": scene_id,
                "location": "工坊",
                "time": "白天",
                "beats": beats,
                "narration_draft": narration_text[:120],
                "fact_refs": [fc.get("fact_id") for fc in group],
            }
        )
        for shot_seq, fc in enumerate(group, start=1):
            narration.append(
                {
                    "shot_seq": (idx - 1) * 5 + shot_seq,
                    "text": fc.get("content", "")[:40],
                    "est_seconds": 5,
                    "fact_refs": [fc.get("fact_id")],
                }
            )
    return {"plan": plan, "script": script, "narration": narration}
