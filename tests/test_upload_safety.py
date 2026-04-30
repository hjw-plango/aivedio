"""Path-traversal and asset_type whitelist regression tests for uploads."""

from __future__ import annotations

import io
import time
from pathlib import Path

from fastapi.testclient import TestClient


SAMPLE = "景德镇制瓷起源于明代。拉坯先粗坯,再修坯。"


def _wait(predicate, timeout=20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def _bootstrap(client: TestClient) -> tuple[str, str]:
    project = client.post(
        "/api/projects", json={"title": "safety", "direction": "documentary", "brief": "x"}
    ).json()
    pid = project["id"]
    client.post(f"/api/projects/{pid}/materials", json={"content": SAMPLE})
    run = client.post(
        "/api/runs", json={"project_id": pid, "auto_mode": True}
    ).json()

    def done():
        from server.data.models import Step
        from server.data.session import session_scope

        with session_scope() as s:
            steps = s.query(Step).filter(Step.graph_run_id == run["id"]).all()
            return steps and all(x.status == "success" for x in steps)

    assert _wait(done, timeout=30.0)
    shots = client.get(f"/api/projects/{pid}/shots").json()
    return pid, next(s for s in shots if not s["requires_real_footage"])["id"]


def test_safe_basename_rejects_path_traversal():
    from server.data.asset_store import safe_basename
    from fastapi import HTTPException

    bad_names = [
        "../etc/passwd",
        "../../../../etc/shadow",
        "/etc/passwd",
        "..\\..\\windows\\system32",
        "foo\x00.txt",
        "",
        ".",
        "..",
        "中文.mp4",  # outside [A-Za-z0-9._-]
        "a" * 300,
    ]
    for name in bad_names:
        try:
            safe_basename(name)
        except HTTPException as exc:
            assert exc.status_code == 400
        else:
            raise AssertionError(f"safe_basename accepted bad name: {name!r}")


def test_safe_basename_accepts_normal_names():
    from server.data.asset_store import safe_basename

    for name in ["clip.mp4", "jimeng_v1_score4.mp4", "first-take.MOV", "image.png"]:
        assert safe_basename(name) == name


def test_safe_segment_rejects_traversal_and_dotdir():
    from fastapi import HTTPException

    from server.data.asset_store import safe_segment

    for bad in ["..", ".", "/etc", "..\\foo", "a/b", "a\x00b", ".trash", ".hidden"]:
        try:
            safe_segment(bad, "shot_id")
        except HTTPException as exc:
            assert exc.status_code == 400
        else:
            raise AssertionError(f"safe_segment accepted bad value: {bad!r}")


def test_store_file_refuses_to_escape_assets_dir(tmp_path: Path):
    from server.data.asset_store import store_file
    from fastapi import HTTPException

    src = tmp_path / "input.txt"
    src.write_text("payload")

    # malicious target_name
    for evil in ["../etc/passwd", "..\\..\\bad.txt", "..", ""]:
        try:
            store_file("prj_safe", "shot_safe", src, evil)
        except HTTPException as exc:
            assert exc.status_code == 400
        else:
            raise AssertionError(f"store_file accepted: {evil!r}")

    # malicious project_id / shot_id
    for evil_proj in ["..", "/etc", ".trash", ".hidden", "a\\b", "a/b"]:
        try:
            store_file(evil_proj, "shot_safe", src, "ok.txt")
        except HTTPException as exc:
            assert exc.status_code == 400
        else:
            raise AssertionError(f"store_file accepted project: {evil_proj!r}")


def test_generic_upload_rejects_invalid_asset_type():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _bootstrap(client)
        files = {"file": ("foo.mp4", io.BytesIO(b"x" * 16), "video/mp4")}
        for bad in ["random_evil_type", "../shotgun", "manual_jimeng_video", "storyboard_prompt", ""]:
            r = client.post(
                f"/api/shots/{shot_id}/upload",
                files=files,
                data={"asset_type": bad, "rights_holder": "x"},
            )
            assert r.status_code == 400, f"asset_type={bad!r} should be rejected"


def test_generic_upload_accepts_whitelisted_asset_type():
    from server.main import create_app

    with TestClient(create_app()) as client:
        pid, shot_id = _bootstrap(client)
        files = {"file": ("real.mp4", io.BytesIO(b"x" * 16), "video/mp4")}
        r = client.post(
            f"/api/shots/{shot_id}/upload",
            files=files,
            data={"asset_type": "real_footage", "rights_holder": "owner"},
        )
        assert r.status_code == 200


def test_jimeng_upload_with_evil_filename_still_safe():
    """Even if the user's mp4 is named '../../passwd.mp4', the saved file
    sits inside assets/ because we ignore user filenames for path
    construction (we generate jimeng_v{n}_score0.{ext})."""
    from server.main import create_app
    from server.settings import get_settings

    with TestClient(create_app()) as client:
        pid, shot_id = _bootstrap(client)
        files = {"file": ("../../../etc/passwd.mp4", io.BytesIO(b"x" * 16), "video/mp4")}
        r = client.post(
            f"/api/shots/{shot_id}/jimeng-video",
            files=files,
            data={"aspect_ratio": "16:9", "duration_seconds": "5"},
        )
        assert r.status_code == 200, r.text
        path = Path(r.json()["file_path"]).resolve()
        assets_dir = get_settings().assets_dir.resolve()
        path.relative_to(assets_dir)  # raises if outside


def test_material_upload_safe_for_unicode_filename():
    """Unicode filenames must not crash and the file should land inside assets/."""
    from server.main import create_app
    from server.settings import get_settings

    with TestClient(create_app()) as client:
        project = client.post(
            "/api/projects", json={"title": "u", "direction": "documentary"}
        ).json()
        pid = project["id"]
        files = {"file": ("中文资料.txt", io.BytesIO("中文测试".encode("utf-8")), "text/plain")}
        r = client.post(f"/api/projects/{pid}/materials/upload", files=files)
        assert r.status_code == 200
        path = Path(r.json()["file_path"]).resolve()
        assets_dir = get_settings().assets_dir.resolve()
        path.relative_to(assets_dir)


def test_material_upload_rejects_disallowed_extension():
    from server.main import create_app

    with TestClient(create_app()) as client:
        project = client.post("/api/projects", json={"title": "x"}).json()
        pid = project["id"]
        files = {"file": ("payload.exe", io.BytesIO(b"MZ"), "application/octet-stream")}
        r = client.post(f"/api/projects/{pid}/materials/upload", files=files)
        assert r.status_code == 400
