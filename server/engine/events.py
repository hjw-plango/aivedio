"""StepEmitter and event types.

The emitter is the single canonical way an Agent reports progress. Every
event is persisted to step_events and broadcast to in-process SSE listeners.

Event types:
- progress_note: short public-readable summary of what the agent is doing now.
                 NOT raw model thinking.
- tool_call:     agent invoked a tool (model call, retrieval, image gen).
- tool_result:   tool returned, with summary payload.
- artifact:      a visible artifact produced (FactCard, prompt, image, ...).
- warning:       non-fatal issue.
- error:         fatal error (will mark step failed).
- finish:        step completed successfully.

Visibility:
- detail / summary / hidden — controls default UI rendering. Storage is always
  full-fidelity; visibility only affects what the frontend chooses to show by
  default. Switching visibility never deletes data.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from server.data.models import StepEvent
from server.data.session import session_scope
from server.utils.ids import new_id


EventType = Literal[
    "progress_note",
    "tool_call",
    "tool_result",
    "artifact",
    "warning",
    "error",
    "finish",
]
Visibility = Literal["detail", "summary", "hidden"]


@dataclass
class EmittedEvent:
    id: str
    step_id: str
    event_type: EventType
    visibility: Visibility
    payload: dict[str, Any]
    created_at: datetime


class _Broadcaster:
    """In-memory pub/sub for SSE.

    A single process is fine for P0 single-user. P1 may switch to Redis.
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[EmittedEvent]]] = {}

    def subscribe(self, channel: str) -> asyncio.Queue[EmittedEvent]:
        queue: asyncio.Queue[EmittedEvent] = asyncio.Queue(maxsize=1024)
        self._subscribers.setdefault(channel, set()).add(queue)
        return queue

    def unsubscribe(self, channel: str, queue: asyncio.Queue[EmittedEvent]) -> None:
        subs = self._subscribers.get(channel)
        if subs and queue in subs:
            subs.remove(queue)
            if not subs:
                self._subscribers.pop(channel, None)

    def publish(self, channels: list[str], event: EmittedEvent) -> None:
        for ch in channels:
            for q in list(self._subscribers.get(ch, [])):
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    pass


broadcaster = _Broadcaster()


class StepEmitter:
    """Adapter passed to an Agent's run() method."""

    def __init__(self, step_id: str, graph_run_id: str, agent_name: str) -> None:
        self.step_id = step_id
        self.graph_run_id = graph_run_id
        self.agent_name = agent_name

    def emit(
        self,
        event_type: EventType,
        payload: dict[str, Any] | None = None,
        visibility: Visibility = "summary",
    ) -> EmittedEvent:
        event_id = new_id("ev")
        now = datetime.now(timezone.utc)
        body = dict(payload or {})
        body.setdefault("agent_name", self.agent_name)
        with session_scope() as session:
            session.add(
                StepEvent(
                    id=event_id,
                    step_id=self.step_id,
                    event_type=event_type,
                    visibility=visibility,
                    payload=body,
                    created_at=now,
                )
            )
        event = EmittedEvent(
            id=event_id,
            step_id=self.step_id,
            event_type=event_type,
            visibility=visibility,
            payload=body,
            created_at=now,
        )
        broadcaster.publish(
            channels=[f"run:{self.graph_run_id}", f"step:{self.step_id}"],
            event=event,
        )
        return event

    def progress(self, note: str, visibility: Visibility = "detail") -> EmittedEvent:
        return self.emit("progress_note", {"note": note}, visibility)

    def tool_call(
        self,
        tool: str,
        input_summary: str,
        visibility: Visibility = "detail",
    ) -> EmittedEvent:
        return self.emit("tool_call", {"tool": tool, "input": input_summary}, visibility)

    def tool_result(
        self,
        tool: str,
        output_summary: str,
        visibility: Visibility = "detail",
    ) -> EmittedEvent:
        return self.emit("tool_result", {"tool": tool, "output": output_summary}, visibility)

    def artifact(
        self,
        kind: str,
        ref: str,
        summary: str = "",
        visibility: Visibility = "summary",
    ) -> EmittedEvent:
        return self.emit(
            "artifact",
            {"kind": kind, "ref": ref, "summary": summary},
            visibility,
        )

    def warning(self, message: str, visibility: Visibility = "summary") -> EmittedEvent:
        return self.emit("warning", {"message": message}, visibility)

    def error(self, message: str, visibility: Visibility = "summary") -> EmittedEvent:
        return self.emit("error", {"message": message}, visibility)

    def finish(self, output_summary: str, visibility: Visibility = "summary") -> EmittedEvent:
        return self.emit("finish", {"output": output_summary}, visibility)
