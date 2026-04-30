"""Helpers for pulling JSON payloads out of model text.

Real providers often wrap JSON in markdown fences or short explanations even
when the prompt says "JSON only". Agents still validate with json.loads after
this helper; it only extracts the most likely payload.
"""

from __future__ import annotations

import json
import re


_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def extract_json_payload(text: str) -> str:
    """Return a JSON object/array substring when one can be safely parsed."""
    stripped = text.strip()
    if not stripped:
        return stripped

    if _is_json(stripped):
        return stripped

    for match in _FENCE_RE.finditer(stripped):
        candidate = match.group(1).strip()
        if _is_json(candidate):
            return candidate

    inline = _extract_balanced_json(stripped)
    if inline and _is_json(inline):
        return inline

    return stripped


def _is_json(value: str) -> bool:
    try:
        json.loads(value)
    except Exception:
        return False
    return True


def _extract_balanced_json(text: str) -> str | None:
    starts = [i for i, ch in enumerate(text) if ch in "[{"]
    for start in starts:
        candidate = _scan_from(text, start)
        if candidate:
            return candidate
    return None


def _scan_from(text: str, start: int) -> str | None:
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    stack = [closer]
    in_string = False
    escaped = False

    for idx in range(start + 1, len(text)):
        ch = text[idx]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue
        if ch == "{":
            stack.append("}")
            continue
        if ch == "[":
            stack.append("]")
            continue
        if ch in "}]":
            if not stack or ch != stack[-1]:
                return None
            stack.pop()
            if not stack:
                return text[start : idx + 1].strip()

    return None

