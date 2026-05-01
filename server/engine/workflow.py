"""Standard workflow definitions and registration.

Documentary default: research -> writer -> memory -> storyboard -> review.
"""

from __future__ import annotations

from server.agents.research import ResearchAgent
from server.agents.review import ReviewAgent
from server.agents.storyboard import StoryboardAgent
from server.agents.writer import WriterAgent
from server.agents.memory import MemoryAgent
from server.engine.graph_run import WorkflowDef, register_workflow


def register_default_workflows() -> None:
    register_workflow(
        WorkflowDef(
            name="documentary_default",
            steps=[
                ("research", lambda: ResearchAgent(direction="documentary")),
                ("writer", lambda: WriterAgent(direction="documentary")),
                ("memory", lambda: MemoryAgent()),
                ("storyboard", lambda: StoryboardAgent(direction="documentary")),
                ("review", lambda: ReviewAgent(direction="documentary")),
            ],
        )
    )


# Register on import so FastAPI lifespan picks them up.
register_default_workflows()
