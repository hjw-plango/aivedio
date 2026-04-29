"""Shot + ShotAsset API.

Powers M3/M4 frontend pages:
  - GET  /api/projects/{pid}/shots — list shots with their grouped assets
  - PATCH /api/shots/{shot_id} — manual adjustments (subject/composition/etc)
  - GET  /api/projects/{pid}/assets — flat asset list (filterable)
  - PATCH /api/assets/{asset_id} — update score/status/notes/rights/failure_tags
  - DELETE /api/assets/{asset_id} — soft delete (move to assets/.trash)
"""

from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.data.models import Shot, ShotAsset
from server.data.session import session_scope
from server.settings import get_settings

router = APIRouter(tags=["shots-assets"])


class ShotPatch(BaseModel):
    shot_type: str | None = None
    subject: str | None = None
    composition: str | None = None
    camera_motion: str | None = None
    lighting: str | None = None
    duration_estimate: float | None = None
    requires_real_footage: bool | None = None


class AssetPatch(BaseModel):
    status: str | None = Field(default=None, pattern=r"^(draft|accepted|rejected)$")
    score: float | None = None
    failure_tags: list[str] | None = None
    notes: str | None = None
    rights: dict[str, Any] | None = None
    meta: dict[str, Any] | None = None


class ShotOut(BaseModel):
    id: str
    project_id: str
    sequence: int
    shot_type: str
    subject: str
    composition: str
    camera_motion: str
    lighting: str
    duration_estimate: float
    narration: str
    requires_real_footage: bool
    fact_refs: list[str]
    assets: list[dict[str, Any]]


def _shot_with_assets(shot: Shot, assets: list[ShotAsset]) -> ShotOut:
    return ShotOut(
        id=shot.id,
        project_id=shot.project_id,
        sequence=shot.sequence,
        shot_type=shot.shot_type or "",
        subject=shot.subject or "",
        composition=shot.composition or "",
        camera_motion=shot.camera_motion or "",
        lighting=shot.lighting or "",
        duration_estimate=float(shot.duration_estimate or 0.0),
        narration=shot.narration or "",
        requires_real_footage=bool(shot.requires_real_footage),
        fact_refs=list(shot.fact_refs or []),
        assets=[_asset_dict(a) for a in assets],
    )


def _asset_dict(a: ShotAsset) -> dict[str, Any]:
    return {
        "id": a.id,
        "project_id": a.project_id,
        "shot_id": a.shot_id,
        "asset_type": a.asset_type,
        "version": a.version,
        "status": a.status,
        "prompt": a.prompt or "",
        "file_path": a.file_path,
        "file_hash": a.file_hash,
        "score": a.score,
        "failure_tags": list(a.failure_tags or []),
        "notes": a.notes or "",
        "rights": a.rights or {},
        "meta": a.meta or {},
        "created_at": a.created_at.isoformat(),
        "updated_at": a.updated_at.isoformat(),
    }


@router.get("/api/projects/{project_id}/shots", response_model=list[ShotOut])
def list_shots(project_id: str) -> list[ShotOut]:
    with session_scope() as session:
        shots = (
            session.query(Shot)
            .filter(Shot.project_id == project_id)
            .order_by(Shot.sequence)
            .all()
        )
        out: list[ShotOut] = []
        for shot in shots:
            assets = (
                session.query(ShotAsset)
                .filter(ShotAsset.shot_id == shot.id)
                .order_by(ShotAsset.asset_type, ShotAsset.version)
                .all()
            )
            out.append(_shot_with_assets(shot, assets))
        return out


@router.patch("/api/shots/{shot_id}", response_model=ShotOut)
def patch_shot(shot_id: str, payload: ShotPatch) -> ShotOut:
    with session_scope() as session:
        shot = session.get(Shot, shot_id)
        if not shot:
            raise HTTPException(status_code=404, detail="shot_not_found")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(shot, field, value)
        session.flush()
        assets = (
            session.query(ShotAsset)
            .filter(ShotAsset.shot_id == shot.id)
            .order_by(ShotAsset.asset_type, ShotAsset.version)
            .all()
        )
        return _shot_with_assets(shot, assets)


@router.get("/api/projects/{project_id}/assets")
def list_assets(
    project_id: str,
    asset_type: str | None = None,
    status: str | None = None,
    shot_id: str | None = None,
) -> list[dict[str, Any]]:
    with session_scope() as session:
        q = session.query(ShotAsset).filter(ShotAsset.project_id == project_id)
        if asset_type:
            q = q.filter(ShotAsset.asset_type == asset_type)
        if status:
            q = q.filter(ShotAsset.status == status)
        if shot_id:
            q = q.filter(ShotAsset.shot_id == shot_id)
        rows = q.order_by(ShotAsset.created_at.desc()).all()
        return [_asset_dict(a) for a in rows]


@router.patch("/api/assets/{asset_id}")
def patch_asset(asset_id: str, payload: AssetPatch) -> dict[str, Any]:
    with session_scope() as session:
        asset = session.get(ShotAsset, asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail="asset_not_found")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(asset, field, value)
        asset.updated_at = datetime.now(timezone.utc)
        session.flush()
        return _asset_dict(asset)


@router.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: str) -> dict[str, Any]:
    with session_scope() as session:
        asset = session.get(ShotAsset, asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail="asset_not_found")
        moved_to: str | None = None
        if asset.file_path:
            src = Path(asset.file_path)
            if src.exists():
                trash = get_settings().assets_dir / ".trash" / datetime.now(timezone.utc).strftime("%Y%m%d")
                trash.mkdir(parents=True, exist_ok=True)
                target = trash / f"{asset.id}_{src.name}"
                shutil.move(str(src), str(target))
                moved_to = str(target)
        session.delete(asset)
        return {"id": asset_id, "deleted": True, "moved_to": moved_to}
