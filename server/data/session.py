from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from server.data.models import Base
from server.settings import get_settings


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _build_engine() -> Engine:
    settings = get_settings()
    settings.ensure_dirs()
    url = f"sqlite:///{settings.db_path}"
    engine = create_engine(url, future=True, echo=False, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _enable_sqlite_pragmas(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    return engine


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = _build_engine()
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _SessionLocal


def init_db() -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)
    _apply_lightweight_migrations(engine)


def _apply_lightweight_migrations(engine: Engine) -> None:
    """SQLite-only ALTER TABLE for additive columns.

    SQLAlchemy create_all() only creates missing tables; it does NOT add new
    columns to existing ones. For P0 we ship a tiny migration shim that
    introspects current columns and adds any missing additive columns we
    care about. P1 should switch to alembic.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "steps" in inspector.get_table_names():
        existing = {col["name"] for col in inspector.get_columns("steps")}
        with engine.begin() as conn:
            if "output_data" not in existing:
                conn.execute(text("ALTER TABLE steps ADD COLUMN output_data JSON DEFAULT '{}'"))


@contextmanager
def session_scope() -> Iterator[Session]:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def reset_engine_for_tests() -> None:
    """Drop cached engine; tests can swap DB path via settings cache reset."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
