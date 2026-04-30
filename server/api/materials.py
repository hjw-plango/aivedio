"""Material API: attach raw input data (text or uploaded file) to a project.

For P0:
  - text paste: POST /api/projects/{project_id}/materials with JSON body
  - file upload: POST /api/projects/{project_id}/materials/upload (multipart)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from server.data.asset_store import store_file
from server.data.models import Material, Project
from server.data.session import session_scope
from server.utils.hashing import text_sha256
from server.utils.ids import new_id

router = APIRouter(prefix="/api/projects/{project_id}/materials", tags=["materials"])


class MaterialCreate(BaseModel):
    content: str = Field(min_length=1)
    source_type: str = "text"
    source_url: str | None = None


class MaterialOut(BaseModel):
    id: str
    project_id: str
    source_type: str
    source_url: str | None
    file_path: str | None
    file_hash: str | None
    content: str
    version: int
    created_at: datetime


def _to_out(m: Material) -> MaterialOut:
    return MaterialOut(
        id=m.id,
        project_id=m.project_id,
        source_type=m.source_type,
        source_url=m.source_url,
        file_path=m.file_path,
        file_hash=m.file_hash,
        content=m.content,
        version=m.version,
        created_at=m.created_at,
    )


def _ensure_project(project_id: str) -> None:
    with session_scope() as session:
        if not session.get(Project, project_id):
            raise HTTPException(status_code=404, detail="project_not_found")


@router.post("", response_model=MaterialOut)
def create_text_material(project_id: str, payload: MaterialCreate) -> MaterialOut:
    _ensure_project(project_id)
    now = datetime.now(timezone.utc)
    material = Material(
        id=new_id("mat"),
        project_id=project_id,
        source_type=payload.source_type,
        source_url=payload.source_url,
        content=payload.content,
        file_hash=text_sha256(payload.content),
        version=1,
        created_at=now,
    )
    with session_scope() as session:
        session.add(material)
        session.flush()
        return _to_out(material)


@router.get("", response_model=list[MaterialOut])
def list_materials(project_id: str) -> list[MaterialOut]:
    _ensure_project(project_id)
    with session_scope() as session:
        rows = (
            session.query(Material)
            .filter(Material.project_id == project_id)
            .order_by(Material.created_at)
            .all()
        )
        return [_to_out(m) for m in rows]


_ALLOWED_MATERIAL_SUFFIXES = {"txt", "md", "json", "csv", "pdf", "png", "jpg", "jpeg", "webp"}
_TEXT_SUFFIXES = {"txt", "md", "json", "csv"}
_MAX_MATERIAL_BYTES = 50 * 1024 * 1024  # 50MB; reference materials, not video


@router.post("/upload", response_model=MaterialOut)
async def upload_material(project_id: str, file: UploadFile = File(...)) -> MaterialOut:
    _ensure_project(project_id)
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing_filename")

    suffix = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if suffix not in _ALLOWED_MATERIAL_SUFFIXES:
        raise HTTPException(status_code=400, detail="unsupported_material_format")

    body_bytes = await file.read()
    if len(body_bytes) > _MAX_MATERIAL_BYTES:
        raise HTTPException(status_code=413, detail="file_too_large")
    text_content = ""
    if suffix in _TEXT_SUFFIXES:
        try:
            text_content = body_bytes.decode("utf-8", errors="replace")
        except Exception:
            text_content = ""

    import os
    import tempfile

    tmp = tempfile.NamedTemporaryFile(delete=False)
    target_name = f"material_{new_id()}.{suffix}"
    try:
        tmp.write(body_bytes)
        tmp.close()
        # Server-issued name; user-provided filename is never used as a
        # path segment (defends against ../, NUL, unicode tricks).
        stored = store_file(project_id, "materials", tmp.name, target_name)
    finally:
        try:
            os.remove(tmp.name)
        except OSError:
            pass

    now = datetime.now(timezone.utc)
    material = Material(
        id=new_id("mat"),
        project_id=project_id,
        source_type="upload",
        source_url=None,
        file_path=stored.file_path,
        file_hash=stored.file_hash,
        content=text_content,
        version=1,
        created_at=now,
    )
    with session_scope() as session:
        session.add(material)
        session.flush()
        return _to_out(material)
