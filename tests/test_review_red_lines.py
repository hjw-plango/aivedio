"""Verify red-line scan catches both substring and semantic rules."""

from __future__ import annotations

from server.agents.review import _local_red_line_scan
from server.engine.config_loader import load_direction


def _rules() -> list[dict]:
    cfg = load_direction("documentary")
    return (cfg.rules.get("red_lines") or {}).get("rules", [])


def test_substring_red_line_inheritor_face():
    rules = _rules()
    shots = [
        {
            "shot_id": "shot1",
            "subject": "传承人正脸特写",
            "jimeng_prompt": "",
            "fact_refs": ["fc_x"],
        }
    ]
    hits = _local_red_line_scan(rules, shots, [])
    assert any(h["rule_id"] == "rl_inheritor_face" for h in hits)


def test_substring_red_line_ad_style_in_narration():
    rules = _rules()
    hits = _local_red_line_scan(
        rules,
        [],
        [{"shot_seq": 1, "text": "传承千年的匠心,惊艳呈现"}],
    )
    assert any(h["rule_id"] == "rl_ad_style" for h in hits)


def test_semantic_wrong_craft_triggers_on_missing_fact_refs():
    rules = _rules()
    shots = [
        {
            "shot_id": "shot_bad",
            "subject": "拉坯工序",
            "jimeng_prompt": "工匠先将瓷土上轮,再修坯,然后烧制",
            "fact_refs": [],
            "requires_real_footage": False,
        }
    ]
    hits = _local_red_line_scan(rules, shots, [])
    assert any(h["rule_id"] == "rl_wrong_craft" for h in hits), hits


def test_semantic_wrong_craft_passes_when_facts_present():
    rules = _rules()
    shots = [
        {
            "shot_id": "shot_ok",
            "subject": "拉坯工序",
            "jimeng_prompt": "瓷土在轮上成形,先粗坯,再修坯",
            "fact_refs": ["fc_lapo"],
            "requires_real_footage": False,
        }
    ]
    hits = _local_red_line_scan(rules, shots, [])
    assert not any(h["rule_id"] == "rl_wrong_craft" for h in hits)


def test_semantic_wrong_craft_skips_real_footage_shots():
    rules = _rules()
    shots = [
        {
            "shot_id": "shot_real",
            "subject": "传承人讲解工序",
            "jimeng_prompt": "",
            "fact_refs": [],
            "requires_real_footage": True,
        }
    ]
    hits = _local_red_line_scan(rules, shots, [])
    assert not any(h["rule_id"] == "rl_wrong_craft" for h in hits)


def test_red_line_scan_ignores_negative_prompt_constraints():
    rules = _rules()
    shots = [
        {
            "shot_id": "shot_prompt",
            "subject": "窑口火光意象",
            "jimeng_prompt": "观察式纪录片镜头。\n禁止:\n- 把 AI 镜头冒充真实历史影像",
            "fact_refs": ["fc_x"],
            "requires_real_footage": False,
        }
    ]
    hits = _local_red_line_scan(rules, shots, [])
    assert not any(h["rule_id"] == "rl_fake_archive" for h in hits), hits


def test_red_line_scan_ignores_negated_inline_trigger():
    rules = _rules()
    shots = [
        {
            "shot_id": "shot_negated",
            "subject": "手部整理脸谱",
            "composition": "手部特写，避开传承人正脸，强调脸谱叠合层次",
            "jimeng_prompt": "",
            "fact_refs": ["fc_x"],
            "requires_real_footage": False,
        }
    ]
    hits = _local_red_line_scan(rules, shots, [])
    assert not any(h["rule_id"] == "rl_inheritor_face" for h in hits), hits
