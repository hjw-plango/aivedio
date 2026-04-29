"""GraphRun API: create / start / pause-resume / rerun / inspect."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from server.data.models import GraphRun, Step, StepEvent
from server.data.session import session_scope
from server.engine.events import broadcaster
from server.engine.graph_run import (
    create_run,
    execute_run_async,
    list_workflows,
    rerun_step,
    resume_run,
)

router = APIRouter(prefix="/api/runs", tags=["runs"])


class RunCreate(BaseModel):
    project_id: str
    workflow: str = Field(default="documentary_default")
    auto_mode: bool = False
    initial_input: dict[str, Any] = Field(default_factory=dict)


class StepOut(BaseModel):
    id: str
    graph_run_id: str
    parent_step_id: str | None
    agent_name: str
    step_name: str
    status: str
    sequence: int
    input_summary: str
    output_summary: str
    artifact_refs: list[str]
    warnings: list[dict[str, Any]]
    error: str | None
    retry_count: int
    created_at: datetime
    finished_at: datetime | None


class StepEventOut(BaseModel):
    id: str
    step_id: str
    event_type: str
    visibility: str
    payload: dict[str, Any]
    created_at: datetime


class RunOut(BaseModel):
    id: str
    project_id: str
    workflow: str
    status: str
    auto_mode: bool
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    steps: list[StepOut]


def _step_to_out(s: Step) -> StepOut:
    return StepOut(
        id=s.id,
        graph_run_id=s.graph_run_id,
        parent_step_id=s.parent_step_id,
        agent_name=s.agent_name,
        step_name=s.step_name,
        status=s.status,
        sequence=s.sequence,
        input_summary=s.input_summary or "",
        output_summary=s.output_summary or "",
        artifact_refs=list(s.artifact_refs or []),
        warnings=list(s.warnings or []),
        error=s.error,
        retry_count=s.retry_count,
        created_at=s.created_at,
        finished_at=s.finished_at,
    )


def _run_to_out(run: GraphRun, steps: list[Step]) -> RunOut:
    return RunOut(
        id=run.id,
        project_id=run.project_id,
        workflow=run.workflow,
        status=run.status,
        auto_mode=run.auto_mode,
        started_at=run.started_at,
        finished_at=run.finished_at,
        created_at=run.created_at,
        steps=[_step_to_out(s) for s in steps],
    )


@router.get("/workflows", response_model=list[str])
def workflows() -> list[str]:
    return list_workflows()


@router.post("", response_model=RunOut)
def create_run_endpoint(payload: RunCreate) -> RunOut:
    run_id = create_run(
        project_id=payload.project_id,
        workflow_name=payload.workflow,
        auto_mode=payload.auto_mode,
    )
    execute_run_async(run_id, payload.initial_input)
    return _get_run(run_id)


@router.get("", response_model=list[RunOut])
def list_runs(project_id: str | None = None) -> list[RunOut]:
    with session_scope() as session:
        query = session.query(GraphRun)
        if project_id:
            query = query.filter(GraphRun.project_id == project_id)
        runs = query.order_by(GraphRun.created_at.desc()).all()
        out: list[RunOut] = []
        for run in runs:
            steps = (
                session.query(Step)
                .filter(Step.graph_run_id == run.id)
                .order_by(Step.sequence, Step.created_at)
                .all()
            )
            out.append(_run_to_out(run, steps))
    return out


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: str) -> RunOut:
    return _get_run(run_id)


def _get_run(run_id: str) -> RunOut:
    with session_scope() as session:
        run = session.get(GraphRun, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run_not_found")
        steps = (
            session.query(Step)
            .filter(Step.graph_run_id == run_id)
            .order_by(Step.sequence, Step.created_at)
            .all()
        )
        return _run_to_out(run, steps)


@router.post("/{run_id}/resume", response_model=RunOut)
def resume(run_id: str) -> RunOut:
    with session_scope() as session:
        run = session.get(GraphRun, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run_not_found")
    import threading

    threading.Thread(target=resume_run, args=(run_id,), daemon=True).start()
    return _get_run(run_id)


class RerunRequest(BaseModel):
    step_id: str


@router.post("/{run_id}/rerun", response_model=RunOut)
def rerun(run_id: str, payload: RerunRequest) -> RunOut:
    rerun_step(payload.step_id)
    import threading

    threading.Thread(target=resume_run, args=(run_id,), daemon=True).start()
    return _get_run(run_id)


@router.get("/{run_id}/events", response_model=list[StepEventOut])
def list_events(run_id: str, since: int = 0) -> list[StepEventOut]:
    with session_scope() as session:
        steps = session.query(Step).filter(Step.graph_run_id == run_id).all()
        step_ids = [s.id for s in steps]
        if not step_ids:
            return []
        events = (
            session.query(StepEvent)
            .filter(StepEvent.step_id.in_(step_ids))
            .order_by(StepEvent.created_at)
            .offset(since)
            .all()
        )
        return [
            StepEventOut(
                id=e.id,
                step_id=e.step_id,
                event_type=e.event_type,
                visibility=e.visibility,
                payload=e.payload,
                created_at=e.created_at,
            )
            for e in events
        ]


@router.get("/{run_id}/stream")
async def stream(run_id: str, request: Request) -> EventSourceResponse:
    """SSE endpoint pushing live StepEvents for a graph run."""
    queue = broadcaster.subscribe(f"run:{run_id}")

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                yield {
                    "event": event.event_type,
                    "id": event.id,
                    "data": json.dumps(
                        {
                            "id": event.id,
                            "step_id": event.step_id,
                            "event_type": event.event_type,
                            "visibility": event.visibility,
                            "payload": event.payload,
                            "created_at": event.created_at.isoformat(),
                        },
                        ensure_ascii=False,
                    ),
                }
        finally:
            broadcaster.unsubscribe(f"run:{run_id}", queue)

    return EventSourceResponse(event_generator())
