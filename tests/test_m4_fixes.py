"""Regression tests for M4 reviewer fixes.

- jimeng prompt must NOT contain markdown headings from shot_prompt.md
- uploaded videos must be named jimeng_v{n}_score{score}.{ext}
- score PATCH renames file in place
- candidate cap (3 non-rejected) returns 409
"""

from __future__ import annotations

import io
import time
from pathlib import Path

from fastapi.testclient import TestClient


SAMPLE = """
景德镇制瓷起源于明代。拉坯是关键工序,先用瓷土在转盘上塑形,再修坯。
青花是用毛笔蘸青料在瓷胎上作画。窑火温度约 1300 度。
"""


def _wait(predicate, timeout=20.0):
    start = time.time()
    while time.time() - start < timeout:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def _bootstrap(client: TestClient) -> tuple[str, str]:
    project = client.post(
        "/api/projects", json={"title": "fix", "direction": "documentary", "brief": "fix"}
    ).json()
    pid = project["id"]
    client.post(f"/api/projects/{pid}/materials", json={"content": SAMPLE})
    run = client.post(
        "/api/runs", json={"project_id": pid, "auto_mode": True}
    ).json()

    def done():
        from server.data.models import Shot, Step
        from server.data.session import session_scope

        with session_scope() as s:
            steps = s.query(Step).filter(Step.graph_run_id == run["id"]).all()
            shots = s.query(Shot).filter(Shot.project_id == pid).count()
            return steps and all(x.status == "success" for x in steps) and shots > 0

    assert _wait(done, timeout=30.0)

    shots = client.get(f"/api/projects/{pid}/shots").json()
    target = next(s for s in shots if not s["requires_real_footage"])
    return pid, target["id"]


def test_jimeng_prompt_has_no_markdown_meta():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, _ = _bootstrap(client)
        shots = client.get(f"/api/projects/{pid}/shots").json()
        prompts = [
            a["prompt"]
            for s in shots
            for a in s["assets"]
            if a["asset_type"] == "jimeng_video_prompt"
        ]
        assert prompts, "no jimeng prompts produced"
        for p in prompts:
            assert "##" not in p, f"prompt leaks markdown heading: {p[:200]}"
            assert "```" not in p, f"prompt leaks code fence: {p[:200]}"
            assert "通用骨架" not in p, "prompt includes the heading text"
            assert "使用说明" not in p, "prompt includes the dev note"


def test_uploaded_jimeng_filename_includes_score():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _bootstrap(client)
        files = {"file": ("a.mp4", io.BytesIO(b"\x00" * 32), "video/mp4")}
        upload = client.post(
            f"/api/shots/{shot_id}/jimeng-video",
            files=files,
            data={"aspect_ratio": "16:9", "duration_seconds": "5"},
        ).json()
        assert "_score0" in Path(upload["file_path"]).name, upload["file_path"]


def test_score_patch_renames_file():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _bootstrap(client)
        files = {"file": ("a.mp4", io.BytesIO(b"\x00" * 32), "video/mp4")}
        upload = client.post(
            f"/api/shots/{shot_id}/jimeng-video",
            files=files,
            data={"aspect_ratio": "16:9", "duration_seconds": "5"},
        ).json()

        patched = client.patch(
            f"/api/assets/{upload['id']}", json={"score": 4}
        ).json()
        assert "_score4" in Path(patched["file_path"]).name
        assert Path(patched["file_path"]).exists()
        assert not Path(upload["file_path"]).exists()


def test_candidate_cap_blocks_4th_active_upload():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _bootstrap(client)
        for i in range(3):
            files = {"file": (f"v{i}.mp4", io.BytesIO(b"\x00" * 16), "video/mp4")}
            r = client.post(
                f"/api/shots/{shot_id}/jimeng-video",
                files=files,
                data={"aspect_ratio": "16:9", "duration_seconds": "5"},
            )
            assert r.status_code == 200
        files = {"file": ("v3.mp4", io.BytesIO(b"\x00" * 16), "video/mp4")}
        r = client.post(
            f"/api/shots/{shot_id}/jimeng-video",
            files=files,
            data={"aspect_ratio": "16:9", "duration_seconds": "5"},
        )
        assert r.status_code == 409
        body = r.json()
        assert body["detail"]["error"] == "candidate_cap_reached"
        assert len(body["detail"]["candidate_ids"]) == 3
