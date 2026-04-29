from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture(scope="session", autouse=True)
def _isolated_settings(tmp_path_factory: pytest.TempPathFactory) -> None:
    """Point all I/O at a tmp dir so tests never touch real assets/."""
    tmp_root = tmp_path_factory.mktemp("aivedio-test")
    os.environ["DB_PATH"] = str(tmp_root / "test.db")
    os.environ["ASSETS_DIR"] = str(tmp_root / "assets")
    os.environ["RUNS_DIR"] = str(tmp_root / "runs")
    os.environ["CONFIGS_DIR"] = str(Path(__file__).resolve().parent.parent / "configs")
    os.environ["LLM_API_KEY"] = ""
    os.environ["ANTHROPIC_API_KEY"] = ""

    from server.settings import get_settings

    get_settings.cache_clear()  # type: ignore[attr-defined]

    from server.data import session as session_mod

    session_mod.reset_engine_for_tests()
    session_mod.init_db()
