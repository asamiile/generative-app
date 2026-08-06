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
    assert len(session["previews"]) == 4
    assert all(p["final_status"] is None and p["final_image_path"] is None for p in session["previews"])


def test_history_reflects_finalized_preview_without_affecting_others(client, auth_headers, monkeypatch):
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

    previews = res.json()[0]["previews"]
    finalized = next(p for p in previews if p["preview_id"] == preview_id)
    others = [p for p in previews if p["preview_id"] != preview_id]

    assert finalized["final_status"] == "success"
    assert finalized["final_image_path"] == "/static/images/final.jpg"
    assert all(p["final_status"] is None and p["final_image_path"] is None for p in others)


def test_history_orders_newest_first_by_default_and_paginates(client, auth_headers, monkeypatch):
    create_preview_session(client, auth_headers, monkeypatch, prompt="first")
    create_preview_session(client, auth_headers, monkeypatch, prompt="second")
    create_preview_session(client, auth_headers, monkeypatch, prompt="third")

    res = client.get("/api/history?limit=2&offset=0", headers=auth_headers)
    sessions = res.json()

    assert len(sessions) == 2
    assert sessions[0]["original_prompt"] == "third"
    assert sessions[1]["original_prompt"] == "second"


def test_history_sort_oldest_reverses_order(client, auth_headers, monkeypatch):
    create_preview_session(client, auth_headers, monkeypatch, prompt="first")
    create_preview_session(client, auth_headers, monkeypatch, prompt="second")
    create_preview_session(client, auth_headers, monkeypatch, prompt="third")

    res = client.get("/api/history?sort=oldest", headers=auth_headers)
    prompts = [s["original_prompt"] for s in res.json()]

    assert prompts == ["first", "second", "third"]


def test_history_rejects_invalid_sort_value(client, auth_headers, monkeypatch):
    create_preview_session(client, auth_headers, monkeypatch)

    res = client.get("/api/history?sort=bogus", headers=auth_headers)

    assert res.status_code == 422
