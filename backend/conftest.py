import os
import tempfile
from collections.abc import Iterator
from unittest.mock import AsyncMock

# main/database importより前に、テスト用の環境変数とDBを用意する。
_TEST_DB_FD, _TEST_DB_PATH = tempfile.mkstemp(suffix=".db")
os.close(_TEST_DB_FD)

# setdefaultではなく直接代入する: このプロセスがdocker-compose経由で起動している場合、
# backend/.envの本物の値(APP_API_TOKEN・RATE_LIMIT_PER_HOUR=10など)が既にos.environに
# 入っており、setdefaultだと上書きされずテストがレート制限に引っかかる。
os.environ["APP_API_TOKEN"] = "test-token"
os.environ["GEMINI_API_KEY"] = "test-key"
os.environ["RATE_LIMIT_PER_HOUR"] = "1000"
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH}"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
import main
import services
from models import Base

DEFAULT_PREVIEW_PATHS = [
    "/static/images/a.jpg",
    "/static/images/b.jpg",
    "/static/images/c.jpg",
    "/static/images/d.jpg",
]


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """テストごとに独立した一時SQLite DBを使うFastAPI TestClient。"""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db() -> Iterator:
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[database.get_db] = override_get_db
    try:
        with TestClient(main.app) as test_client:
            yield test_client
    finally:
        main.app.dependency_overrides.clear()
        engine.dispose()
        os.remove(path)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {os.environ['APP_API_TOKEN']}"}


def create_preview_session(
    client: TestClient,
    headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    prompt: str = "a cat",
    preview_paths: list[str | None] | None = None,
) -> dict:
    """services.pyのGemini呼び出しをモックして/api/generate/previewを叩く。"""
    monkeypatch.setattr(services, "expand_prompt", AsyncMock(return_value=f"enhanced: {prompt}"))
    monkeypatch.setattr(
        services,
        "generate_preview_batch",
        AsyncMock(return_value=preview_paths or list(DEFAULT_PREVIEW_PATHS)),
    )
    res = client.post("/api/generate/preview", json={"prompt": prompt}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()
