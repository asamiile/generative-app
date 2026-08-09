from unittest.mock import AsyncMock

from providers import gemini, local
from conftest import create_preview_session


def test_retry_preview_requires_auth(client):
    res = client.post("/api/generate/preview/retry", json={"session_id": 1, "preview_id": 1})
    assert res.status_code == 401


def test_retry_preview_rejects_preview_from_other_session(client, auth_headers, monkeypatch):
    a = create_preview_session(client, auth_headers, monkeypatch, prompt="a")
    b = create_preview_session(client, auth_headers, monkeypatch, prompt="b")

    res = client.post(
        "/api/generate/preview/retry",
        json={"session_id": a["session_id"], "preview_id": b["previews"][0]["preview_id"]},
        headers=auth_headers,
    )

    assert res.status_code == 400


def test_retry_preview_defaults_to_its_own_current_provider(client, auth_headers, monkeypatch):
    """Omitting `provider` on retry means "try again with the same provider", not
    the session's provider -- in this single-retry test those happen to be equal
    (no prior retry to diverge them), so this only proves the plain default path
    doesn't error; the "own provider, not session's" distinction itself is proven
    by test_generate_finalize_defaults_to_retried_provider_not_session_provider."""
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    preview_id = preview_body["previews"][1]["preview_id"]
    retry_mock = AsyncMock(return_value="/static/images/retried.jpg")
    monkeypatch.setattr(gemini, "generate_one_preview", retry_mock)

    res = client.post(
        "/api/generate/preview/retry",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "gemini"
    assert body["status"] == "success"
    assert body["image_path"] == "/static/images/retried.jpg"
    retry_mock.assert_awaited_once()


def test_retry_preview_can_use_a_different_provider(client, auth_headers, monkeypatch):
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    preview_id = preview_body["previews"][2]["preview_id"]
    monkeypatch.setattr(
        local, "generate_one_preview", AsyncMock(return_value="/static/images/local-retry.jpg")
    )

    res = client.post(
        "/api/generate/preview/retry",
        json={
            "session_id": preview_body["session_id"],
            "preview_id": preview_id,
            "provider": "local",
        },
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "local"
    assert body["image_path"] == "/static/images/local-retry.jpg"

    history = client.get("/api/history", headers=auth_headers).json()
    previews = history[0]["previews"]
    retried = next(p for p in previews if p["preview_id"] == preview_id)
    others = [p for p in previews if p["preview_id"] != preview_id]
    assert retried["provider"] == "local"
    assert all(p["provider"] == "gemini" for p in others)


def test_retry_preview_records_failure_without_affecting_others(client, auth_headers, monkeypatch):
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    preview_id = preview_body["previews"][0]["preview_id"]
    monkeypatch.setattr(gemini, "generate_one_preview", AsyncMock(return_value=None))

    res = client.post(
        "/api/generate/preview/retry",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "failed"
    assert body["image_path"] is None

    others_still_ok = [p for p in preview_body["previews"] if p["preview_id"] != preview_id]
    assert all(p["status"] == "success" for p in others_still_ok)


def test_retry_preview_clears_a_previous_finalize_result(client, auth_headers, monkeypatch):
    """The old 4K result was made FROM the old (pre-retry) image as a reference --
    once retry replaces that image, the stale finalize result no longer matches
    what the preview now shows, so it must be cleared, not left dangling."""
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    preview_id = preview_body["previews"][0]["preview_id"]
    monkeypatch.setattr(
        gemini, "generate_final_image", AsyncMock(return_value="/static/images/final.jpg")
    )
    client.post(
        "/api/generate/finalize",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    monkeypatch.setattr(
        gemini, "generate_one_preview", AsyncMock(return_value="/static/images/retried.jpg")
    )
    res = client.post(
        "/api/generate/preview/retry",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["final_image_path"] is None
    assert body["final_status"] is None
    assert body["final_provider"] is None
    assert body["finalized_at"] is None
