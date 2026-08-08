from __future__ import annotations

from types import ModuleType
from typing import Literal

from providers import gemini, local, openai, stability

ProviderName = Literal["gemini", "local", "openai", "stability"]

_PROVIDERS: dict[str, ModuleType] = {
    "gemini": gemini,
    "local": local,
    "openai": openai,
    "stability": stability,
}


def get_provider(name: str) -> ModuleType:
    """Return the provider module for `name` (its expand_prompt/generate_preview_batch/
    generate_final_image functions are called directly off the returned module).

    Always call functions as `provider.fn(...)` off the object this returns, never
    via `from providers.gemini import fn` -- the latter copies the reference at
    import time and silently breaks tests that monkeypatch the module attribute
    (see backend/tests/conftest.py).
    """
    try:
        return _PROVIDERS[name]
    except KeyError:
        raise ValueError(f"unknown provider: {name!r}") from None
