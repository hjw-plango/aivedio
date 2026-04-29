from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_endpoint_returns_ok():
    from server.main import create_app

    app = create_app()
    with TestClient(app) as client:
        resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in {"ok", "degraded"}
    assert body["db"]["ok"] is True
    assert "models" in body
