"""Stream local asset files (so the frontend <video>/<img> can render them).

P0 keeps assets on local disk; this router provides safe-by-path serving
restricted to the configured assets directory.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from server.settings import get_settings

router = APIRouter(tags=["files"])


@router.get("/api/files")
def get_file(path: str) -> FileResponse:
    assets_dir = get_settings().assets_dir.resolve()
    target = Path(path).resolve()
    try:
        target.relative_to(assets_dir)
    except ValueError:
        raise HTTPException(status_code=403, detail="path_outside_assets")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file_not_found")
    return FileResponse(str(target))
