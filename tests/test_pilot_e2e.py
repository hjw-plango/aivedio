"""M5 end-to-end pilot regression test.

Runs the 3-topic pilot through the full pipeline and asserts the contractual
output: 15 shots / topic, 10+ jimeng prompts (allowing a couple of real-only
shots), facts populated, no failed steps.
"""

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


def _run_topic(client: TestClient, title: str, source_file: str) -> dict:
    material_text = (PILOT_DIR / source_file).read_text(encoding="utf-8")
    project = client.post(
        "/api/projects",
        json={
            "title": title,
            "direction": "documentary",
            "brief": f"15 镜 pilot — {title}",
        },
    ).json()
    pid = project["id"]
    client.post(
        f"/api/projects/{pid}/materials",
        json={"content": material_text, "source_type": "text"},
    )
    run = client.post(
        "/api/runs",
        json={"project_id": pid, "workflow": "documentary_default", "auto_mode": True},
    ).json()
    rid = run["id"]

    def done():
        r = client.get(f"/api/runs/{rid}").json()
        return r["status"] == "success" and all(s["status"] == "success" for s in r["steps"])

    assert _wait(done, timeout=120.0), f"{title} pipeline did not finish"

    return {
        "project_id": pid,
        "run_id": rid,
        "facts": client.get(f"/api/projects/{pid}/facts").json(),
        "shots": client.get(f"/api/projects/{pid}/shots").json(),
        "events": client.get(f"/api/runs/{rid}/events").json(),
    }


def test_three_topic_pilot_produces_15_shots_each():
    from server.main import create_app

    topics = [
        ("景德镇制瓷", "jingdezhen.md"),
        ("苏绣", "suxiu.md"),
        ("川剧变脸", "chuanju_bianlian.md"),
    ]
    with TestClient(create_app()) as client:
        results = [_run_topic(client, title, src) for title, src in topics]

    for title_idx, (title, _) in enumerate(topics):
        result = results[title_idx]
        assert len(result["shots"]) == 15, f"{title} expected 15 shots, got {len(result['shots'])}"
        assert len(result["facts"]) >= 5, f"{title} too few facts: {len(result['facts'])}"

        ai_shots = [s for s in result["shots"] if not s["requires_real_footage"]]
        # at least 10 AI shots should produce jimeng prompts
        prompts = [
            a
            for s in ai_shots
            for a in s["assets"]
            if a["asset_type"] == "jimeng_video_prompt" and a["prompt"]
        ]
        assert len(prompts) >= 10, f"{title} too few jimeng prompts: {len(prompts)}"

        # every prompt must be markdown-clean (M4 fix regression)
        for p in prompts:
            assert "##" not in p["prompt"]
            assert "```" not in p["prompt"]

    # Each pipeline emitted artifact events from all 4 agents
    for title_idx, result in enumerate(results):
        agents = {
            e["payload"].get("agent_name")
            for e in result["events"]
            if e["event_type"] == "artifact"
        }
        assert {"research", "writer", "storyboard", "review"} <= agents, (
            f"{topics[title_idx][0]} missing artifacts from agents: {agents}"
        )
