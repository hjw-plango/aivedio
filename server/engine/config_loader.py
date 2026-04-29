"""Load direction-specific configs (prompts / rules / scoring)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from server.settings import get_settings


@dataclass
class DirectionConfig:
    direction: str
    prompts: dict[str, str]
    rules: dict[str, Any]
    scoring: dict[str, Any]


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data if isinstance(data, dict) else {}


def load_direction(direction: str) -> DirectionConfig:
    base = get_settings().configs_dir / direction
    prompts_dir = base / "prompts"
    rules_dir = base / "rules"
    scoring_dir = base / "scoring"

    prompts: dict[str, str] = {}
    if prompts_dir.exists():
        for f in prompts_dir.glob("*.md"):
            prompts[f.stem] = _read_text(f)

    rules: dict[str, Any] = {}
    if rules_dir.exists():
        for f in rules_dir.glob("*.yaml"):
            rules[f.stem] = _read_yaml(f)

    scoring: dict[str, Any] = {}
    if scoring_dir.exists():
        for f in scoring_dir.glob("*.yaml"):
            scoring[f.stem] = _read_yaml(f)

    return DirectionConfig(direction=direction, prompts=prompts, rules=rules, scoring=scoring)
