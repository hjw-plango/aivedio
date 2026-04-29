from __future__ import annotations

import ulid


def new_id(prefix: str = "") -> str:
    raw = ulid.new().str.lower()
    return f"{prefix}_{raw}" if prefix else raw
