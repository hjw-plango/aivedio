"""Long-form documentary P0 driver.

Creates one documentary project, uploads source material, runs the default
pipeline, and prints the first-chapter production summary.

Usage:
  PYTHONPATH=. .venv/bin/python -m scripts.run_pilot
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient


PILOT_DIR = Path(__file__).resolve().parent.parent / "configs" / "documentary" / "pilot"
DEFAULT_TOPIC = ("景德镇制瓷长纪录片", "jingdezhen.md")
RUN_TIMEOUT_SECONDS = float(os.getenv("PILOT_TIMEOUT_SECONDS", "600"))


def _wait(predicate, timeout=60.0):
    start = time.time()
    while time.time() - start < timeout:
        if predicate():
            return True
        time.sleep(0.2)
    return False


def main() -> int:
    from server.main import create_app

    title, source = DEFAULT_TOPIC
    material_text = (PILOT_DIR / source).read_text(encoding="utf-8")
    with TestClient(create_app()) as client:
        project = client.post(
            "/api/projects",
            json={
                "title": title,
                "direction": "documentary",
                "brief": "做一部 12 分钟左右的观察式非遗纪录片,先完整规划全片,并生产第一章 3 分钟可用分镜。",
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
        run_id = run["id"]

        def all_done() -> bool:
            full = client.get(f"/api/runs/{run_id}").json()
            return full["status"] in {"success", "failed"} and all(
                s["status"] in {"success", "failed", "rejected", "skipped"}
                for s in full["steps"]
            )

        ok = _wait(all_done, timeout=RUN_TIMEOUT_SECONDS)
        run_after = client.get(f"/api/runs/{run_id}").json()
        facts = client.get(f"/api/projects/{pid}/facts").json()
        shots = client.get(f"/api/projects/{pid}/shots").json()
        refs = client.get(
            f"/api/projects/{pid}/assets?asset_type=reference_image_prompt"
        ).json()
        memories = client.get(
            f"/api/projects/{pid}/assets?asset_type=production_memory"
        ).json()
        jimeng = sum(
            1
            for s in shots
            for a in s["assets"]
            if a["asset_type"] == "jimeng_video_prompt" and a["prompt"]
        )
        total_seconds = sum(float(s["duration_estimate"]) for s in shots)

    print("\n=== Documentary P0 Summary ===")
    print(f"title={title}")
    print(f"project_id={pid}")
    print(f"run_id={run_id}")
    print(f"run_status={run_after['status']} completed={ok}")
    print(f"facts={len(facts)} memory_assets={len(memories)} reference_prompts={len(refs)}")
    print(f"first_chapter_shots={len(shots)} total_seconds={int(total_seconds)} jimeng_prompts={jimeng}")
    print(f"\nopen in web UI:\n  /projects/{pid}/memory\n  /projects/{pid}/shots")

    return 0 if ok and run_after["status"] == "success" and len(shots) >= 12 and jimeng >= 12 else 1


if __name__ == "__main__":
    sys.exit(main())
