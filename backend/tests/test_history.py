from unittest.mock import AsyncMock

import services
from conftest import create_preview_session


def test_history_requires_auth(client):
    res = client.get("/api/history")
    assert res.status_code == 401


def test_history_includes_unfinalized_sessions_with_previews(client, auth_headers, monkeypatch):
    preview_body = create_preview_session(client, auth_headers, monkeypatch)

    res = client.get("/api/history", headers=auth_headers)

    assert res.status_code == 200
    sessions = res.json()
    assert len(sessions) == 1
    session = sessions[0]
    assert session["session_id"] == preview_body["session_id"]
    assert session["final_status"] is None
    assert session["final_image_path"] is None
    assert session["selected_preview_id"] is None
    assert len(session["previews"]) == 4


def test_history_reflects_finalized_session(client, auth_headers, monkeypatch):
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    preview_id = preview_body["previews"][2]["preview_id"]
    monkeypatch.setattr(
        services, "generate_final_image", AsyncMock(return_value="/static/images/final.jpg")
    )
    client.post(
        "/api/generate/finalize",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    res = client.get("/api/history", headers=auth_headers)

    session = res.json()[0]
    assert session["final_status"] == "success"
    assert session["final_image_path"] == "/static/images/final.jpg"
    assert session["selected_preview_id"] == preview_id


def test_history_orders_newest_first_and_paginates(client, auth_headers, monkeypatch):
    create_preview_session(client, auth_headers, monkeypatch, prompt="first")
    create_preview_session(client, auth_headers, monkeypatch, prompt="second")
    create_preview_session(client, auth_headers, monkeypatch, prompt="third")

    res = client.get("/api/history?limit=2&offset=0", headers=auth_headers)
    sessions = res.json()

    assert len(sessions) == 2
    assert sessions[0]["original_prompt"] == "third"
    assert sessions[1]["original_prompt"] == "second"
