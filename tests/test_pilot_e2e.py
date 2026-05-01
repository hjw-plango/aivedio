"""Long-form documentary P0 end-to-end regression."""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient


PILOT_DIR = Path(__file__).resolve().parent.parent / "configs" / "documentary" / "pilot"


def _wait(predicate, timeout=120.0):
    start = time.time()
    while time.time() - start < timeout:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def test_documentary_default_produces_first_chapter_and_memory():
    from server.main import create_app

    material_text = (PILOT_DIR / "jingdezhen.md").read_text(encoding="utf-8")
    with TestClient(create_app()) as client:
        project = client.post(
            "/api/projects",
            json={
                "title": "景德镇制瓷",
                "direction": "documentary",
                "brief": "12 分钟观察式纪录片,先生产第一章 3 分钟。",
            },
        ).json()
        pid = project["id"]
        client.post(f"/api/projects/{pid}/materials", json={"content": material_text})
        run = client.post(
            "/api/runs",
            json={"project_id": pid, "workflow": "documentary_default", "auto_mode": True},
        ).json()
        rid = run["id"]

        def done():
            r = client.get(f"/api/runs/{rid}").json()
            return r["status"] == "success" and all(s["status"] == "success" for s in r["steps"])

        assert _wait(done), "pipeline did not finish"

        facts = client.get(f"/api/projects/{pid}/facts").json()
        shots = client.get(f"/api/projects/{pid}/shots").json()
        refs = client.get(f"/api/projects/{pid}/assets?asset_type=reference_image_prompt").json()
        memory = client.get(f"/api/projects/{pid}/assets?asset_type=production_memory").json()
        events = client.get(f"/api/runs/{rid}/events").json()

        assert len(facts) >= 5
        assert len(shots) == 18
        assert int(sum(float(s["duration_estimate"]) for s in shots)) == 180
        assert len(refs) >= 8
        assert len(memory) == 1
        assert all(
            any(a["asset_type"] == "jimeng_video_prompt" and a["prompt"] for a in s["assets"])
            for s in shots
        )

        agents = {
            e["payload"].get("agent_name")
            for e in events
            if e["event_type"] == "artifact"
        }
        assert {"research", "writer", "memory", "storyboard", "review"} <= agents
