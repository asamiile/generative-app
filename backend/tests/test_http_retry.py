import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest

from providers import _http


@pytest.fixture(autouse=True)
def no_real_sleep(monkeypatch):
    # These tests exercise the full retry budget (up to 2+5+10=17s of real sleep) --
    # replace with a no-op so the suite stays fast. No pytest-asyncio in this
    # project (see below), so this stays a plain sync fixture.
    monkeypatch.setattr(_http.asyncio, "sleep", AsyncMock(return_value=None))


def run(coro):
    # No pytest-asyncio dependency for one small test file -- request_with_retry
    # has no fixtures/loop state of its own to juggle, so a bare asyncio.run() per
    # test is simpler than adding a plugin for it.
    return asyncio.run(coro)


def test_returns_immediately_on_success():
    response = httpx.Response(200)
    send = AsyncMock(return_value=response)

    result = run(_http.request_with_retry(send))

    assert result is response
    assert send.await_count == 1


def test_does_not_retry_4xx():
    """4xx is a client error (bad prompt, bad key, quota) that won't succeed on
    retry, unlike a provider's transient overload -- retrying would just waste
    the retry budget on something that can never succeed."""
    response = httpx.Response(400)
    send = AsyncMock(return_value=response)

    result = run(_http.request_with_retry(send))

    assert result is response
    assert send.await_count == 1


def test_retries_5xx_then_succeeds():
    responses = [httpx.Response(503), httpx.Response(503), httpx.Response(200)]
    send = AsyncMock(side_effect=responses)

    result = run(_http.request_with_retry(send))

    assert result.status_code == 200
    assert send.await_count == 3


def test_gives_up_and_returns_last_5xx_after_exhausting_retries():
    send = AsyncMock(return_value=httpx.Response(503))

    result = run(_http.request_with_retry(send))

    assert result.status_code == 503
    # 1 initial attempt + 3 retries (RETRY_DELAYS_SECONDS has 3 entries).
    assert send.await_count == 1 + len(_http.RETRY_DELAYS_SECONDS)


def test_retries_transport_error_then_succeeds():
    response = httpx.Response(200)
    send = AsyncMock(side_effect=[httpx.ConnectError("dropped"), response])

    result = run(_http.request_with_retry(send))

    assert result is response
    assert send.await_count == 2


def test_reraises_transport_error_after_exhausting_retries():
    send = AsyncMock(side_effect=httpx.ConnectError("dropped"))

    with pytest.raises(httpx.ConnectError):
        run(_http.request_with_retry(send))

    assert send.await_count == 1 + len(_http.RETRY_DELAYS_SECONDS)
