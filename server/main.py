from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.api.facts import router as facts_router
from server.api.files import router as files_router
from server.api.health import router as health_router
from server.api.materials import router as materials_router
from server.api.projects import router as projects_router
from server.api.runs import router as runs_router
from server.api.shots import router as shots_router
from server.api.uploads import router as uploads_router
from server.data.session import init_db
from server.engine import workflow as _workflow_registry  # noqa: F401  -- registers workflows
from server.settings import get_settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.ensure_dirs()
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="aivedio",
        description="AI video generation agent platform",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(projects_router)
    app.include_router(materials_router)
    app.include_router(facts_router)
    app.include_router(shots_router)
    app.include_router(uploads_router)
    app.include_router(files_router)
    app.include_router(runs_router)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server.main:app", host="0.0.0.0", port=8000, reload=True)
