from unittest.mock import AsyncMock

from providers import gemini
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
        gemini, "generate_final_image", AsyncMock(return_value="/static/images/final.jpg")
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


def test_history_search_filters_by_prompt_substring(client, auth_headers, monkeypatch):
    create_preview_session(client, auth_headers, monkeypatch, prompt="a quiet mountain inn")
    create_preview_session(client, auth_headers, monkeypatch, prompt="a busy city street")

    res = client.get("/api/history?q=mountain", headers=auth_headers)

    prompts = [s["original_prompt"] for s in res.json()]
    assert prompts == ["a quiet mountain inn"]


def test_history_search_is_case_insensitive(client, auth_headers, monkeypatch):
    create_preview_session(client, auth_headers, monkeypatch, prompt="Tokyo at Night")

    res = client.get("/api/history?q=tokyo", headers=auth_headers)

    assert len(res.json()) == 1


def test_history_search_still_paginates_matches(client, auth_headers, monkeypatch):
    # A regression check for the bug this replaces: search used to filter only the
    # currently-loaded page client-side, so a match outside the first page was
    # unreachable -- "Load more" was also hidden whenever a query was active.
    create_preview_session(client, auth_headers, monkeypatch, prompt="mountain one")
    create_preview_session(client, auth_headers, monkeypatch, prompt="mountain two")
    create_preview_session(client, auth_headers, monkeypatch, prompt="unrelated")

    res = client.get("/api/history?q=mountain&limit=1&offset=0", headers=auth_headers)
    first_page = res.json()
    assert len(first_page) == 1

    res = client.get("/api/history?q=mountain&limit=1&offset=1", headers=auth_headers)
    second_page = res.json()
    assert len(second_page) == 1
    assert second_page[0]["session_id"] != first_page[0]["session_id"]
