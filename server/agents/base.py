"""Base Agent protocol.

Every agent must implement plan() + run() and accept a StepEmitter. Concrete
agents live under server/agents/{research,writer,storyboard,review}.py.

Run input/output are typed as dicts for P0 — full schemas are documented in
the per-agent prompt files under configs/.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from server.engine.events import StepEmitter


@dataclass
class AgentInput:
    project_id: str
    graph_run_id: str
    payload: dict[str, Any] = field(default_factory=dict)
    upstream: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentOutput:
    summary: str
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass
class PlannedSubstep:
    name: str
    description: str = ""


@dataclass
class Plan:
    substeps: list[PlannedSubstep]


class Agent(Protocol):
    name: str
    version: str

    def plan(self, agent_input: AgentInput) -> Plan: ...

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput: ...


class BaseAgent:
    """Minimal default implementation Agents can subclass."""

    name: str = "base"
    version: str = "0.1.0"

    def plan(self, agent_input: AgentInput) -> Plan:  # noqa: ARG002
        return Plan(substeps=[PlannedSubstep(name="run", description="single-step agent")])

    def run(self, agent_input: AgentInput, emitter: StepEmitter) -> AgentOutput:  # noqa: ARG002
        emitter.progress(f"{self.name} v{self.version} starting")
        emitter.finish("noop")
        return AgentOutput(summary="noop")
