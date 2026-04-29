from __future__ import annotations

import time

from fastapi.testclient import TestClient


def _wait_until(predicate, timeout=5.0, interval=0.05):
    start = time.time()
    while time.time() - start < timeout:
        if predicate():
            return True
        time.sleep(interval)
    return False


def test_create_run_executes_and_pauses_after_first_step():
    from server.data.models import GraphRun, Step
    from server.data.session import session_scope
    from server.main import create_app

    app = create_app()
    with TestClient(app) as client:
        proj = client.post(
            "/api/projects", json={"title": "demo", "direction": "documentary"}
        ).json()
        run = client.post(
            "/api/runs",
            json={"project_id": proj["id"], "workflow": "documentary_default"},
        ).json()
        run_id = run["id"]

        def first_step_done():
            with session_scope() as session:
                steps = (
                    session.query(Step)
                    .filter(Step.graph_run_id == run_id)
                    .order_by(Step.sequence)
                    .all()
                )
                return steps and steps[0].status == "success"

        assert _wait_until(first_step_done, timeout=10.0), "first step never completed"

        with session_scope() as session:
            run_obj = session.get(GraphRun, run_id)
            assert run_obj.status in {"paused", "running"}

        # Manual mode: each resume executes exactly one more step.
        for _ in range(4):
            client.post(f"/api/runs/{run_id}/resume")
            time.sleep(0.3)
        assert _wait_until(
            lambda: _all_steps_terminal(run_id), timeout=15.0
        ), "run did not advance to terminal state after manual resumes"


def _all_steps_terminal(run_id: str) -> bool:
    from server.data.models import Step
    from server.data.session import session_scope

    with session_scope() as session:
        steps = session.query(Step).filter(Step.graph_run_id == run_id).all()
        if not steps:
            return False
        return all(s.status in {"success", "failed", "rejected", "skipped"} for s in steps)


def test_auto_mode_runs_all_steps():
    from server.data.models import Step
    from server.data.session import session_scope
    from server.main import create_app

    app = create_app()
    with TestClient(app) as client:
        proj = client.post("/api/projects", json={"title": "auto", "direction": "documentary"}).json()
        run = client.post(
            "/api/runs",
            json={
                "project_id": proj["id"],
                "workflow": "documentary_default",
                "auto_mode": True,
            },
        ).json()
        run_id = run["id"]

        def all_done():
            with session_scope() as session:
                steps = (
                    session.query(Step).filter(Step.graph_run_id == run_id).all()
                )
                return steps and all(s.status == "success" for s in steps)

        assert _wait_until(all_done, timeout=15.0), "auto run did not finish"

        events = client.get(f"/api/runs/{run_id}/events").json()
        assert any(e["event_type"] == "artifact" for e in events)
        assert any(e["event_type"] == "finish" for e in events)


def test_rerun_creates_child_step():
    from server.data.models import Step
    from server.data.session import session_scope
    from server.main import create_app

    app = create_app()
    with TestClient(app) as client:
        proj = client.post(
            "/api/projects", json={"title": "rerun", "direction": "documentary"}
        ).json()
        run = client.post(
            "/api/runs",
            json={
                "project_id": proj["id"],
                "workflow": "documentary_default",
                "auto_mode": True,
            },
        ).json()
        run_id = run["id"]

        def all_done():
            with session_scope() as session:
                steps = session.query(Step).filter(Step.graph_run_id == run_id).all()
                return steps and all(s.status == "success" for s in steps)

        assert _wait_until(all_done, timeout=15.0)

        with session_scope() as session:
            first = (
                session.query(Step)
                .filter(Step.graph_run_id == run_id)
                .order_by(Step.sequence)
                .first()
            )
            first_id = first.id

        client.post(f"/api/runs/{run_id}/rerun", json={"step_id": first_id})

        def rerun_done():
            with session_scope() as session:
                children = (
                    session.query(Step).filter(Step.parent_step_id == first_id).all()
                )
                return children and all(c.status == "success" for c in children)

        assert _wait_until(rerun_done, timeout=15.0), "rerun child never completed"
