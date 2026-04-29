"""End-to-end M5 pilot driver.

Creates 3 documentary projects (景德镇制瓷 / 苏绣 / 川剧变脸), uploads the
pilot materials, runs the full pipeline in auto mode, and prints a summary
of FactCards / Shots / Jimeng prompts produced.

Usage:
  PYTHONPATH=. .venv/bin/python -m scripts.run_pilot

This is a smoke driver, not a unit test; it talks to the real (local) DB
defined by .env / DB_PATH so users can inspect the result via the web UI.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient


PILOT_DIR = Path(__file__).resolve().parent.parent / "configs" / "documentary" / "pilot"
TOPICS = [
    ("景德镇制瓷", "jingdezhen.md"),
    ("苏绣", "suxiu.md"),
    ("川剧变脸", "chuanju_bianlian.md"),
]


def _wait(predicate, timeout=60.0):
    start = time.time()
    while time.time() - start < timeout:
        if predicate():
            return True
        time.sleep(0.2)
    return False


def main() -> int:
    from server.main import create_app

    app = create_app()
    summaries = []
    with TestClient(app) as client:
        for title, source in TOPICS:
            material_text = (PILOT_DIR / source).read_text(encoding="utf-8")
            project = client.post(
                "/api/projects",
                json={
                    "title": title,
                    "direction": "documentary",
                    "brief": f"非遗 15 镜 pilot 验证 — {title}",
                },
            ).json()
            pid = project["id"]
            client.post(
                f"/api/projects/{pid}/materials",
                json={"content": material_text, "source_type": "text"},
            )
            run = client.post(
                "/api/runs",
                json={
                    "project_id": pid,
                    "workflow": "documentary_default",
                    "auto_mode": True,
                },
            ).json()
            run_id = run["id"]

            def all_done() -> bool:
                full = client.get(f"/api/runs/{run_id}").json()
                return full["status"] in {"success", "failed"} and all(
                    s["status"] in {"success", "failed", "rejected", "skipped"}
                    for s in full["steps"]
                )

            ok = _wait(all_done, timeout=120.0)
            run_after = client.get(f"/api/runs/{run_id}").json()
            facts = client.get(f"/api/projects/{pid}/facts").json()
            shots = client.get(f"/api/projects/{pid}/shots").json()
            jimeng = sum(
                1
                for s in shots
                for a in s["assets"]
                if a["asset_type"] == "jimeng_video_prompt"
            )
            real_only = sum(1 for s in shots if s["requires_real_footage"])
            summaries.append(
                {
                    "title": title,
                    "project_id": pid,
                    "run_id": run_id,
                    "completed": ok,
                    "run_status": run_after["status"],
                    "fact_cards": len(facts),
                    "shots": len(shots),
                    "jimeng_prompts": jimeng,
                    "real_only_shots": real_only,
                }
            )

    print("\n=== Pilot Summary ===")
    for s in summaries:
        print(
            f"[{s['title']:>12}] facts={s['fact_cards']:>3} shots={s['shots']:>3} "
            f"jimeng={s['jimeng_prompts']:>3} real_only={s['real_only_shots']:>2} "
            f"run={s['run_status']:<8} completed={s['completed']}"
        )
    print(
        "\nproject ids (open in web UI: /projects/<id>):\n  "
        + "\n  ".join(s["project_id"] for s in summaries)
    )

    bad = [s for s in summaries if not s["completed"] or s["shots"] != 15]
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
