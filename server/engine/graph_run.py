"""GraphRun engine.

Orchestrates the documentary workflow: research -> writer -> storyboard ->
review. Each agent runs in its own Step. Steps support pause/resume/rerun
with parent_step_id chaining.

P0 design: synchronous, single-user. Long-running runs execute in a worker
thread so the FastAPI request returns quickly and SSE consumers can attach.
"""

from __future__ import annotations

import threading
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from server.agents.base import Agent, AgentInput, AgentOutput
from server.data.models import GraphRun, Step
from server.data.session import session_scope
from server.engine.events import StepEmitter, broadcaster
from server.utils.ids import new_id


WorkflowFactory = Callable[[], list[tuple[str, Agent]]]


@dataclass
class WorkflowDef:
    """Static workflow: an ordered list of (step_name, agent_factory)."""

    name: str
    steps: list[tuple[str, Callable[[], Agent]]]


_WORKFLOWS: dict[str, WorkflowDef] = {}


def register_workflow(workflow: WorkflowDef) -> None:
    _WORKFLOWS[workflow.name] = workflow


def get_workflow(name: str) -> WorkflowDef:
    if name not in _WORKFLOWS:
        raise KeyError(f"unknown workflow: {name}")
    return _WORKFLOWS[name]


def list_workflows() -> list[str]:
    return sorted(_WORKFLOWS.keys())


# --- Run state machine ---


def create_run(project_id: str, workflow_name: str, auto_mode: bool = False) -> str:
    workflow = get_workflow(workflow_name)
    run_id = new_id("run")
    now = datetime.now(timezone.utc)
    with session_scope() as session:
        session.add(
            GraphRun(
                id=run_id,
                project_id=project_id,
                workflow=workflow_name,
                status="pending",
                auto_mode=auto_mode,
                created_at=now,
            )
        )
        for seq, (step_name, _factory) in enumerate(workflow.steps):
            session.add(
                Step(
                    id=new_id("st"),
                    graph_run_id=run_id,
                    agent_name=step_name,
                    step_name=step_name,
                    status="pending",
                    sequence=seq,
                    created_at=now,
                )
            )
    return run_id


def _run_step(
    step_id: str,
    agent: Agent,
    upstream: dict[str, Any],
    project_id: str,
    graph_run_id: str,
    extra_input: dict[str, Any] | None = None,
) -> AgentOutput:
    emitter = StepEmitter(step_id=step_id, graph_run_id=graph_run_id, agent_name=agent.name)
    agent_input = AgentInput(
        project_id=project_id,
        graph_run_id=graph_run_id,
        payload=extra_input or {},
        upstream=upstream,
    )
    plan = agent.plan(agent_input)
    emitter.emit(
        "progress_note",
        {
            "note": f"plan: {len(plan.substeps)} substeps",
            "substeps": [{"name": s.name, "description": s.description} for s in plan.substeps],
        },
        visibility="detail",
    )
    output = agent.run(agent_input, emitter)
    return output


def execute_run(graph_run_id: str, initial_input: dict[str, Any] | None = None) -> None:
    """Synchronously execute pending steps. Stops at first non-success step
    (failed/rejected/paused). Caller can call resume_run() to continue.
    """
    with session_scope() as session:
        run = session.get(GraphRun, graph_run_id)
        if not run:
            raise KeyError(f"run not found: {graph_run_id}")
        run.status = "running"
        run.started_at = run.started_at or datetime.now(timezone.utc)
        workflow = get_workflow(run.workflow)
        project_id = run.project_id
        auto_mode = run.auto_mode

    factories = {step_name: factory for step_name, factory in workflow.steps}
    upstream: dict[str, Any] = dict(initial_input or {})

    while True:
        with session_scope() as session:
            next_step = (
                session.query(Step)
                .filter(Step.graph_run_id == graph_run_id, Step.status == "pending")
                .order_by(Step.sequence)
                .first()
            )
            if not next_step:
                run = session.get(GraphRun, graph_run_id)
                if run:
                    run.status = "success"
                    run.finished_at = datetime.now(timezone.utc)
                return
            step_id = next_step.id
            step_name = next_step.step_name
            next_step.status = "running"

        agent = factories[step_name]()
        try:
            output = _run_step(
                step_id=step_id,
                agent=agent,
                upstream=upstream,
                project_id=project_id,
                graph_run_id=graph_run_id,
            )
        except Exception as exc:
            tb = traceback.format_exc()
            with session_scope() as session:
                step = session.get(Step, step_id)
                if step:
                    step.status = "failed"
                    step.error = f"{exc}\n{tb}"
                    step.finished_at = datetime.now(timezone.utc)
                run = session.get(GraphRun, graph_run_id)
                if run:
                    run.status = "failed"
                    run.finished_at = datetime.now(timezone.utc)
            return

        with session_scope() as session:
            step = session.get(Step, step_id)
            if step:
                step.status = "success"
                step.output_summary = output.summary[:1000]
                step.artifact_refs = [a.get("ref") for a in output.artifacts if a.get("ref")]
                step.warnings = [{"message": w} for w in output.warnings]
                step.finished_at = datetime.now(timezone.utc)

        upstream = {**upstream, step_name: output.data, f"{step_name}_summary": output.summary}

        if not auto_mode:
            with session_scope() as session:
                run = session.get(GraphRun, graph_run_id)
                if run:
                    run.status = "paused"
            broadcaster.publish(
                [f"run:{graph_run_id}"],
                _make_run_event(graph_run_id, "paused", step_name=step_name),
            )
            return


def resume_run(graph_run_id: str) -> None:
    with session_scope() as session:
        run = session.get(GraphRun, graph_run_id)
        if not run:
            raise KeyError(f"run not found: {graph_run_id}")
        run.status = "running"
    execute_run(graph_run_id)


def execute_run_async(graph_run_id: str, initial_input: dict[str, Any] | None = None) -> None:
    """Run the workflow on a background thread. Returns immediately."""
    thread = threading.Thread(
        target=execute_run, args=(graph_run_id,), kwargs={"initial_input": initial_input}, daemon=True
    )
    thread.start()


def rerun_step(step_id: str) -> str:
    """Create a new Step copying agent_name + sequence, with parent_step_id set.
    Marks the new step pending; caller can call execute_run() to drive it.
    """
    with session_scope() as session:
        step = session.get(Step, step_id)
        if not step:
            raise KeyError(f"step not found: {step_id}")
        new_step_id = new_id("st")
        session.add(
            Step(
                id=new_step_id,
                graph_run_id=step.graph_run_id,
                parent_step_id=step.id,
                agent_name=step.agent_name,
                step_name=step.step_name,
                sequence=step.sequence,
                status="pending",
                retry_count=step.retry_count + 1,
                created_at=datetime.now(timezone.utc),
            )
        )
        # mark previous step status to allow rerun (if it was failed/rejected/success)
        run = session.get(GraphRun, step.graph_run_id)
        if run:
            run.status = "pending"
            run.finished_at = None
    return new_step_id


def _make_run_event(graph_run_id: str, status: str, step_name: str | None = None):
    from server.engine.events import EmittedEvent

    return EmittedEvent(
        id=new_id("ev"),
        step_id="",
        event_type="progress_note",
        visibility="summary",
        payload={
            "scope": "run",
            "run_id": graph_run_id,
            "status": status,
            "step": step_name,
        },
        created_at=datetime.now(timezone.utc),
    )
