# AGENTS.md

Instructions for AI agents working in this repository. See [.agents/docs/overview.md](.agents/docs/overview.md) for the full spec.

## Project overview

A local web app that uses the Gemini API to generate photorealistic-only images from short text prompts (MVP). The repo is named `generative-app` because it may expand beyond images (text/video, etc.) later.

- Backend: `backend/` (FastAPI, Python, SQLAlchemy, SQLite, Alembic)
- Frontend: `frontend/` (Next.js App Router, TypeScript, Tailwind CSS)
- Runtime: Docker / docker-compose (local only for now, no cloud deployment)

## Setup and run commands

```bash
# Run locally via docker-compose
docker compose up --build

# Debugging a single service only
cd backend && pip install -r requirements.txt && uvicorn main:app --reload
cd frontend && npm install && npm run dev
```

See [README.md](README.md) for the full setup flow (Gemini API key, spend cap, env files) and development commands.

## Constraints that must never be broken

1. **Only use Nano Banana-family image models. Imagen models (`imagen-3`, `imagen-4`, etc.) are forbidden.**
   Imagen was shut down on 2026-08-17. Use `gemini-3-pro-image` (Nano Banana Pro).
2. **Always confirm the model ID and API parameters against the latest official docs right before implementing.**
   References: https://ai.google.dev/gemini-api/docs/models , https://ai.google.dev/gemini-api/docs/image-generation
   Google's image generation models are renamed/deprecated on a timescale of months — never trust a model name already in the code.
3. **The prompt-expansion system prompt must always include** (see [.agents/docs/api.md](.agents/docs/api.md)):
   - Output only an English prompt for the image generation model
   - Photorealistic / live-action style is mandatory
   - Anime/illustration styles are excluded
   - Reinforce the photographic look via lens, depth of field, lighting, etc.
4. **Store the API key only in `.env` (`backend/.env`), never commit it.** Always keep it in `.gitignore`.
5. **Image generation is a two-step flow: 4 previews (1K) → select → final (4K).** Never implement a single-shot 4K-only generation. The 4 previews require 4 separate calls since `candidateCount` isn't supported for image models. The final generation passes the selected preview as a reference image to keep the composition while upscaling to 4K. Both steps have long latency, so set generous timeouts on both backend and frontend.
6. **Every API endpoint (`/api/generate/preview`, `/api/generate/finalize`, `/api/history`) requires shared-token auth.** Always route through `backend/auth.py`'s dependency, which validates `Authorization: Bearer <APP_API_TOKEN>`. Never implement or deploy an endpoint without it (this app calls paid APIs, so an unauthenticated endpoint is callable by anyone).
7. **Rate-limit the image generation endpoints with `slowapi`.** Default is 10 requests/hour, tunable via `RATE_LIMIT_PER_HOUR`.
8. **Every container runs as a non-root user, and ports bind only to `127.0.0.1`.** Don't expose anything externally by accident during local runs.
9. **Every DB schema change needs an Alembic migration file.** Never rely on `Base.metadata.create_all()` alone. Foreign keys must specify an `ondelete` policy and `index=True`; `status`-like columns must be an Enum, not a free-form string (see [.agents/docs/database.md](.agents/docs/database.md)).

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

- Comments only to explain "why", kept minimal. Never write comments that explain "what" the code does.
- Don't add abstractions or future-proofing beyond what the task requires (YAGNI).
- Prefer editing existing files; create new files only when necessary.

## Directory structure

Follows the structure in [.agents/docs/overview.md](.agents/docs/overview.md). If it changes, update that doc too. See [.agents/docs/database.md](.agents/docs/database.md) and [.agents/docs/api.md](.agents/docs/api.md) for DB schema and API endpoint design.
