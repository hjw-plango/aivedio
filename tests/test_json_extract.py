from __future__ import annotations

import json

from server.utils.json_extract import extract_json_payload


def test_extracts_fenced_json_anywhere():
    text = 'Sure:\n```json\n{"ok": true}\n```\nDone.'
    assert json.loads(extract_json_payload(text)) == {"ok": True}


def test_extracts_inline_object():
    text = 'Yes, `{"ok": true}` is valid JSON.'
    assert json.loads(extract_json_payload(text)) == {"ok": True}


def test_extracts_array_with_nested_strings():
    text = 'Result: [{"a": "brace } inside", "b": [1, 2]}]'
    assert json.loads(extract_json_payload(text)) == [{"a": "brace } inside", "b": [1, 2]}]

