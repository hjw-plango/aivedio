"""Video / image upload endpoints — Jimeng manual bridge.

User flow:
  1. Storyboard agent emits jimeng_video_prompt (text)
  2. User copies prompt into Jimeng web UI, generates video, downloads
  3. User uploads the .mp4 to /api/shots/{shot_id}/jimeng-video
  4. System stores file at jimeng_v{version}_score{score}.mp4 (score=0 until rated)
  5. User PATCHes score / failure_tags / notes; if score changes, file is
     renamed in place to embed the new score (F8.6).

Versioning + candidate cap (F8.2): each upload increments version under
(shot_id, asset_type). Non-rejected candidates per type are capped at
MAX_CANDIDATES_PER_TYPE; over the cap we return 409 with the active
candidate ids so the user can reject one first.
"""

from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from server.data.asset_store import store_file
from server.data.models import Shot, ShotAsset
from server.data.session import session_scope
from server.utils.ids import new_id

router = APIRouter(tags=["uploads"])

MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500MB per docs/requirements.md NF1
MAX_CANDIDATES_PER_TYPE = 3
ALLOWED_VIDEO_SUFFIXES = {"mp4", "mov", "mkv", "webm", "avi"}
ALLOWED_IMAGE_SUFFIXES = {"png", "jpg", "jpeg", "webp", "gif"}
# Whitelist of asset_type values accepted by the generic upload endpoint.
# Other types are emitted only by agents, never by direct upload.
ALLOWED_GENERIC_ASSET_TYPES = {"real_footage", "archive_footage", "reference_image"}


def _suffix_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _check_candidate_capacity(session, shot_id: str, asset_type: str) -> None:
    active = (
        session.query(ShotAsset)
        .filter(
            ShotAsset.shot_id == shot_id,
            ShotAsset.asset_type == asset_type,
            ShotAsset.status != "rejected",
        )
        .all()
    )
    if len(active) >= MAX_CANDIDATES_PER_TYPE:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "candidate_cap_reached",
                "limit": MAX_CANDIDATES_PER_TYPE,
                "candidate_ids": [a.id for a in active],
                "hint": "PATCH some assets to status=rejected first",
            },
        )


@router.post("/api/shots/{shot_id}/jimeng-video")
async def upload_jimeng_video(
    shot_id: str,
    file: UploadFile = File(...),
    notes: str = Form(""),
    aspect_ratio: str = Form("16:9"),
    duration_seconds: str = Form("5"),
) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing_filename")
    suffix = _suffix_of(file.filename)
    if suffix not in ALLOWED_VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="unsupported_video_format")

    with session_scope() as session:
        shot = session.get(Shot, shot_id)
        if not shot:
            raise HTTPException(status_code=404, detail="shot_not_found")
        project_id = shot.project_id
        _check_candidate_capacity(session, shot_id, "manual_jimeng_video")
        existing = (
            session.query(ShotAsset)
            .filter(ShotAsset.shot_id == shot_id, ShotAsset.asset_type == "manual_jimeng_video")
            .order_by(ShotAsset.version.desc())
            .first()
        )
        next_version = (existing.version + 1) if existing else 1

    body = await file.read()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="file_too_large")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{suffix}")
    try:
        tmp.write(body)
        tmp.close()
        # F8.6: jimeng_v{version}_score{score}.{suffix}; score=0 until rated.
        target_name = f"jimeng_v{next_version}_score0.{suffix}"
        stored = store_file(project_id, shot_id, tmp.name, target_name)
    finally:
        try:
            Path(tmp.name).unlink(missing_ok=True)
        except Exception:
            pass

    now = datetime.now(timezone.utc)
    asset_id = new_id("sa")
    with session_scope() as session:
        session.add(
            ShotAsset(
                id=asset_id,
                project_id=project_id,
                shot_id=shot_id,
                asset_type="manual_jimeng_video",
                version=next_version,
                status="draft",
                prompt="",
                file_path=stored.file_path,
                file_hash=stored.file_hash,
                score=None,
                failure_tags=[],
                notes=notes,
                rights={
                    "source_type": "ai_generated",
                    "source_platform": "jimeng",
                    "license": "platform_tos",
                    "creator": "user_uploaded",
                    "review_status": "pending",
                },
                meta={
                    "aspect_ratio": aspect_ratio,
                    "duration_seconds": int(duration_seconds) if duration_seconds.isdigit() else 5,
                    "size_bytes": stored.size_bytes,
                },
                created_at=now,
                updated_at=now,
            )
        )

    return {
        "id": asset_id,
        "shot_id": shot_id,
        "version": next_version,
        "file_path": stored.file_path,
        "file_hash": stored.file_hash,
        "size_bytes": stored.size_bytes,
    }


@router.post("/api/shots/{shot_id}/upload")
async def upload_generic_asset(
    shot_id: str,
    file: UploadFile = File(...),
    asset_type: str = Form(...),
    notes: str = Form(""),
    rights_holder: str = Form(""),
    license_type: str = Form("user_owned"),
) -> dict[str, Any]:
    """Generic upload for real_footage / archive_footage / reference_image."""
    if not asset_type or asset_type not in ALLOWED_GENERIC_ASSET_TYPES:
        raise HTTPException(status_code=400, detail="invalid_asset_type")
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing_filename")
    suffix = _suffix_of(file.filename) or "bin"
    expected_suffixes = (
        ALLOWED_IMAGE_SUFFIXES if asset_type == "reference_image" else ALLOWED_VIDEO_SUFFIXES
    )
    if suffix not in expected_suffixes:
        raise HTTPException(status_code=400, detail="unsupported_format_for_asset_type")

    with session_scope() as session:
        shot = session.get(Shot, shot_id)
        if not shot:
            raise HTTPException(status_code=404, detail="shot_not_found")
        project_id = shot.project_id
        _check_candidate_capacity(session, shot_id, asset_type)
        existing = (
            session.query(ShotAsset)
            .filter(ShotAsset.shot_id == shot_id, ShotAsset.asset_type == asset_type)
            .order_by(ShotAsset.version.desc())
            .first()
        )
        next_version = (existing.version + 1) if existing else 1

    body = await file.read()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="file_too_large")
    if not rights_holder and asset_type in {"real_footage", "archive_footage"}:
        raise HTTPException(status_code=400, detail="rights_holder_required_for_user_footage")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{suffix}")
    try:
        tmp.write(body)
        tmp.close()
        target_name = f"{asset_type}_v{next_version}.{suffix}"
        stored = store_file(project_id, shot_id, tmp.name, target_name)
    finally:
        try:
            Path(tmp.name).unlink(missing_ok=True)
        except Exception:
            pass

    now = datetime.now(timezone.utc)
    asset_id = new_id("sa")
    with session_scope() as session:
        session.add(
            ShotAsset(
                id=asset_id,
                project_id=project_id,
                shot_id=shot_id,
                asset_type=asset_type,
                version=next_version,
                status="draft",
                file_path=stored.file_path,
                file_hash=stored.file_hash,
                notes=notes,
                rights={
                    "source_type": "user_upload",
                    "source_platform": "user_upload",
                    "license": license_type,
                    "rights_holder": rights_holder,
                    "review_status": "pending",
                },
                meta={"size_bytes": stored.size_bytes},
                created_at=now,
                updated_at=now,
            )
        )
    return {"id": asset_id, "shot_id": shot_id, "version": next_version}
