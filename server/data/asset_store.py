"""Local asset storage helpers. P0 only — local filesystem under assets/."""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException

from server.settings import get_settings
from server.utils.hashing import file_sha256


@dataclass
class StoredAsset:
    file_path: str
    file_hash: str
    size_bytes: int


# Identifiers (project_id, shot_id) come from server-issued ULIDs and a
# user-supplied filename. We allow only a strict subset to defeat path
# traversal, NUL-byte tricks, leading dashes, and Windows reserved names.
_SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
_RESERVED = {
    "",
    ".",
    "..",
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "LPT1",
    "LPT2",
}
_MAX_NAME_LEN = 200


def safe_basename(filename: str) -> str:
    """Validate a filename. We REJECT (rather than silently sanitize) any
    input that looks pathy.

    - Reject NUL bytes.
    - Reject anything containing a path separator (`/` or `\\`) — caller
      must pass a basename only.
    - Reject empty, ".", "..", names starting with ".", and Windows
      reserved names.
    - Reject any character outside [A-Za-z0-9._-].
    - Reject names longer than _MAX_NAME_LEN.
    """
    if not isinstance(filename, str):
        raise HTTPException(status_code=400, detail="invalid_filename")
    if "\x00" in filename:
        raise HTTPException(status_code=400, detail="invalid_filename")
    if "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="invalid_filename")
    if not filename or filename in _RESERVED:
        raise HTTPException(status_code=400, detail="invalid_filename")
    if filename.startswith("."):
        raise HTTPException(status_code=400, detail="invalid_filename")
    if len(filename) > _MAX_NAME_LEN:
        raise HTTPException(status_code=400, detail="filename_too_long")
    if not _SAFE_NAME.match(filename):
        raise HTTPException(status_code=400, detail="invalid_filename")
    return filename


def safe_segment(value: str, kind: str) -> str:
    """Validate a single path segment (project_id / shot_id).

    Disallows: empty / NUL / "/" / "\\" / "." / ".." / leading dot /
    anything outside [A-Za-z0-9._-].
    """
    if not value or not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"invalid_{kind}")
    if "\x00" in value or "/" in value or "\\" in value:
        raise HTTPException(status_code=400, detail=f"invalid_{kind}")
    if value.startswith(".") or value in {".", ".."}:
        raise HTTPException(status_code=400, detail=f"invalid_{kind}")
    if not _SAFE_NAME.match(value):
        raise HTTPException(status_code=400, detail=f"invalid_{kind}")
    return value


def asset_dir(project_id: str, shot_id: str | None = None) -> Path:
    base = get_settings().assets_dir.resolve()
    out = base / safe_segment(project_id, "project_id")
    if shot_id:
        out = out / safe_segment(shot_id, "shot_id")
    out = out.resolve()
    try:
        out.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="path_outside_assets")
    out.mkdir(parents=True, exist_ok=True)
    return out


def store_file(
    project_id: str,
    shot_id: str | None,
    source_path: str | Path,
    target_name: str,
) -> StoredAsset:
    """Copy source_path into assets/{project}/{shot}/{safe(target_name)}.

    All identifiers are validated; the resolved target path must remain
    within the configured assets_dir or we abort with HTTP 400.
    """
    base = get_settings().assets_dir.resolve()
    target_dir = asset_dir(project_id, shot_id)
    safe_target = safe_basename(target_name)
    target = (target_dir / safe_target).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="path_outside_assets")

    src = Path(source_path)
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=400, detail="source_not_a_file")

    shutil.copy2(src, target)
    digest = file_sha256(target)
    return StoredAsset(
        file_path=str(target),
        file_hash=digest,
        size_bytes=target.stat().st_size,
    )


def verify(file_path: str | Path, expected_hash: str | None) -> bool:
    path = Path(file_path)
    if not path.exists():
        return False
    if expected_hash is None:
        return True
    return file_sha256(path) == expected_hash
