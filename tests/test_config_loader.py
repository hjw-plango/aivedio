from __future__ import annotations


def test_load_documentary_config_has_prompts_and_rules():
    from server.engine.config_loader import load_direction

    cfg = load_direction("documentary")
    assert "research" in cfg.prompts
    assert "shot_prompt" in cfg.prompts
    assert "red_lines" in cfg.rules
    assert cfg.rules["red_lines"]["rules"], "red_lines must define rules"
    assert "failure_tags" in cfg.scoring
