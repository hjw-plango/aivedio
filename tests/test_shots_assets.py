"""Shot / ShotAsset / upload API tests for M4."""

from __future__ import annotations

import io
import time

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


def _setup_pipeline(client: TestClient) -> tuple[str, str]:
    """Create a project + run pipeline, return (project_id, first_jimeng_shot_id)."""
    project = client.post(
        "/api/projects",
        json={"title": "M4 test", "direction": "documentary", "brief": "测试"},
    ).json()
    pid = project["id"]
    client.post(f"/api/projects/{pid}/materials", json={"content": SAMPLE})
    run = client.post(
        "/api/runs",
        json={"project_id": pid, "workflow": "documentary_default", "auto_mode": True},
    ).json()

    def done():
        from server.data.models import Shot, Step
        from server.data.session import session_scope

        with session_scope() as session:
            steps = session.query(Step).filter(Step.graph_run_id == run["id"]).all()
            shots = session.query(Shot).filter(Shot.project_id == pid).count()
            return steps and all(s.status == "success" for s in steps) and shots > 0

    assert _wait(done, timeout=30.0)

    shots = client.get(f"/api/projects/{pid}/shots").json()
    assert len(shots) == 5
    target = next((s for s in shots if not s["requires_real_footage"]), None)
    assert target is not None
    return pid, target["id"]


def test_list_shots_includes_jimeng_prompts():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _setup_pipeline(client)
        shots = client.get(f"/api/projects/{pid}/shots").json()
        any_jimeng = False
        for s in shots:
            for a in s["assets"]:
                if a["asset_type"] == "jimeng_video_prompt" and a["prompt"]:
                    any_jimeng = True
                    assert a["rights"]["source_type"] == "ai_generated"
        assert any_jimeng, "no jimeng prompts found across 5 core shots"


def test_patch_asset_updates_score_and_status():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, _shot_id = _setup_pipeline(client)
        assets = client.get(
            f"/api/projects/{pid}/assets?asset_type=jimeng_video_prompt"
        ).json()
        target = assets[0]
        patched = client.patch(
            f"/api/assets/{target['id']}",
            json={"status": "accepted", "score": 4.0, "notes": "ok"},
        ).json()
        assert patched["status"] == "accepted"
        assert patched["score"] == 4.0
        assert patched["notes"] == "ok"


def test_upload_jimeng_video_creates_versioned_asset():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _setup_pipeline(client)
        files = {"file": ("clip.mp4", io.BytesIO(b"\x00\x00\x00\x18ftypmp42stub"), "video/mp4")}
        data = {"notes": "first take", "aspect_ratio": "16:9", "duration_seconds": "5"}
        resp = client.post(
            f"/api/shots/{shot_id}/jimeng-video", files=files, data=data
        ).json()
        assert resp["shot_id"] == shot_id
        assert resp["version"] == 1
        assert resp["file_path"]

        # second upload bumps version
        files2 = {"file": ("clip2.mp4", io.BytesIO(b"\x00\x00\x00\x18ftypmp42stubV2"), "video/mp4")}
        resp2 = client.post(f"/api/shots/{shot_id}/jimeng-video", files=files2, data=data).json()
        assert resp2["version"] == 2

        # both visible in shot detail
        shot = next(
            s for s in client.get(f"/api/projects/{pid}/shots").json() if s["id"] == shot_id
        )
        videos = [a for a in shot["assets"] if a["asset_type"] == "manual_jimeng_video"]
        assert len(videos) == 2


def test_patch_shot_subject():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _setup_pipeline(client)
        patched = client.patch(
            f"/api/shots/{shot_id}", json={"subject": "新主体描述"}
        ).json()
        assert patched["subject"] == "新主体描述"


def test_delete_asset_moves_to_trash():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _setup_pipeline(client)
        files = {"file": ("clip.mp4", io.BytesIO(b"x" * 32), "video/mp4")}
        upload = client.post(
            f"/api/shots/{shot_id}/jimeng-video",
            files=files,
            data={"aspect_ratio": "16:9", "duration_seconds": "5"},
        ).json()
        resp = client.delete(f"/api/assets/{upload['id']}").json()
        assert resp["deleted"] is True
        assert resp["moved_to"], "expected file moved to trash"
