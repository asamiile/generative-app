# AGENTS.md

Instructions for AI agents working in this repository. See [.agents/docs/overview.md](.agents/docs/overview.md) for the full spec.

## Project overview

A local web app that generates photorealistic-only images from short text prompts. The repo is named `generative-app` (not `image-generator`) because generation beyond images (text/video, etc.) may be added later.

- Backend: `backend/` (FastAPI, Python, SQLAlchemy, SQLite, Alembic)
- Frontend: `frontend/` (Next.js App Router, TypeScript, Tailwind CSS)
- Runtime: Docker / docker-compose (local only, no cloud deployment)
- Image generation providers (pluggable, all four implemented — see [.agents/docs/overview.md](.agents/docs/overview.md#providers)): `gemini` (default, Google), `local` (Ollama + ComfyUI, no API key needed), `openai` (GPT Image), `stability` (Stable Image). `GET /api/providers` reports which are actually usable in the running instance (have a key configured in `backend/.env`, or `local`, which always is).

## Setup and run commands

```bash
# Run locally via docker-compose (backend, frontend, ollama, comfyui)
docker compose up --build

# Debugging a single service only
cd backend && pip install -r requirements.txt && uvicorn main:app --reload
cd frontend && npm install && npm run dev
```

See [README.md](README.md) for the full setup flow (per-provider API keys / local model setup, env files) and development commands.

## Constraints that must never be broken

1. **Every provider module (`backend/providers/{gemini,local,openai,stability}.py`) exposes the same four async functions**: `expand_prompt`, `generate_preview_batch`, `generate_one_preview`, `generate_final_image`. `backend/providers/__init__.py`'s `get_provider(name)` resolves a provider name to its module — always call `provider.fn(...)` off the returned module, never `from providers.gemini import fn` (the latter copies the reference at import time and silently breaks tests that monkeypatch the module attribute).
2. **Model IDs and API parameters change fast — confirm against the latest official docs right before implementing**, for whichever provider you're touching (not just Gemini). See [.agents/docs/overview.md](.agents/docs/overview.md)'s Provider roadmap for what's already been verified against a live call, and when — a caveat there stays valid only until the provider's API changes.
3. **The prompt-expansion system prompt (`backend/providers/prompts.py`'s `SYSTEM_PROMPT`) must always include**: output only an English prompt, photorealistic/live-action mandatory, anime/illustration styles excluded, reinforce the photographic look via lens/depth of field/lighting. Same prompt for all four providers.
4. **Store API keys only in `backend/.env`, never commit them.** Always keep it in `.gitignore`.
5. **Image generation is a two-step flow: 4 previews (low-res) → select → finalize (high-res)**. Never implement a single-shot high-res-only generation. Finalize is **independently selectable per preview**, decoupled from the provider that generated it (`preview_images.final_provider`) — local CPU-only finalize can be impractically slow at high resolution (see [.agents/docs/overview.md](.agents/docs/overview.md#providers)'s measured benchmarks), so a session previewed locally can still be finalized with a cloud provider. Both steps have long latency — `frontend/src/lib/backendFetch.ts` sets an extended fetch timeout for exactly this reason; don't shorten it without checking [.agents/docs/api.md](.agents/docs/api.md#timeouts) first.
6. **A single failed preview can be retried individually** (`POST /api/generate/preview/retry`, `generate_one_preview`) instead of regenerating all 4 — don't reintroduce "regenerate the whole session" as the only recovery path for one bad candidate. Both finalize and retry default to **the specific preview's own current `provider`** (`preview_images.provider`) when their request omits one — never fall back to `sessions.provider`, which goes stale the moment any one preview is retried with a different provider than the session started with (see [.agents/docs/api.md](.agents/docs/api.md#providers)).
7. **Every API endpoint except static file serving requires shared-token auth**: `/api/generate/preview`, `/api/generate/preview/retry`, `/api/generate/finalize`, `/api/history`, `/api/providers`. Always route through `backend/auth.py`'s dependency, which validates `Authorization: Bearer <APP_API_TOKEN>`. The browser never sends this header directly — the frontend's own `/api/*` Route Handlers (BFF) attach it server-side before forwarding to FastAPI.
8. **Rate-limit all three generation endpoints (preview, finalize, retry) with `slowapi`.** Default is 10 requests/hour via `RATE_LIMIT_PER_HOUR`, shared across all providers (including `local`, which has no per-request API cost but still benefits from the same cap against queue pile-up on a single ComfyUI/Ollama instance).
9. **Every container runs as a non-root user, and ports bind only to `127.0.0.1`.** This includes `ollama/Dockerfile` and `comfyui/Dockerfile`, which wrap upstream images that run as root by default — don't drop the non-root wrapper when touching those.
10. **Every DB schema change needs an Alembic migration file.** Never rely on `Base.metadata.create_all()` alone. Foreign keys must specify an `ondelete` policy and `index=True`; `status`-like and `provider`-like columns must be an Enum, not a free-form string (see [.agents/docs/database.md](.agents/docs/database.md)).

## Commit message convention

Releases are automated with [Release Please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`). The version bump is derived from the **Conventional Commits** prefix in each commit message, so always include one.

| prefix | purpose | version bump |
|--------|------|---------------|
| `feat:` | new feature | minor |
| `fix:` | bug fix | patch |
| `feat!:` / `fix!:` | breaking change | major |
| `chore:` / `docs:` / `refactor:` / `test:` | other | none |

- Release PRs merge into `main` (merging elsewhere does not create a tag or GitHub Release).
- Don't cram multiple changes into one commit — split by what a single prefix can describe.

## Code conventions

- **English only, everywhere in this repo** — code comments, docstrings, commit messages, `.env.example` templates, UI copy, `.agents/` docs. The target users are English-speaking, regardless of what language a conversation with an agent happens to be conducted in. Don't leave Japanese (or any other non-English text) in anything that gets committed, even as a byproduct of working in a non-English conversation.
- Comments only to explain "why", kept minimal. Never write comments that explain "what" the code does.
- Don't add abstractions or future-proofing beyond what the task requires (YAGNI).
- Prefer editing existing files; create new files only when necessary.

## Directory structure

Follows the structure in [.agents/docs/overview.md](.agents/docs/overview.md). If it changes, update that doc too. See [.agents/docs/database.md](.agents/docs/database.md) and [.agents/docs/api.md](.agents/docs/api.md) for DB schema and API endpoint design, and [.agents/docs/screens/](.agents/docs/screens/) for the frontend screens.
