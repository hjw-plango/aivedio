from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from server.data.models import Project
from server.data.session import session_scope
from server.utils.ids import new_id

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    direction: str = Field(default="documentary", pattern=r"^(documentary|drama|comic|general)$")
    brief: str = Field(default="", max_length=4000)


class ProjectOut(BaseModel):
    id: str
    title: str
    direction: str
    brief: str
    status: str
    created_at: datetime
    updated_at: datetime


def _to_out(p: Project) -> ProjectOut:
    return ProjectOut(
        id=p.id,
        title=p.title,
        direction=p.direction,
        brief=p.brief or "",
        status=p.status,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.post("", response_model=ProjectOut)
def create_project(payload: ProjectCreate) -> ProjectOut:
    now = datetime.now(timezone.utc)
    project = Project(
        id=new_id("prj"),
        title=payload.title,
        direction=payload.direction,
        brief=payload.brief,
        status="draft",
        created_at=now,
        updated_at=now,
    )
    with session_scope() as session:
        session.add(project)
        session.flush()
        return _to_out(project)


@router.get("", response_model=list[ProjectOut])
def list_projects() -> list[ProjectOut]:
    with session_scope() as session:
        rows = session.execute(select(Project).order_by(Project.created_at.desc())).scalars().all()
        return [_to_out(p) for p in rows]


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str) -> ProjectOut:
    with session_scope() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="project_not_found")
        return _to_out(project)
