from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from sqlalchemy import text

from server.data.session import session_scope
from server.settings import get_settings

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    db_ok = False
    db_error: str | None = None
    try:
        with session_scope() as session:
            session.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        db_error = str(exc)

    assets_ok = Path(settings.assets_dir).exists()
    configs_ok = Path(settings.configs_dir).exists()

    return {
        "status": "ok" if db_ok and assets_ok else "degraded",
        "db": {"ok": db_ok, "error": db_error, "path": str(settings.db_path)},
        "assets_dir": {"ok": assets_ok, "path": str(settings.assets_dir)},
        "configs_dir": {"ok": configs_ok, "path": str(settings.configs_dir)},
        "models": {
            "research": settings.model_research,
            "writing": settings.model_writing,
            "structure": settings.model_structure,
            "vision": settings.model_vision,
            "lightweight": settings.model_lightweight,
        },
    }
