"""Prompt-quality regressions for the long-form offline path."""

from __future__ import annotations

import re as _re
import time
from pathlib import Path

from fastapi.testclient import TestClient


PILOT_DIR = Path(__file__).resolve().parent.parent / "configs" / "documentary" / "pilot"

_BANNED_SUBSTRINGS = (
    "来源:",
    "来源：",
    "pilot 资料",
    "```",
    "## ",
    "\n\n\n",
)
_BANNED_LINE_PATTERNS = (_re.compile(r"(?m)^\s*#"),)


def _wait(predicate, timeout=30.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def _run_topic(client: TestClient, title: str, source_file: str) -> dict:
    material = (PILOT_DIR / source_file).read_text(encoding="utf-8")
    project = client.post(
        "/api/projects",
        json={"title": title, "direction": "documentary", "brief": title},
    ).json()
    pid = project["id"]
    client.post(f"/api/projects/{pid}/materials", json={"content": material, "source_type": "text"})
    run = client.post(
        "/api/runs",
        json={"project_id": pid, "workflow": "documentary_default", "auto_mode": True},
    ).json()
    rid = run["id"]

    def done():
        r = client.get(f"/api/runs/{rid}").json()
        return r["status"] == "success" and all(s["status"] == "success" for s in r["steps"])

    assert _wait(done), f"{title} pipeline did not finish"
    return {
        "project_id": pid,
        "facts": client.get(f"/api/projects/{pid}/facts").json(),
        "shots": client.get(f"/api/projects/{pid}/shots").json(),
        "refs": client.get(f"/api/projects/{pid}/assets?asset_type=reference_image_prompt").json(),
    }


def _has_residual_markdown(text: str) -> str | None:
    if not text:
        return None
    for needle in _BANNED_SUBSTRINGS:
        if needle in text:
            return needle
    for pat in _BANNED_LINE_PATTERNS:
        if pat.search(text):
            return pat.pattern
    return None


def test_factcards_have_no_markdown_chrome():
    from server.main import create_app

    with TestClient(create_app()) as client:
        result = _run_topic(client, "景德镇制瓷", "jingdezhen.md")
        assert result["facts"], "produced 0 fact cards"
        for fc in result["facts"]:
            violation = _has_residual_markdown(fc["content"])
            assert violation is None, f"FactCard leaks {violation!r}: {fc['content']!r}"
            assert fc["category"], f"FactCard has no category: {fc['id']}"


def test_first_chapter_prompts_are_detailed_and_reference_aware():
    from server.main import create_app

    with TestClient(create_app()) as client:
        result = _run_topic(client, "景德镇制瓷", "jingdezhen.md")
        shots = result["shots"]
        assert len(shots) == 18
        assert len(result["refs"]) >= 8
        for shot in shots:
            assert shot["subject"].strip()
            prompts = [a for a in shot["assets"] if a["asset_type"] == "jimeng_video_prompt"]
            manifests = [a for a in shot["assets"] if a["asset_type"] == "shot_reference_manifest"]
            assert prompts, f"missing jimeng prompt for shot {shot['sequence']}"
            assert manifests, f"missing reference manifest for shot {shot['sequence']}"
            body = prompts[0]["prompt"]
            violation = _has_residual_markdown(body)
            assert violation is None, f"jimeng prompt leaks {violation!r}\n---\n{body[:300]}"
            assert "参考图使用" in body
            assert "声音与剪辑备注" in body
            assert "负向约束" in body
            assert prompts[0]["meta"]["reference_ids"], "prompt meta missing reference_ids"
            assert prompts[0]["meta"]["duration_seconds"] >= 5
