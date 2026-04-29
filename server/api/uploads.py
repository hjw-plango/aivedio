"""Video / image upload endpoints — Jimeng manual bridge.

User flow:
  1. Storyboard agent emits jimeng_video_prompt (text)
  2. User copies prompt into Jimeng web UI, generates video, downloads
  3. User uploads the .mp4 to /api/shots/{shot_id}/jimeng-video
  4. System stores file, creates a manual_jimeng_video ShotAsset (status=draft)
  5. Optional: user fills score / failure_tags / notes via PATCH

Keeps versions: each upload increments version under the same shot_id.
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
    suffix = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if suffix not in {"mp4", "mov", "mkv", "webm", "avi"}:
        raise HTTPException(status_code=400, detail="unsupported_video_format")

    with session_scope() as session:
        shot = session.get(Shot, shot_id)
        if not shot:
            raise HTTPException(status_code=404, detail="shot_not_found")
        project_id = shot.project_id
        # next version
        existing = (
            session.query(ShotAsset)
            .filter(ShotAsset.shot_id == shot_id, ShotAsset.asset_type == "manual_jimeng_video")
            .order_by(ShotAsset.version.desc())
            .first()
        )
        next_version = (existing.version + 1) if existing else 1

    body = await file.read()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{suffix}")
    try:
        tmp.write(body)
        tmp.close()
        target_name = f"jimeng_v{next_version}.{suffix}"
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
    asset_type: str = Form("real_footage"),
    notes: str = Form(""),
    rights_holder: str = Form(""),
    license_type: str = Form("user_owned"),
) -> dict[str, Any]:
    """Generic upload for real_footage / archive_footage / reference_image."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing_filename")
    suffix = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"

    with session_scope() as session:
        shot = session.get(Shot, shot_id)
        if not shot:
            raise HTTPException(status_code=404, detail="shot_not_found")
        project_id = shot.project_id
        existing = (
            session.query(ShotAsset)
            .filter(ShotAsset.shot_id == shot_id, ShotAsset.asset_type == asset_type)
            .order_by(ShotAsset.version.desc())
            .first()
        )
        next_version = (existing.version + 1) if existing else 1

    body = await file.read()
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
