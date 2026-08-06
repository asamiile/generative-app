# Overview

A local web app that uses the Gemini API to generate photorealistic-only images from short text prompts (MVP). The repo is named `generative-app`, not `image-generator`, because generation beyond images (text/video, etc.) may be added later.

See also: [database.md](database.md), [api.md](api.md), [screens/generate.md](screens/generate.md), [screens/history.md](screens/history.md).

## Tech stack

- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS
- Backend: FastAPI, Python, SQLAlchemy, Uvicorn
- Database: SQLite (`history.db`), Alembic for migrations
- File storage: local directory (`backend/static/images/`)
- External API: Gemini API (`google-genai` SDK, API key auth)
  - Prompt expansion: `gemini-3.6-flash` (free tier)
  - Image generation: `gemini-3-pro-image` (Nano Banana Pro) — chosen for 4K output and strong instruction-following
- Rate limiting: `slowapi`
- Runtime: Docker / docker-compose, local only (no cloud deployment)

Model IDs and parameters change frequently — always confirm against the [official docs](https://ai.google.dev/gemini-api/docs/image-generation) right before implementing.

## Directory structure

```
generative-app/
├── docker-compose.yml
├── backend/                    # FastAPI backend
│   ├── Dockerfile
│   ├── main.py                 # FastAPI entrypoint, route handlers
│   ├── database.py             # SQLite connection, session management, migration bootstrap
│   ├── models.py                # SQLAlchemy schema
│   ├── schemas.py                # Pydantic request/response models
│   ├── services.py                # Gemini API calls, image save logic
│   ├── auth.py                    # Shared-token auth dependency
│   ├── alembic/                   # Migrations
│   ├── static/images/             # Generated images (served via StaticFiles, persisted in a named volume)
│   ├── history.db                 # SQLite file (persisted in a named volume)
│   ├── requirements.txt / requirements-dev.txt
│   └── .env                       # GEMINI_API_KEY, APP_API_TOKEN, RATE_LIMIT_PER_HOUR
└── frontend/                   # Next.js frontend
    ├── Dockerfile
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx            # "/" Generate screen
    │   │   ├── history/page.tsx    # "/history" History screen
    │   │   ├── layout.tsx
    │   │   └── api/                 # BFF route handlers (proxy to the backend, attach APP_API_TOKEN)
    │   ├── components/               # UI components
    │   └── lib/                        # api.ts (backend client), backendFetch.ts (extended-timeout fetch)
    ├── package.json
    └── .env.local                       # NEXT_PUBLIC_API_URL, BACKEND_API_URL, APP_API_TOKEN
```

## Security

- **Auth**: a single shared bearer token (`APP_API_TOKEN`). All requests to `/api/generate/preview`, `/api/generate/finalize`, `/api/history` require `Authorization: Bearer <token>`, verified by `backend/auth.py`. The token is never exposed to the browser — the frontend calls its own same-origin `/api/*` Route Handlers (BFF), which attach the token server-side before forwarding to FastAPI. Only `/static/images/*` (unauthenticated, UUID filenames) is fetched directly by the browser.
- **Rate limiting**: `slowapi`, default 10 requests/hour per endpoint (`RATE_LIMIT_PER_HOUR`), applied to the two generation endpoints. Each full cycle (4 previews + 1 final) costs about $0.40, so this caps runaway spend.
- **Input validation**: `prompt` is required, 1–200 chars (Pydantic). User input is templated as data, not instructions, when passed to the prompt-expansion model (prompt injection defense).
- **Multi-user**: not supported. There is no `users` table and no per-user scoping anywhere — `APP_API_TOKEN` is a single shared secret for the whole app, and `/api/history` returns every session regardless of caller. Adding multi-user support would require a `users` table, a `user_id` FK (with an `ondelete` policy and `index=True`) on `sessions`, per-user auth (e.g. JWT/session cookies) in place of the shared token, and scoping `/api/history` and rate limiting by user.

## Containers

- `backend/Dockerfile`: `python:3.12-slim`, runs `uvicorn` as a non-root user.
- `frontend/Dockerfile`: multi-stage build; dev target used by `docker-compose.yml` runs `next dev` with source bind-mounted for hot reload.
- `docker-compose.yml`: two services (`backend`, `frontend`). `history.db` and `static/images/` live in named volumes so data survives container recreation. Ports bind to `127.0.0.1` only. `.env` files are loaded via `env_file`, never baked into the image.

## Cost notes

- `gemini-3.6-flash` (prompt expansion) is free tier.
- `gemini-3-pro-image` has no free tier and requires Cloud Billing: ~$0.039/image at 1K, ~$0.24/image at 4K.
- One full cycle (4 previews + 1 final) costs ~$0.40.
