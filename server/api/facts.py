"""FactCard / Entity / Relation API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.data.models import Entity, FactCard, Relation
from server.data.session import session_scope

router = APIRouter(prefix="/api/projects/{project_id}", tags=["facts"])


class FactCardOut(BaseModel):
    id: str
    project_id: str
    topic: str
    category: str
    content: str
    confidence: float
    source_span: dict[str, Any]
    culture_review: dict[str, Any]
    review_status: str
    version: int
    created_at: datetime
    updated_at: datetime


class FactCardPatch(BaseModel):
    topic: str | None = None
    category: str | None = None
    content: str | None = None
    confidence: float | None = None
    review_status: str | None = None


class EntityOut(BaseModel):
    id: str
    project_id: str
    entity_type: str
    name: str
    description: str
    confidence: float
    review_status: str


class RelationOut(BaseModel):
    id: str
    project_id: str
    relation_type: str
    source_entity_id: str
    target_entity_id: str
    confidence: float
    review_status: str


def _fc_out(fc: FactCard) -> FactCardOut:
    return FactCardOut(
        id=fc.id,
        project_id=fc.project_id,
        topic=fc.topic or "",
        category=fc.category or "",
        content=fc.content or "",
        confidence=float(fc.confidence or 0.0),
        source_span=fc.source_span or {},
        culture_review=fc.culture_review or {},
        review_status=fc.review_status,
        version=fc.version,
        created_at=fc.created_at,
        updated_at=fc.updated_at,
    )


@router.get("/facts", response_model=list[FactCardOut])
def list_facts(project_id: str, category: str | None = None, q: str | None = None) -> list[FactCardOut]:
    with session_scope() as session:
        query = session.query(FactCard).filter(FactCard.project_id == project_id)
        if category:
            query = query.filter(FactCard.category == category)
        if q:
            query = query.filter(FactCard.content.contains(q))
        rows = query.order_by(FactCard.created_at).all()
        return [_fc_out(fc) for fc in rows]


@router.patch("/facts/{fact_id}", response_model=FactCardOut)
def update_fact(project_id: str, fact_id: str, payload: FactCardPatch) -> FactCardOut:
    with session_scope() as session:
        fc = session.get(FactCard, fact_id)
        if not fc or fc.project_id != project_id:
            raise HTTPException(status_code=404, detail="fact_not_found")
        if payload.topic is not None:
            fc.topic = payload.topic
        if payload.category is not None:
            fc.category = payload.category
        if payload.content is not None:
            fc.content = payload.content
            fc.version += 1
        if payload.confidence is not None:
            fc.confidence = payload.confidence
        if payload.review_status is not None:
            fc.review_status = payload.review_status
        session.flush()
        return _fc_out(fc)


@router.get("/entities", response_model=list[EntityOut])
def list_entities(project_id: str) -> list[EntityOut]:
    with session_scope() as session:
        rows = (
            session.query(Entity)
            .filter(Entity.project_id == project_id)
            .order_by(Entity.created_at)
            .all()
        )
        return [
            EntityOut(
                id=e.id,
                project_id=e.project_id,
                entity_type=e.entity_type,
                name=e.name,
                description=e.description or "",
                confidence=float(e.confidence or 0.0),
                review_status=e.review_status,
            )
            for e in rows
        ]


@router.get("/relations", response_model=list[RelationOut])
def list_relations(project_id: str) -> list[RelationOut]:
    with session_scope() as session:
        rows = (
            session.query(Relation)
            .filter(Relation.project_id == project_id)
            .order_by(Relation.created_at)
            .all()
        )
        return [
            RelationOut(
                id=r.id,
                project_id=r.project_id,
                relation_type=r.relation_type,
                source_entity_id=r.source_entity_id,
                target_entity_id=r.target_entity_id,
                confidence=float(r.confidence or 0.0),
                review_status=r.review_status,
            )
            for r in rows
        ]
