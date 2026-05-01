"""Stepwise documentary workflow test driver.

Creates a project, uploads one source file, starts the workflow in manual mode,
then resumes exactly one step at a time:

research -> writer -> memory -> storyboard -> review

Default mode forces MockProvider for stable local testing. Use --real-models to
let the script use .env model settings.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient


REPO_ROOT = Path(__file__).resolve().parent.parent
PILOT_DIR = REPO_ROOT / "configs" / "documentary" / "pilot"
DEFAULT_SOURCE = PILOT_DIR / "jingdezhen.md"
EXPECTED_STEPS = ["research", "writer", "memory", "storyboard", "review"]


def _wait(predicate, timeout: float) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        if predicate():
            return True
        time.sleep(0.2)
    return False


def _run_state(client: TestClient, run_id: str) -> dict[str, Any]:
    return client.get(f"/api/runs/{run_id}").json()


def _step(run: dict[str, Any], step_name: str) -> dict[str, Any]:
    return next(s for s in run["steps"] if s["step_name"] == step_name)


def _wait_step_done(client: TestClient, run_id: str, step_name: str, timeout: float) -> dict[str, Any]:
    def done() -> bool:
        run = _run_state(client, run_id)
        step = _step(run, step_name)
        return step["status"] in {"success", "failed", "rejected", "skipped"}

    if not _wait(done, timeout):
        run = _run_state(client, run_id)
        statuses = [(s["step_name"], s["status"]) for s in run["steps"]]
        raise RuntimeError(f"等待 {step_name} 超时,当前状态: {statuses}")
    return _run_state(client, run_id)


def _count_assets(client: TestClient, project_id: str, asset_type: str) -> int:
    return len(client.get(f"/api/projects/{project_id}/assets?asset_type={asset_type}").json())


def _print_step_summary(client: TestClient, project_id: str, run: dict[str, Any], step_name: str) -> None:
    step = _step(run, step_name)
    print(f"\n[{step_name}] status={step['status']}")
    print(f"summary={step['output_summary']}")
    if step["warnings"]:
        print(f"warnings={step['warnings']}")
    if step["error"]:
        print(f"error={step['error'][:500]}")

    if step_name == "research":
        facts = client.get(f"/api/projects/{project_id}/facts").json()
        print(f"fact_cards={len(facts)}")
        for fc in facts[:3]:
            print(f"  - {fc['category']}: {fc['content'][:90]}")
    elif step_name == "writer":
        data = client.get(f"/api/runs/{run['id']}").json()
        writer_step = _step(data, "writer")
        print(f"artifact_refs={writer_step['artifact_refs']}")
    elif step_name == "memory":
        memory_count = _count_assets(client, project_id, "production_memory")
        ref_count = _count_assets(client, project_id, "reference_image_prompt")
        print(f"production_memory={memory_count} reference_image_prompts={ref_count}")
    elif step_name == "storyboard":
        shots = client.get(f"/api/projects/{project_id}/shots").json()
        jimeng = sum(
            1
            for shot in shots
            for asset in shot["assets"]
            if asset["asset_type"] == "jimeng_video_prompt" and asset["prompt"]
        )
        total_seconds = int(sum(float(s["duration_estimate"]) for s in shots))
        print(f"shots={len(shots)} total_seconds={total_seconds} jimeng_prompts={jimeng}")
        for shot in shots[:3]:
            print(f"  - #{shot['sequence']} {shot['shot_type']} {shot['duration_estimate']}s: {shot['subject'][:80]}")
    elif step_name == "review":
        events = client.get(f"/api/runs/{run['id']}/events").json()
        print(f"events={len(events)}")


def _maybe_pause(interactive: bool, step_name: str) -> None:
    if interactive:
        input(f"\n已完成 {step_name},按 Enter 继续下一步...")


def main() -> int:
    parser = argparse.ArgumentParser(description="逐流程测试纪录片生产链路")
    parser.add_argument("--source", default=str(DEFAULT_SOURCE), help="输入资料 md/txt 路径")
    parser.add_argument("--title", default="逐流程测试-景德镇制瓷")
    parser.add_argument(
        "--brief",
        default="做一部 12 分钟左右的观察式非遗纪录片,先完整规划全片,并生产第一章 3 分钟可用分镜。",
    )
    parser.add_argument("--timeout", type=float, default=240.0)
    parser.add_argument("--interactive", action="store_true", help="每一步结束后等待回车")
    parser.add_argument("--real-models", action="store_true", help="使用 .env 中真实模型配置")
    args = parser.parse_args()

    source_path = Path(args.source)
    if not source_path.exists():
        raise FileNotFoundError(source_path)

    if not args.real_models:
        os.environ["FORCE_MOCK_PROVIDER"] = "true"

    # Import after environment selection so Settings reads the desired mode.
    from server.settings import get_settings

    get_settings.cache_clear()  # type: ignore[attr-defined]

    from server.main import create_app

    material_text = source_path.read_text(encoding="utf-8")

    with TestClient(create_app()) as client:
        project = client.post(
            "/api/projects",
            json={"title": args.title, "direction": "documentary", "brief": args.brief},
        ).json()
        project_id = project["id"]
        client.post(
            f"/api/projects/{project_id}/materials",
            json={"content": material_text, "source_type": "text"},
        )
        run = client.post(
            "/api/runs",
            json={"project_id": project_id, "workflow": "documentary_default", "auto_mode": False},
        ).json()
        run_id = run["id"]

        print("\n=== Stepwise Documentary Flow ===")
        print(f"project_id={project_id}")
        print(f"run_id={run_id}")
        print(f"mode={'real-models' if args.real_models else 'mock'}")

        for index, step_name in enumerate(EXPECTED_STEPS):
            run_after_step = _wait_step_done(client, run_id, step_name, args.timeout)
            _print_step_summary(client, project_id, run_after_step, step_name)
            if _step(run_after_step, step_name)["status"] != "success":
                print("\n流程中止:当前步骤未成功")
                return 1
            if index < len(EXPECTED_STEPS) - 1:
                _maybe_pause(args.interactive, step_name)
                client.post(f"/api/runs/{run_id}/resume")

        final_run = _run_state(client, run_id)
        print("\n=== Final ===")
        print(f"run_status={final_run['status']}")
        print(f"memory_url=/projects/{project_id}/memory")
        print(f"shots_url=/projects/{project_id}/shots")
        return 0 if final_run["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
