from __future__ import annotations


def test_router_falls_back_to_mock_when_no_keys():
    from server.engine.router import ModelRouter

    router = ModelRouter.from_settings()
    result = router.call("research", "测试 prompt")
    assert result.text.startswith("[mock:")
    assert result.model
    assert result.task_type == "research"


def test_router_cross_check_attaches_secondary():
    from server.engine.router import ModelRouter

    router = ModelRouter.from_settings()
    result = router.call("structure", "another prompt", cross_check=True)
    assert result.cross_check is not None
    assert result.cross_check.text.startswith("[mock:")


def test_router_records_model_call():
    from server.data.models import ModelCall
    from server.data.session import session_scope
    from server.engine.router import ModelRouter

    router = ModelRouter.from_settings()
    router.call("lightweight", "ping")

    with session_scope() as session:
        rows = session.query(ModelCall).all()
    assert len(rows) >= 1
    last = rows[-1]
    assert last.task_type == "lightweight"
    assert last.status == "ok"
