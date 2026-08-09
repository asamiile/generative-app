from unittest.mock import AsyncMock

from providers import gemini, local, openai, stability
from conftest import create_preview_session


def test_generate_preview_requires_auth(client):
    res = client.post("/api/generate/preview", json={"prompt": "a cat"})
    assert res.status_code == 401


def test_get_available_providers_requires_auth(client):
    res = client.get("/api/providers")
    assert res.status_code == 401


def test_get_available_providers_local_and_gemini_only_by_default(client, auth_headers, monkeypatch):
    """conftest.py sets GEMINI_API_KEY but not OPENAI_API_KEY/STABILITY_API_KEY --
    local is always available (no key needed), gemini has a key, the other two don't."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("STABILITY_API_KEY", raising=False)
    res = client.get("/api/providers", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == ["local", "gemini"]


def test_get_available_providers_includes_providers_with_keys_set(client, auth_headers, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("STABILITY_API_KEY", "test-stability-key")
    res = client.get("/api/providers", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == ["local", "gemini", "openai", "stability"]


def test_generate_preview_rejects_empty_prompt(client, auth_headers):
    res = client.post(
        "/api/generate/preview", json={"prompt": "", "provider": "gemini"}, headers=auth_headers
    )
    assert res.status_code == 422


def test_generate_preview_rejects_missing_provider(client, auth_headers):
    res = client.post("/api/generate/preview", json={"prompt": "a cat"}, headers=auth_headers)
    assert res.status_code == 422


def test_generate_preview_expand_prompt_failure_returns_clean_error(client, auth_headers, monkeypatch):
    """None of the providers' expand_prompt catches its own errors -- main.py wraps
    the call for every provider and turns any exception into a 502 instead of an
    unhandled 500, and doesn't create a session row (nothing was generated yet)."""
    monkeypatch.setattr(gemini, "expand_prompt", AsyncMock(side_effect=RuntimeError("boom")))

    res = client.post(
        "/api/generate/preview", json={"prompt": "a cat", "provider": "gemini"}, headers=auth_headers
    )

    assert res.status_code == 502
    assert "boom" in res.json()["detail"]

    history = client.get("/api/history", headers=auth_headers).json()
    assert history == []


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
        gemini, "generate_final_image", AsyncMock(return_value="/static/images/final.jpg")
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
        gemini, "generate_final_image", AsyncMock(return_value="/static/images/final-a.jpg")
    )
    client.post(
        "/api/generate/finalize",
        json={"session_id": session_id, "preview_id": preview_id_a},
        headers=auth_headers,
    )

    monkeypatch.setattr(
        gemini, "generate_final_image", AsyncMock(return_value="/static/images/final-b.jpg")
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
    monkeypatch.setattr(gemini, "generate_final_image", AsyncMock(return_value=None))

    res = client.post(
        "/api/generate/finalize",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "failed"
    assert body["image_path"] is None


def test_generate_finalize_defaults_to_session_provider(client, auth_headers, monkeypatch):
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    assert preview_body["provider"] == "gemini"
    preview_id = preview_body["previews"][0]["preview_id"]
    monkeypatch.setattr(
        gemini, "generate_final_image", AsyncMock(return_value="/static/images/final.jpg")
    )

    res = client.post(
        "/api/generate/finalize",
        json={"session_id": preview_body["session_id"], "preview_id": preview_id},
        headers=auth_headers,
    )

    assert res.status_code == 200
    assert res.json()["provider"] == "gemini"


def test_generate_finalize_can_use_a_different_provider_than_the_session(
    client, auth_headers, monkeypatch
):
    """Local-CPU finalize can be too slow, so finalize's provider is independent
    of the session's (preview-generating) provider -- see .agents/docs/api.md."""
    preview_body = create_preview_session(client, auth_headers, monkeypatch)
    assert preview_body["provider"] == "gemini"
    preview_id = preview_body["previews"][0]["preview_id"]
    monkeypatch.setattr(
        local, "generate_final_image", AsyncMock(return_value="/static/images/final-local.jpg")
    )

    res = client.post(
        "/api/generate/finalize",
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
    assert body["image_path"] == "/static/images/final-local.jpg"

    history = client.get("/api/history", headers=auth_headers).json()
    finalized_preview = next(p for p in history[0]["previews"] if p["preview_id"] == preview_id)
    assert finalized_preview["final_provider"] == "local"


def test_generate_preview_with_openai_provider(client, auth_headers, monkeypatch):
    monkeypatch.setattr(openai, "expand_prompt", AsyncMock(return_value="enhanced: a cat"))
    monkeypatch.setattr(
        openai,
        "generate_preview_batch",
        AsyncMock(
            return_value=[
                "/static/images/a.jpg",
                "/static/images/b.jpg",
                "/static/images/c.jpg",
                "/static/images/d.jpg",
            ]
        ),
    )

    res = client.post(
        "/api/generate/preview",
        json={"prompt": "a cat", "provider": "openai"},
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "openai"
    assert all(p["status"] == "success" for p in body["previews"])


def test_generate_preview_with_stability_provider_delegates_prompt_expansion_to_local_by_default(
    client, auth_headers, monkeypatch
):
    """stability.expand_prompt delegates to another provider (default: local/Ollama,
    so no extra cloud API key is needed for the text step), since Stability has no
    general-purpose text API -- see providers/stability.py."""
    monkeypatch.setattr(local, "expand_prompt", AsyncMock(return_value="enhanced via local"))
    monkeypatch.setattr(
        stability,
        "generate_preview_batch",
        AsyncMock(
            return_value=[
                "/static/images/a.jpg",
                "/static/images/b.jpg",
                "/static/images/c.jpg",
                "/static/images/d.jpg",
            ]
        ),
    )

    res = client.post(
        "/api/generate/preview",
        json={"prompt": "a cat", "provider": "stability"},
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "stability"
    assert body["enhanced_prompt"] == "enhanced via local"


def test_generate_preview_with_stability_provider_text_backend_is_configurable(
    client, auth_headers, monkeypatch
):
    """STABILITY_TEXT_PROVIDER lets the delegated text backend be swapped (e.g. to
    openai) instead of always using the default (local)."""
    monkeypatch.setattr(stability, "STABILITY_TEXT_PROVIDER", "openai")
    monkeypatch.setattr(openai, "expand_prompt", AsyncMock(return_value="enhanced via openai"))
    monkeypatch.setattr(
        stability,
        "generate_preview_batch",
        AsyncMock(
            return_value=[
                "/static/images/a.jpg",
                "/static/images/b.jpg",
                "/static/images/c.jpg",
                "/static/images/d.jpg",
            ]
        ),
    )

    res = client.post(
        "/api/generate/preview",
        json={"prompt": "a cat", "provider": "stability"},
        headers=auth_headers,
    )

    assert res.status_code == 200
    assert res.json()["enhanced_prompt"] == "enhanced via openai"


def test_generate_finalize_with_openai_provider(client, auth_headers, monkeypatch):
    monkeypatch.setattr(gemini, "expand_prompt", AsyncMock(return_value="enhanced: a cat"))
    monkeypatch.setattr(
        gemini,
        "generate_preview_batch",
        AsyncMock(
            return_value=[
                "/static/images/a.jpg",
                "/static/images/b.jpg",
                "/static/images/c.jpg",
                "/static/images/d.jpg",
            ]
        ),
    )
    preview_res = client.post(
        "/api/generate/preview", json={"prompt": "a cat", "provider": "gemini"}, headers=auth_headers
    )
    preview_body = preview_res.json()
    preview_id = preview_body["previews"][0]["preview_id"]

    monkeypatch.setattr(
        openai, "generate_final_image", AsyncMock(return_value="/static/images/final-openai.jpg")
    )

    res = client.post(
        "/api/generate/finalize",
        json={
            "session_id": preview_body["session_id"],
            "preview_id": preview_id,
            "provider": "openai",
        },
        headers=auth_headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "openai"
    assert body["image_path"] == "/static/images/final-openai.jpg"
