"""Standard workflow definitions and registration.

Documentary default: research -> writer -> storyboard -> review.

Real agents are wired in M2. M1 registers a stub workflow that uses BaseAgent
so end-to-end run/pause/resume/rerun mechanics can be exercised.
"""

from __future__ import annotations

from server.agents.base import Agent, AgentInput, AgentOutput, BaseAgent, Plan, PlannedSubstep
from server.engine.events import StepEmitter
from server.engine.graph_run import WorkflowDef, register_workflow


class _DemoAgent(BaseAgent):
    """A no-op agent that emits a few events so M1 SSE/UI can be exercised."""

    def __init__(self, name: str) -> None:
        self.name = name

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(
            substeps=[
                PlannedSubstep(name="prepare", description="prepare context"),
                PlannedSubstep(name="execute", description="execute main logic"),
                PlannedSubstep(name="finalize", description="emit artifacts"),
            ]
        )

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:
        emitter.progress(f"{self.name}: prepare context", visibility="detail")
        emitter.tool_call(tool="noop", input_summary="upstream keys=" + ",".join(agent_input.upstream.keys()) or "(none)")
        emitter.tool_result(tool="noop", output_summary="ok")
        emitter.progress(f"{self.name}: emit demo artifact", visibility="detail")
        emitter.artifact(kind="demo", ref=f"{self.name}-artifact-1", summary="placeholder artifact")
        emitter.finish(f"{self.name} demo finished")
        return AgentOutput(
            summary=f"{self.name} demo ran successfully",
            artifacts=[{"kind": "demo", "ref": f"{self.name}-artifact-1"}],
            data={"demo": True, "agent": self.name},
        )


def _make_demo(name: str):
    def _factory() -> Agent:
        return _DemoAgent(name)

    return _factory


def register_default_workflows() -> None:
    register_workflow(
        WorkflowDef(
            name="documentary_default",
            steps=[
                ("research", _make_demo("research")),
                ("writer", _make_demo("writer")),
                ("storyboard", _make_demo("storyboard")),
                ("review", _make_demo("review")),
            ],
        )
    )


# Register on import so FastAPI lifespan picks them up.
register_default_workflows()
