from __future__ import annotations

from server.agents.storyboard import _normalize_model_shot


def test_normalize_model_shot_generates_id_for_empty_model_value():
    shot = {"shot_id": "", "requires_real_footage": "false", "fact_refs": []}
    _normalize_model_shot(shot, 3, [])
    assert shot["shot_id"].startswith("shot_")
    assert shot["sequence"] == 3
    assert shot["requires_real_footage"] is False


def test_normalize_model_shot_promotes_real_only_fact_refs():
    shot = {
        "shot_id": "",
        "requires_real_footage": False,
        "fact_refs": ["fc_real"],
    }
    facts = [
        {
            "fact_id": "fc_real",
            "content": "御窑遗址、龙窑结构、传承人口述属于真实拍摄范畴。",
        }
    ]
    _normalize_model_shot(shot, 1, facts)
    assert shot["requires_real_footage"] is True

