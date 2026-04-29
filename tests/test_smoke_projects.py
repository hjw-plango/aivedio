from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_and_list_projects():
    from server.main import create_app

    app = create_app()
    with TestClient(app) as client:
        resp = client.post(
            "/api/projects",
            json={"title": "景德镇 pilot", "direction": "documentary", "brief": "15 镜验证"},
        )
        assert resp.status_code == 200, resp.text
        created = resp.json()
        assert created["title"] == "景德镇 pilot"
        assert created["direction"] == "documentary"
        assert created["status"] == "draft"

        listed = client.get("/api/projects").json()
        assert any(p["id"] == created["id"] for p in listed)

        by_id = client.get(f"/api/projects/{created['id']}").json()
        assert by_id["id"] == created["id"]


def test_invalid_direction_rejected():
    from server.main import create_app

    app = create_app()
    with TestClient(app) as client:
        resp = client.post("/api/projects", json={"title": "x", "direction": "movie"})
    assert resp.status_code == 422
