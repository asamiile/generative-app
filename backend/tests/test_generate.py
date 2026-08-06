from unittest.mock import AsyncMock

import services
from conftest import create_preview_session


def test_generate_preview_requires_auth(client):
    res = client.post("/api/generate/preview", json={"prompt": "a cat"})
    assert res.status_code == 401


def test_generate_preview_rejects_empty_prompt(client, auth_headers):
    res = client.post("/api/generate/preview", json={"prompt": ""}, headers=auth_headers)
    assert res.status_code == 422


def test_generate_preview_success(client, auth_headers, monkeypatch):
    body = create_preview_session(client, auth_headers, monkeypatch, prompt="a cat")

    assert body["enhanced_prompt"] == "enhanced: a cat"
    assert len(body["previews"]) == 4
    assert all(p["status"] == "success" for p in body["previews"])
    assert [p["candidate_index"] for p in body["previews"]] == [0, 1, 2, 3]


def test_generate_preview_partial_failure_marks_only_failed_ones(client, auth_headers, monkeypatch):
    body = create_preview_session(
        client,
        auth_headers,
        monkeypatch,
        prompt="a dog",
        preview_paths=["/static/images/a.jpg", None, "/static/images/c.jpg", None],
    )

    statuses = [p["status"] for p in body["previews"]]
    assert statuses == ["success", "failed", "success", "failed"]


def test_generate_finalize_success(client, auth_headers, monkeypatch):
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    preview_id = preview_body["previews"][1]["preview_id"]
    monkeypatch.setattr(
        services, "generate_final_image", AsyncMock(return_value="/static/images/final.jpg")
    )

    res = client.post(
        "/api/generate/finalize",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["preview_id"] == preview_id
    assert body["status"] == "success"
    assert body["image_path"] == "/static/images/final.jpg"


def test_generate_finalize_multiple_previews_independently(client, auth_headers, monkeypatch):
    """Finalizing two different previews in one session doesn't overwrite each other."""
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    session_id = preview_body["session_id"]
    preview_id_a = preview_body["previews"][0]["preview_id"]
    preview_id_b = preview_body["previews"][2]["preview_id"]

    monkeypatch.setattr(
        services, "generate_final_image", AsyncMock(return_value="/static/images/final-a.jpg")
    )
    client.post(
        "/api/generate/finalize",
        json={"session_id": session_id, "preview_id": preview_id_a},
        headers=auth_headers,
    )

    monkeypatch.setattr(
        services, "generate_final_image", AsyncMock(return_value="/static/images/final-b.jpg")
    )
    client.post(
        "/api/generate/finalize",
        json={"session_id": session_id, "preview_id": preview_id_b},
        headers=auth_headers,
    )

    history = client.get("/api/history", headers=auth_headers).json()
    previews_by_id = {p["preview_id"]: p for p in history[0]["previews"]}

    assert previews_by_id[preview_id_a]["final_image_path"] == "/static/images/final-a.jpg"
    assert previews_by_id[preview_id_b]["final_image_path"] == "/static/images/final-b.jpg"


def test_generate_finalize_rejects_preview_from_other_session(client, auth_headers, monkeypatch):
    first = create_preview_session(client, auth_headers, monkeypatch, prompt="first")
    second = create_preview_session(client, auth_headers, monkeypatch, prompt="second")

    res = client.post(
        "/api/generate/finalize",
        json={
            "session_id": first["session_id"],
            "preview_id": second["previews"][0]["preview_id"],
        },
        headers=auth_headers,
    )

    assert res.status_code == 400


def test_generate_finalize_records_failure_status(client, auth_headers, monkeypatch):
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    preview_id = preview_body["previews"][0]["preview_id"]
    monkeypatch.setattr(services, "generate_final_image", AsyncMock(return_value=None))

    res = client.post(
        "/api/generate/finalize",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "failed"
    assert body["image_path"] is None
