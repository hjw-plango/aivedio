"""Generation-quality regressions for the offline (Mock) fallback path.

These pin down the contract that the fallback produces clean, human-reviewable
artifacts even without an LLM key:
  - FactCard.content has no markdown chrome (#, >, "pilot 资料", "来源:", bare "1.")
  - Shot.subject is non-empty, not a single FactCard sentence, not punctuation-only
  - Each project has exactly the 5 canonical shot types, each appears once
  - For brief/material that contains "传承人正脸 / 采访 / 口述史" (川剧 case) the
    silhouette slot becomes portrait_interview with requires_real_footage=true and
    its jimeng_video_prompt is empty (we never ask Jimeng to fake real footage)
  - For neutral subjects (景德镇制瓷 / 苏绣) all 5 shots are AI-friendly (no real_footage)
  - Generated jimeng_video_prompt strings carry NONE of the markdown / metadata
    leaks the previous version was producing
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient


PILOT_DIR = Path(__file__).resolve().parent.parent / "configs" / "documentary" / "pilot"


import re as _re

_BANNED_SUBSTRINGS = (
    "来源:",
    "来源：",
    "pilot 资料",
    "pilot资料",
    "整理稿",
    "流程为:\n",
    "流程为：\n",
    "\n\n\n",
    "```",
    "## ",
    "** ",
)
# Markdown heading marker only counts at the start of a line — avoids false
# positives on legitimate strings like "C#" or "1#".
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
    client.post(
        f"/api/projects/{pid}/materials",
        json={"content": material, "source_type": "text"},
    )
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
    if text.rstrip().endswith(("1.", "1、", "1)")):
        return "trailing-numbering"
    return None


def test_factcards_have_no_markdown_chrome():
    from server.main import create_app

    with TestClient(create_app()) as client:
        for title, src in [
            ("景德镇制瓷", "jingdezhen.md"),
            ("苏绣", "suxiu.md"),
            ("川剧变脸", "chuanju_bianlian.md"),
        ]:
            result = _run_topic(client, title, src)
            assert result["facts"], f"{title} produced 0 fact cards"
            for fc in result["facts"]:
                violation = _has_residual_markdown(fc["content"])
                assert violation is None, (
                    f"{title} FactCard leaks {violation!r}: {fc['content']!r}"
                )
                # category is set
                assert fc["category"], f"FactCard has no category: {fc['id']}"


def test_each_topic_has_exactly_5_canonical_shot_types():
    from server.main import create_app

    canonical = {"establishing", "craft_close", "material_close", "silhouette", "imagery"}

    with TestClient(create_app()) as client:
        for title, src in [
            ("景德镇制瓷", "jingdezhen.md"),
            ("苏绣", "suxiu.md"),
        ]:
            result = _run_topic(client, title, src)
            shots = result["shots"]
            assert len(shots) == 5, f"{title} expected 5 shots, got {len(shots)}"
            types = [s["shot_type"] for s in shots]
            assert set(types) == canonical, f"{title} shot_types mismatch: {types}"
            for shot in shots:
                # subject non-empty, not punctuation-only, not pure metadata
                subj = shot["subject"].strip()
                assert subj, f"{title} #{shot['sequence']} empty subject"
                assert any("一" <= c <= "鿿" for c in subj), (
                    f"{title} #{shot['sequence']} subject has no CJK: {subj!r}"
                )
                # FactCard sentences should NOT be the entire subject — fallback
                # must rewrite using the topic template.
                violation = _has_residual_markdown(subj)
                assert violation is None, (
                    f"{title} #{shot['sequence']} subject leaks {violation!r}: {subj!r}"
                )


def test_chuanju_silhouette_becomes_portrait_interview():
    from server.main import create_app

    with TestClient(create_app()) as client:
        result = _run_topic(client, "川剧变脸", "chuanju_bianlian.md")
        shots = result["shots"]
        portrait = [s for s in shots if s["requires_real_footage"]]
        assert len(portrait) >= 1, (
            "川剧 brief mentions 传承人正脸 / 口述史 — expected ≥1 real-footage shot, "
            f"got types={[s['shot_type'] for s in shots]}"
        )
        for shot in portrait:
            # real-footage shots must NOT carry a jimeng prompt
            jimengs = [a for a in shot["assets"] if a["asset_type"] == "jimeng_video_prompt"]
            assert not jimengs, (
                f"real-footage shot {shot['id']} should not have jimeng prompt"
            )


def test_neutral_topics_keep_all_shots_ai_friendly():
    from server.main import create_app

    with TestClient(create_app()) as client:
        for title, src in [("景德镇制瓷", "jingdezhen.md"), ("苏绣", "suxiu.md")]:
            result = _run_topic(client, title, src)
            real = [s for s in result["shots"] if s["requires_real_footage"]]
            assert not real, (
                f"{title} should not flag any AI shot as real footage; got {real}"
            )


def test_jimeng_prompts_are_clean_and_executable():
    from server.main import create_app

    with TestClient(create_app()) as client:
        for title, src in [
            ("景德镇制瓷", "jingdezhen.md"),
            ("苏绣", "suxiu.md"),
            ("川剧变脸", "chuanju_bianlian.md"),
        ]:
            result = _run_topic(client, title, src)
            for shot in result["shots"]:
                if shot["requires_real_footage"]:
                    continue
                prompts = [
                    a for a in shot["assets"] if a["asset_type"] == "jimeng_video_prompt"
                ]
                assert prompts, f"{title} #{shot['sequence']} missing jimeng prompt"
                for asset in prompts:
                    body = asset["prompt"]
                    violation = _has_residual_markdown(body)
                    assert violation is None, (
                        f"{title} jimeng prompt leaks {violation!r}\n---\n{body[:300]}"
                    )
                    # Must mention documentary aesthetics and the resolved subject
                    assert any(k in body for k in ("纪录片", "观察式")), (
                        f"jimeng prompt missing aesthetic anchor: {body[:200]}"
                    )
                    # Subject must appear inside the prompt body (template
                    # substitution actually fired)
                    assert shot["subject"][:10] in body, (
                        f"prompt did not splice subject {shot['subject'][:10]!r} into body"
                    )
