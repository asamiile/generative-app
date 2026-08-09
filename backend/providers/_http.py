from __future__ import annotations

"""Shared retry helper for httpx-based providers (openai.py, stability.py).

gemini.py has its own retry (it catches google.genai.errors.ServerError, an SDK
exception type, not a raw httpx status) and isn't migrated to this -- the two
transports aren't unifiable without wrapping the SDK call in something that fakes
an httpx.Response. This helper covers the raw-httpx providers only.
"""

import asyncio
from collections.abc import Awaitable, Callable

import httpx

# Short backoff, matching providers/gemini.py's IMAGE_RETRY_DELAYS_SECONDS.
RETRY_DELAYS_SECONDS = (2, 5, 10)


async def request_with_retry(send: Callable[[], Awaitable[httpx.Response]]) -> httpx.Response:
    """Call `send()`, retrying on a 5xx response or a transport-level error
    (dropped connection, timeout) with short backoff.

    4xx responses are returned immediately, not retried: those are client errors
    (bad prompt, bad API key, quota exceeded) that won't succeed on retry, unlike a
    provider's transient overload.
    """
    for delay in (*RETRY_DELAYS_SECONDS, None):
        try:
            response = await send()
        except httpx.TransportError:
            if delay is None:
                raise
            await asyncio.sleep(delay)
            continue
        if response.status_code < 500 or delay is None:
            return response
        await asyncio.sleep(delay)
    raise AssertionError("unreachable")
