# generative-app

A local web app that generates photorealistic images from short text prompts using the Gemini API.

- Runs entirely locally via Docker / docker-compose — no cloud deployment required
- Two-step generation flow: 4 low-resolution previews → pick one → finish it in 4K
- Generated images and history persist across restarts (Docker volumes + SQLite)
- Photorealistic output only, enforced via prompt engineering (no anime/illustration styles)

## Setup

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Clone this repository.
3. [Set up the Gemini API](#gemini-api-setup) (issue a key, set a spend cap, configure the env files).
4. Run it locally:
   ```bash
   docker compose up --build
   ```
5. Open [http://localhost:3000](http://localhost:3000) and generate an image.

### Gemini API setup

1. Issue an API key at [Google AI Studio](https://aistudio.google.com/apikey).
   - Image generation (`gemini-3-pro-image`) requires Cloud Billing to be enabled on the linked project; the free tier does not cover it.
2. **Set a monthly spend cap for the project.** In AI Studio, open the **Spend** tab for your project and set a dollar limit — this blocks further API requests once the cap is reached (note: enforcement has a ~10 minute delay, so a burst of requests right at the cap may still incur a small amount of extra charge). This is strongly recommended before running this app with a real key, since `/api/generate/preview` and `/api/generate/finalize` call paid, per-request billed models. A [Cloud Billing budget alert](https://cloud.google.com/billing/docs/how-to/budgets) (email notification only, does not block requests) is a good addition but not a substitute for the spend cap.
3. Set `GEMINI_API_KEY` in `backend/.env`.
4. Set a shared secret in `APP_API_TOKEN` (must match between `backend/.env` and `frontend/.env.local`), and adjust `RATE_LIMIT_PER_HOUR` if needed.

Templates: [backend/.env.example](backend/.env.example), [frontend/.env.local.example](frontend/.env.local.example)

- Test command

```bash
curl -s -X POST http://localhost:8000/api/generate/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <APP_API_TOKEN>" \
  -d '{"prompt": "a quiet hot spring inn surrounded by mountains"}'
```

## Development

### URLs

| Service                | URL                         | Port |
| ----------------------- | ---------------------------- | ---- |
| Frontend (Next.js)      | http://localhost:3000        | 3000 |
| API (FastAPI)           | http://localhost:8000        | 8000 |
| API Docs (Swagger UI)   | http://localhost:8000/docs   | 8000 |

### Development commands

```bash
# Run in the foreground (see startup logs directly)
docker compose up

# Run in the background
docker compose up -d

# Rebuild after changing a Dockerfile or dependencies
docker compose up -d --build

# Rebuild a single service only
docker compose up -d --build backend
docker compose up -d --build frontend

# Follow logs
docker compose logs -f

# Stop
docker compose down
```

### Database migrations

Schema changes are managed with Alembic. On startup, the backend bootstraps a fresh database or applies any pending migrations automatically.

```bash
# After changing backend/models.py, create a new migration
docker compose exec backend alembic revision -m "describe the change"
```

### Running backend tests

Tests cover auth and the `/api/generate/*` and `/api/history` endpoints, with Gemini API calls mocked (no real API key or cost involved). Each test runs against an isolated temporary SQLite database.

```bash
docker compose exec backend pip install -r requirements-dev.txt
docker compose exec backend pytest
```

## Release

Releases are automated with [Release Please](https://github.com/googleapis/release-please). The version bump is determined by the Conventional Commits prefix in each commit message.

| prefix | example | version change |
| ------ | ------- | --------------- |
| `fix:` | `fix: correct rate limit header` | v0.1.0 → v0.1.1 |
| `feat:` | `feat: add preview selection UI` | v0.1.0 → v0.2.0 |
| `feat!:` | `feat!: change API response shape` | v0.1.0 → v1.0.0 |

### Release flow

1. When commits land on `main`, GitHub Actions opens/updates a **Release PR** automatically.
2. The Release PR includes the CHANGELOG and version bump.
3. Merging the Release PR (into `main` only) automatically creates a **tag (e.g. v0.2.0) and a GitHub Release**.

## Author

[Asami.K](https://asami.tokyo/)

If you find this helpful, consider supporting the work:

[![BuyMeACoffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/asamiile)
