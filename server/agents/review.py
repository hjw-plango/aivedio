"""Review (QA) Agent.

Runs after storyboard generation. Performs:
  - fact alignment check (scenes/shots reference FactCards)
  - red-line detection (against rules/red_lines.yaml)
  - tone / ad-style flag
  - emits warnings/errors to step events; downstream consumers (UI) decide
    whether to mark the run rejected.
"""

from __future__ import annotations

import json
import re
from typing import Any

from server.agents.base import AgentInput, AgentOutput, BaseAgent, Plan, PlannedSubstep
from server.engine.config_loader import load_direction
from server.engine.events import StepEmitter
from server.engine.router import ModelRouter


class ReviewAgent(BaseAgent):
    name = "review"
    version = "0.2.0"

    def __init__(self, router: ModelRouter | None = None, direction: str = "documentary") -> None:
        self.router = router or ModelRouter.from_settings()
        self.direction = direction

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(
            substeps=[
                PlannedSubstep(name="fact_alignment", description="事实对齐检查"),
                PlannedSubstep(name="red_lines", description="红线检测(双模型一致)"),
                PlannedSubstep(name="rerun_suggestions", description="重跑建议"),
            ]
        )

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:
        cfg = load_direction(self.direction)
        red_rules = (cfg.rules.get("red_lines") or {}).get("rules", [])
        review_prompt = cfg.prompts.get("review", "")

        storyboard = agent_input.upstream.get("storyboard") or {}
        writer = agent_input.upstream.get("writer") or {}
        research = agent_input.upstream.get("research") or {}
        shots = storyboard.get("shots", [])
        narration = writer.get("narration", [])
        fact_cards = research.get("fact_cards", [])

        # 1. local red-line scan (deterministic) — applies against shots + narration text
        local_hits = _local_red_line_scan(red_rules, shots, narration)
        for hit in local_hits:
            if hit["severity"] == "error":
                emitter.warning(f"red_line[{hit['rule_id']}] @ {hit['target']}")

        # 2. model-based fact alignment + red-line opinion
        report_prompt = (
            review_prompt
            + "\n\n## 待审 shots\n"
            + json.dumps(shots, ensure_ascii=False)[:5000]
            + "\n\n## 旁白\n"
            + json.dumps(narration, ensure_ascii=False)[:2000]
            + "\n\n## FactCard 列表\n"
            + json.dumps(
                [{"fact_id": f.get("fact_id"), "content": f.get("content")} for f in fact_cards[:60]],
                ensure_ascii=False,
            )[:4000]
        )

        emitter.tool_call("model.structure.review", "")
        primary = self.router.call(
            "structure",
            report_prompt,
            context={"system": "你是非遗纪录片质检员"},
            step_id=emitter.step_id,
        )
        emitter.tool_result("model.structure.review", f"len={len(primary.text)}")

        emitter.tool_call("model.writing.review_xcheck", "")
        secondary = self.router.call(
            "writing",
            report_prompt,
            context={"system": "你是非遗内容文化语气复核员"},
            step_id=emitter.step_id,
        )
        emitter.tool_result("model.writing.review_xcheck", f"len={len(secondary.text)}")

        primary_report = _parse_review(primary.text)
        secondary_report = _parse_review(secondary.text)

        consolidated = _consolidate(primary_report, secondary_report, local_hits)

        for issue in consolidated["fact_alignment"]:
            if issue.get("severity") == "error":
                emitter.warning(f"fact_alignment[{issue.get('target')}]: {issue.get('issue','')}")
        for issue in consolidated["red_lines"]:
            emitter.warning(f"red_line[{issue.get('rule_id','?')}]: {issue.get('matched_text','')}")

        emitter.artifact(
            "review_report",
            "review:report",
            summary=(
                f"事实偏差 {len(consolidated['fact_alignment'])} | 红线 {len(consolidated['red_lines'])} | 重跑建议 {len(consolidated['rerun_suggestions'])}"
            ),
        )
        emitter.finish("质检完成")

        return AgentOutput(
            summary=(
                f"事实偏差 {len(consolidated['fact_alignment'])} 红线 {len(consolidated['red_lines'])} 重跑建议 {len(consolidated['rerun_suggestions'])}"
            ),
            artifacts=[{"kind": "review_report", "ref": "review:report"}],
            data={"report": consolidated},
            warnings=[i.get("issue", i.get("matched_text", "")) for i in consolidated["red_lines"]],
        )


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def _parse_review(text: str) -> dict[str, list]:
    body = _strip_json_fence(text)
    try:
        data = json.loads(body)
    except Exception:
        return {"fact_alignment": [], "red_lines": [], "rerun_suggestions": []}
    if not isinstance(data, dict):
        return {"fact_alignment": [], "red_lines": [], "rerun_suggestions": []}
    return {
        "fact_alignment": data.get("fact_alignment") or [],
        "red_lines": data.get("red_lines") or [],
        "rerun_suggestions": data.get("rerun_suggestions") or [],
    }


def _local_red_line_scan(
    rules: list[dict[str, Any]],
    shots: list[dict[str, Any]],
    narration: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    haystacks: list[tuple[str, str]] = []
    for shot in shots:
        text = " ".join(
            str(shot.get(k, ""))
            for k in ("subject", "composition", "camera_motion", "lighting", "jimeng_prompt", "image_prompt")
        )
        haystacks.append((f"shot:{shot.get('shot_id')}", text))
    for n in narration:
        haystacks.append((f"narration:{n.get('shot_seq')}", str(n.get("text", ""))))

    for rule in rules:
        rule_id = rule.get("id", "")
        triggers = rule.get("triggers", []) or []
        severity = rule.get("severity", "warning")
        for target, text in haystacks:
            for trig in triggers:
                if not isinstance(trig, str):
                    continue
                if trig in text:
                    hits.append(
                        {
                            "rule_id": rule_id,
                            "target": target,
                            "matched_text": trig,
                            "severity": severity,
                        }
                    )
                    break
    return hits


def _consolidate(primary: dict, secondary: dict, local_hits: list[dict]) -> dict:
    """Red-line is reported only when BOTH models agree, OR when the local
    deterministic scan caught it (rules are fixed strings, no false positives).
    Fact alignment and rerun suggestions are union of both models.
    """
    # Red lines from models — keep only those mentioned in BOTH (by rule_id or matched_text)
    p_rl = primary.get("red_lines") or []
    s_rl = secondary.get("red_lines") or []
    common_keys = {(r.get("rule_id"), r.get("target")) for r in p_rl} & {
        (r.get("rule_id"), r.get("target")) for r in s_rl
    }
    model_red_lines = [r for r in p_rl if (r.get("rule_id"), r.get("target")) in common_keys]
    # Local hits override (always reliable since they match fixed strings)
    red_lines = list(local_hits) + model_red_lines

    fact_alignment = (primary.get("fact_alignment") or []) + (secondary.get("fact_alignment") or [])
    rerun_suggestions = (primary.get("rerun_suggestions") or []) + (secondary.get("rerun_suggestions") or [])

    return {
        "fact_alignment": fact_alignment,
        "red_lines": red_lines,
        "rerun_suggestions": rerun_suggestions,
    }
