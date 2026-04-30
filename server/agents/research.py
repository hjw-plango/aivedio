"""Research Agent.

Input:
  - upstream.materials: list[{id, content, source_type, source_url?}]
  - payload.brief: str
Output:
  - data.fact_cards: list[FactCard dict]
  - data.entities: list[Entity dict]
  - data.relations: list[Relation dict]

Implementation:
  - Calls ModelRouter task_type="research" (GPT-5.5 by config) to extract.
  - Calls ModelRouter task_type="writing" (Claude) for culture review.
  - Persists FactCard / Entity / Relation rows in DB.
  - When provider is MockProvider (no API key), falls back to a deterministic
    extractor so the whole pipeline can be exercised offline.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from server.agents.base import AgentInput, AgentOutput, BaseAgent, Plan, PlannedSubstep
from server.data.models import Entity, FactCard, Relation
from server.data.session import session_scope
from server.engine.config_loader import load_direction
from server.engine.events import StepEmitter
from server.engine.router import ModelRouter
from server.utils.hashing import text_sha256
from server.utils.ids import new_id
from server.utils.json_extract import extract_json_payload


class ResearchAgent(BaseAgent):
    name = "research"
    version = "0.2.0"

    def __init__(self, router: ModelRouter | None = None, direction: str = "documentary") -> None:
        self.router = router or ModelRouter.from_settings()
        self.direction = direction

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(
            substeps=[
                PlannedSubstep(name="load_materials", description="读取并合并资料"),
                PlannedSubstep(name="extract_facts", description="抽取 FactCard"),
                PlannedSubstep(name="extract_graph", description="抽取 Entity / Relation"),
                PlannedSubstep(name="culture_review", description="文化敏感度复核"),
                PlannedSubstep(name="persist", description="落库"),
            ]
        )

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:
        cfg = load_direction(self.direction)
        prompt_tpl = cfg.prompts.get("research", "")

        materials: list[dict[str, Any]] = agent_input.upstream.get("materials", []) or agent_input.payload.get(
            "materials", []
        )
        if not materials:
            emitter.warning("没有可用资料,生成空 FactCard 列表")
            emitter.finish("no materials")
            return AgentOutput(summary="no materials", data={"fact_cards": [], "entities": [], "relations": []})

        emitter.progress(f"读取 {len(materials)} 条资料", visibility="detail")
        merged_text = "\n\n---\n\n".join(m.get("content", "") for m in materials)

        emitter.tool_call("model.research", f"prompt={len(prompt_tpl)}chars text={len(merged_text)}chars")
        prompt = (
            prompt_tpl
            + "\n\n## 输入资料\n\n"
            + merged_text
            + f"\n\n## 项目 brief\n{agent_input.payload.get('brief', '')}\n"
        )
        result = self.router.call("research", prompt, context={"system": "你是结构化事实抽取助手"}, step_id=emitter.step_id)
        emitter.tool_result("model.research", f"len={len(result.text)}")

        extracted = _parse_extraction(result.text, merged_text)
        if not extracted["fact_cards"]:
            emitter.progress("模型未返回结构化结果,触发本地兜底抽取", visibility="detail")
            extracted = _local_fallback_extract(materials, agent_input.payload.get("brief", ""))

        # Culture review (cross-check) on the extracted facts.
        review_prompt = (
            "请对以下 FactCard 做文化敏感度与表述准确性审核,只输出 JSON: "
            "[{fact_id, status: ok|warning|error, note}]\n\n"
            + json.dumps(extracted["fact_cards"], ensure_ascii=False, indent=2)
        )
        emitter.tool_call("model.writing.culture_review", f"facts={len(extracted['fact_cards'])}")
        review = self.router.call(
            "writing",
            review_prompt,
            context={"system": "你是非遗内容文化审核员,语气克制,只标注问题"},
            step_id=emitter.step_id,
        )
        emitter.tool_result("model.writing.culture_review", f"len={len(review.text)}")
        culture_map = _parse_culture_review(review.text)

        for fc in extracted["fact_cards"]:
            r = culture_map.get(fc["fact_id"])
            if r:
                fc["culture_review"] = r

        # Persist.
        ids = _persist(agent_input.project_id, extracted)
        emitter.artifact("fact_cards", f"facts:{len(ids['fact_card_ids'])}", summary=f"{len(ids['fact_card_ids'])} FactCard 已落库")
        emitter.artifact("entities", f"entities:{len(ids['entity_ids'])}")
        emitter.artifact("relations", f"relations:{len(ids['relation_ids'])}")
        emitter.finish(
            f"FactCard {len(ids['fact_card_ids'])} / Entity {len(ids['entity_ids'])} / Relation {len(ids['relation_ids'])}"
        )

        return AgentOutput(
            summary=f"研究完成,FactCard {len(ids['fact_card_ids'])} 条",
            artifacts=[
                {"kind": "fact_cards", "ref": "facts:" + ",".join(ids["fact_card_ids"][:3])},
            ],
            data={
                "fact_cards": extracted["fact_cards"],
                "entities": extracted["entities"],
                "relations": extracted["relations"],
                "fact_card_ids": ids["fact_card_ids"],
            },
        )


# --- helpers ---


def _strip_json_fence(text: str) -> str:
    return extract_json_payload(text)


def _parse_extraction(model_text: str, original_text: str) -> dict[str, Any]:
    text = _strip_json_fence(model_text)
    try:
        data = json.loads(text)
    except Exception:
        return {"fact_cards": [], "entities": [], "relations": []}

    fact_cards = []
    if isinstance(data, dict):
        raw_facts = data.get("fact_cards") or data.get("facts") or []
        entities = data.get("entities", [])
        relations = data.get("relations", [])
    elif isinstance(data, list):
        raw_facts = data
        entities = []
        relations = []
    else:
        return {"fact_cards": [], "entities": [], "relations": []}

    for fc in raw_facts:
        if not isinstance(fc, dict):
            continue
        content = fc.get("content", "")
        span = fc.get("source_span") or {}
        if not span and content:
            idx = original_text.find(content[:40])
            if idx >= 0:
                span = {
                    "start": idx,
                    "end": idx + len(content),
                    "hash": text_sha256(content),
                }
        fact_cards.append(
            {
                "fact_id": fc.get("fact_id") or new_id("fc"),
                "topic": fc.get("topic", ""),
                "category": fc.get("category", ""),
                "content": content,
                "confidence": float(fc.get("confidence", 0.6)),
                "source_span": span,
                "needs_review": bool(fc.get("needs_review", False)),
            }
        )

    return {"fact_cards": fact_cards, "entities": entities, "relations": relations}


# Lines that look like document metadata (markdown frontmatter, BOM-ish
# headers, source citations) and must never become FactCards.
_META_LINE_PATTERNS = (
    re.compile(r"^\s*#"),                       # markdown heading
    re.compile(r"^\s*>"),                       # markdown blockquote / source line
    re.compile(r"^\s*[*\-+]\s"),                # markdown bullet markers — keep content but strip prefix
    re.compile(r"^\s*\d+[\.、)]\s*$"),           # bare numbering "1." / "1、"
    re.compile(r"^\s*[—=\-]{3,}\s*$"),          # horizontal rules
)

# Phrases that indicate the sentence is talking ABOUT the document itself,
# not about the heritage subject.
_META_PHRASE_PATTERNS = (
    re.compile(r"pilot\s*资料"),
    re.compile(r"^\s*来源[:：]"),
    re.compile(r"^\s*版本[:：]"),
    re.compile(r"^\s*整理(稿|者)[:：]"),
    re.compile(r"仅用于本项目验证"),
)


def _strip_markdown_inline(text: str) -> str:
    """Drop residual markdown markers inside a single sentence."""
    text = re.sub(r"`{1,3}([^`]+)`{1,3}", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"^\s*[*\-+]\s+", "", text)
    text = re.sub(r"^\s*\d+[\.、)]\s+", "", text)
    # collapse internal whitespace runs (incl. cross-line gaps from list flows)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


_NUMBERED_LIST_PREFIX = re.compile(r"^(\s*)\d+[\.、)]\s+")
_BULLET_PREFIX = re.compile(r"^(\s*)[*\-+]\s+")


def _clean_material_text(raw: str) -> str:
    """Drop / rewrite lines that are pure markdown chrome before sentence split.

    - drop heading lines starting with `#`
    - drop blockquote lines starting with `>`
    - drop horizontal rules `---`
    - drop bare numbering ("1." on its own line)
    - drop lines containing meta phrases (`pilot 资料`, `来源:`, ...)
    - strip "1. " / "- " list prefixes so they don't bleed into FactCards or
      get mistaken for sentence terminators downstream
    """
    kept: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            kept.append("")
            continue
        if any(p.search(stripped) for p in _META_LINE_PATTERNS[:2]):
            continue
        if _META_LINE_PATTERNS[3].match(stripped):
            continue
        if _META_LINE_PATTERNS[4].match(stripped):
            continue
        if any(p.search(stripped) for p in _META_PHRASE_PATTERNS):
            continue
        line = _NUMBERED_LIST_PREFIX.sub(r"\1", line)
        line = _BULLET_PREFIX.sub(r"\1", line)
        kept.append(line)
    return "\n".join(kept)


def _is_acceptable_sentence(sent: str) -> bool:
    """Reject metadata-y, too-short, or punctuation-only fragments.

    Threshold 10 is calibrated against the pilot materials (≥10 chars filters
    out things like "工序如下：" / "1." while still keeping short factual
    sentences such as "拉坯先粗坯，再修坯。").
    """
    s = sent.strip()
    if len(s) < 10:
        return False
    if any(p.search(s) for p in _META_PHRASE_PATTERNS):
        return False
    # Must contain at least 6 CJK / alphabetic chars to count as a real fact.
    if len(re.findall(r"[A-Za-z一-鿿]", s)) < 6:
        return False
    return True


def _local_fallback_extract(materials: list[dict[str, Any]], brief: str) -> dict[str, Any]:
    """Deterministic extractor used when the model cannot produce JSON.

    Cleans markdown chrome (headings, blockquotes, numbering, source lines)
    BEFORE sentence splitting, then drops fragments shorter than 12 chars or
    that are metadata in disguise. Each surviving sentence becomes a
    low-confidence FactCard so the rest of the pipeline can run offline.
    """
    fact_cards: list[dict[str, Any]] = []
    entities: list[dict[str, Any]] = []
    seen_entities: set[str] = set()
    relations: list[dict[str, Any]] = []

    for m in materials:
        content = m.get("content", "")
        if not content:
            continue
        cleaned = _clean_material_text(content)
        # Split on Chinese sentence-final punctuation only. We deliberately
        # do NOT include `.` because Chinese pilot materials use it almost
        # exclusively inside numeric prefixes ("1.", "2.") and decimals.
        sentences = re.split(r"(?<=[。!?])\s*", cleaned.strip())
        cursor = 0
        for raw_sent in sentences:
            sent = _strip_markdown_inline(raw_sent)
            if not _is_acceptable_sentence(sent):
                cursor += len(raw_sent) + 1
                continue
            # Re-locate inside the ORIGINAL text so source_span points to
            # what the user uploaded, not the cleaned variant.
            start = content.find(sent, cursor)
            if start < 0:
                # try a 20-char prefix (sentence may have been re-flowed)
                start = content.find(sent[:20]) if len(sent) >= 20 else -1
            if start < 0:
                start = cursor
            end = start + len(sent)
            cursor = max(cursor, end)
            fact_cards.append(
                {
                    "fact_id": new_id("fc"),
                    "topic": (brief[:40] or "未命名").strip(),
                    "category": _guess_category(sent),
                    "content": sent[:200],
                    "confidence": 0.45,
                    "source_span": {"start": start, "end": end, "hash": text_sha256(sent)},
                    "needs_review": True,
                }
            )

        for word in re.findall(r"[A-Za-z一-鿿]{2,}", content):
            if word not in seen_entities and _looks_like_entity(word):
                seen_entities.add(word)
                entities.append(
                    {
                        "entity_type": "concept",
                        "name": word,
                        "description": "",
                        "confidence": 0.3,
                    }
                )
                if len(entities) >= 30:
                    break

    return {"fact_cards": fact_cards[:30], "entities": entities[:30], "relations": relations}


def _guess_category(sentence: str) -> str:
    if any(k in sentence for k in ["步骤", "工序", "先", "再", "然后", "最后"]):
        return "craft_step"
    if any(k in sentence for k in ["传承", "起源", "始于", "明代", "清代", "唐代", "宋代"]):
        return "history"
    if any(k in sentence for k in ["材料", "瓷土", "丝", "颜料", "釉"]):
        return "material"
    if any(k in sentence for k in ["工具", "笔", "刀", "针", "梭"]):
        return "tool"
    return "history"


def _looks_like_entity(word: str) -> bool:
    return any(k in word for k in ["瓷", "绣", "脸", "戏", "窑", "坯", "釉", "针", "线", "脸谱"])


def _parse_culture_review(text: str) -> dict[str, dict[str, Any]]:
    text = _strip_json_fence(text)
    try:
        data = json.loads(text)
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    if isinstance(data, list):
        for r in data:
            if isinstance(r, dict) and r.get("fact_id"):
                out[r["fact_id"]] = {
                    "status": r.get("status", "ok"),
                    "note": r.get("note", ""),
                }
    return out


def _persist(project_id: str, extracted: dict[str, Any]) -> dict[str, list[str]]:
    fact_card_ids: list[str] = []
    entity_ids: list[str] = []
    relation_ids: list[str] = []
    name_to_entity: dict[str, str] = {}
    now = datetime.now(timezone.utc)

    with session_scope() as session:
        for fc in extracted["fact_cards"]:
            fc_id = fc["fact_id"]
            session.add(
                FactCard(
                    id=fc_id,
                    project_id=project_id,
                    topic=fc.get("topic", ""),
                    category=fc.get("category", ""),
                    content=fc.get("content", ""),
                    confidence=float(fc.get("confidence", 0.0)),
                    source_span=fc.get("source_span") or {},
                    culture_review=fc.get("culture_review") or {},
                    review_status="needs_review" if fc.get("needs_review") else "pending",
                    created_at=now,
                    updated_at=now,
                )
            )
            fact_card_ids.append(fc_id)

        for ent in extracted.get("entities", []):
            if not isinstance(ent, dict):
                continue
            ent_id = ent.get("id") or new_id("ent")
            name_to_entity[ent.get("name", "")] = ent_id
            session.add(
                Entity(
                    id=ent_id,
                    project_id=project_id,
                    entity_type=ent.get("entity_type", "concept"),
                    name=ent.get("name", ""),
                    description=ent.get("description", ""),
                    confidence=float(ent.get("confidence", 0.0)),
                    source_span=ent.get("source_span") or {},
                    review_status="pending",
                    created_at=now,
                )
            )
            entity_ids.append(ent_id)

        for rel in extracted.get("relations", []):
            if not isinstance(rel, dict):
                continue
            src = name_to_entity.get(rel.get("source", ""))
            tgt = name_to_entity.get(rel.get("target", ""))
            if not src or not tgt:
                continue
            rel_id = new_id("rel")
            session.add(
                Relation(
                    id=rel_id,
                    project_id=project_id,
                    relation_type=rel.get("relation_type", "appears_in"),
                    source_entity_id=src,
                    target_entity_id=tgt,
                    confidence=float(rel.get("confidence", 0.0)),
                    source_span=rel.get("source_span") or {},
                    review_status="pending",
                    created_at=now,
                )
            )
            relation_ids.append(rel_id)

    return {
        "fact_card_ids": fact_card_ids,
        "entity_ids": entity_ids,
        "relation_ids": relation_ids,
    }
