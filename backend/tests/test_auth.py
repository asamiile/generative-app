import pytest
from fastapi import HTTPException

from auth import verify_token


def test_accepts_correct_bearer_token(monkeypatch):
    monkeypatch.setenv("APP_API_TOKEN", "secret-token")
    verify_token(authorization="Bearer secret-token")


def test_rejects_wrong_token(monkeypatch):
    monkeypatch.setenv("APP_API_TOKEN", "secret-token")
    with pytest.raises(HTTPException) as exc_info:
        verify_token(authorization="Bearer wrong-token")
    assert exc_info.value.status_code == 401


def test_rejects_missing_bearer_scheme(monkeypatch):
    monkeypatch.setenv("APP_API_TOKEN", "secret-token")
    with pytest.raises(HTTPException) as exc_info:
        verify_token(authorization="secret-token")
    assert exc_info.value.status_code == 401


def test_fails_when_server_token_not_configured(monkeypatch):
    monkeypatch.delenv("APP_API_TOKEN", raising=False)
    with pytest.raises(HTTPException) as exc_info:
        verify_token(authorization="Bearer anything")
    assert exc_info.value.status_code == 500
