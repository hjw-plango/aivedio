"""Local asset storage helpers. P0 only — local filesystem under assets/."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

from server.settings import get_settings
from server.utils.hashing import file_sha256


@dataclass
class StoredAsset:
    file_path: str
    file_hash: str
    size_bytes: int


def asset_dir(project_id: str, shot_id: str | None = None) -> Path:
    base = get_settings().assets_dir / project_id
    if shot_id:
        base = base / shot_id
    base.mkdir(parents=True, exist_ok=True)
    return base


def store_file(project_id: str, shot_id: str | None, source_path: str | Path, target_name: str) -> StoredAsset:
    target_dir = asset_dir(project_id, shot_id)
    target = target_dir / target_name
    shutil.copy2(source_path, target)
    digest = file_sha256(target)
    return StoredAsset(file_path=str(target), file_hash=digest, size_bytes=target.stat().st_size)


def verify(file_path: str | Path, expected_hash: str | None) -> bool:
    path = Path(file_path)
    if not path.exists():
        return False
    if expected_hash is None:
        return True
    return file_sha256(path) == expected_hash
