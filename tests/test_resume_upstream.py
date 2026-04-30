"""Manual-mode resume must preserve upstream chain across pauses.

Reproducer for the bug: in auto_mode=False, execute_run pauses after each
step. The function returns; resume_run() reenters execute_run() which used
to reset upstream={initial_input}. After resume, writer would see no
research.fact_cards and fall back to the empty scaffolding.

After fix: Step.output_data persists the agent's output; _rebuild_upstream
replays completed steps so writer sees research.fact_cards, storyboard
sees writer.script, etc.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient


SAMPLE = """
景德镇制瓷起源于明代。
拉坯是关键工序：先用瓷土在转盘上塑形，再用修坯刀刮削。
青花是用毛笔蘸钴料在瓷胎上作画，烧制需 1300 度。
"""


def _wait(predicate, timeout=20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def _step_by_name(steps: list[dict], name: str) -> dict | None:
    return next((s for s in steps if s["step_name"] == name), None)


def _wait_paused(client, run_id: str, after_step: str) -> None:
    """Wait until the step finished AND run.status reverted to paused."""
    def ready():
        r = client.get(f"/api/runs/{run_id}").json()
        step = _step_by_name(r["steps"], after_step)
        return (
            step is not None
            and step["status"] == "success"
            and r["status"] in {"paused", "success"}
        )

    assert _wait(ready, timeout=20.0), f"never reached paused after {after_step}"


def test_manual_resume_preserves_upstream_chain():
    """Each manual resume must let the next agent see prior outputs."""
    from server.data.models import FactCard, Shot
    from server.data.session import session_scope
    from server.main import create_app

    app = create_app()
    with TestClient(app) as client:
        project = client.post(
            "/api/projects",
            json={"title": "manual resume", "direction": "documentary", "brief": "测试"},
        ).json()
        pid = project["id"]
        client.post(f"/api/projects/{pid}/materials", json={"content": SAMPLE})

        run = client.post(
            "/api/runs",
            json={"project_id": pid, "workflow": "documentary_default", "auto_mode": False},
        ).json()
        rid = run["id"]

        # Step 1: research finishes → run paused.
        _wait_paused(client, rid, "research")

        with session_scope() as session:
            facts_after_research = (
                session.query(FactCard).filter(FactCard.project_id == pid).count()
            )
        assert facts_after_research >= 3, "research did not persist FactCards"

        # Step 2: resume → writer must see research.fact_cards in upstream.
        client.post(f"/api/runs/{rid}/resume")
        _wait_paused(client, rid, "writer")

        run_after = client.get(f"/api/runs/{rid}").json()
        writer = _step_by_name(run_after["steps"], "writer")
        assert writer is not None
        assert "场" in writer["output_summary"], (
            f"writer output suspiciously empty: {writer['output_summary']!r}"
        )

        # Step 3: resume → storyboard must see writer.script and produce 15 shots.
        client.post(f"/api/runs/{rid}/resume")
        _wait_paused(client, rid, "storyboard")

        with session_scope() as session:
            shot_count = session.query(Shot).filter(Shot.project_id == pid).count()
        assert shot_count == 15, f"expected 15 shots after manual resume chain, got {shot_count}"

        # Step 4: resume → review and run reaches success.
        client.post(f"/api/runs/{rid}/resume")

        def all_done():
            r = client.get(f"/api/runs/{rid}").json()
            return r["status"] == "success" and all(s["status"] == "success" for s in r["steps"])

        if not _wait(all_done, timeout=20.0):
            r = client.get(f"/api/runs/{rid}").json()
            raise AssertionError(
                f"final state: run={r['status']}, "
                f"steps={[(s['step_name'], s['status']) for s in r['steps']]}"
            )


def test_step_output_data_persisted_to_db():
    """After auto run, Step.output_data should hold each agent's data dict."""
    from server.data.models import Step
    from server.data.session import session_scope
    from server.main import create_app

    app = create_app()
    with TestClient(app) as client:
        project = client.post(
            "/api/projects",
            json={"title": "persist", "direction": "documentary", "brief": "持久化测试"},
        ).json()
        pid = project["id"]
        client.post(f"/api/projects/{pid}/materials", json={"content": SAMPLE})
        run = client.post(
            "/api/runs",
            json={"project_id": pid, "workflow": "documentary_default", "auto_mode": True},
        ).json()
        rid = run["id"]

        def done():
            r = client.get(f"/api/runs/{rid}").json()
            return r["status"] == "success"

        assert _wait(done, timeout=30.0)

        with session_scope() as session:
            steps = (
                session.query(Step)
                .filter(Step.graph_run_id == rid)
                .order_by(Step.sequence)
                .all()
            )
            data_by_name = {s.step_name: s.output_data for s in steps}

        assert data_by_name["research"].get("fact_cards"), "research output_data missing fact_cards"
        assert data_by_name["writer"].get("script"), "writer output_data missing script"
        assert data_by_name["storyboard"].get("shots"), "storyboard output_data missing shots"
        assert data_by_name["review"].get("report"), "review output_data missing report"
