# generative-app

A local web app that generates photorealistic images from short text prompts using the Gemini API.

## Development Environment Setup

### Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### URLs

| Service                | URL                         | Port |
| ----------------------- | ---------------------------- | ---- |
| Frontend (Next.js)      | http://localhost:3000        | 3000 |
| API (FastAPI)           | http://localhost:8000        | 8000 |
| API Docs (Swagger UI)   | http://localhost:8000/docs   | 8000 |

### Running locally

```bash
docker compose up

# Run in the background
# Logs: docker compose logs -f
docker compose up -d

# First run, or after changing a Dockerfile
docker compose up --build
```

### Gemini API setup

1. Issue an API key at [Google AI Studio](https://aistudio.google.com/apikey).
   - Image generation (`gemini-3-pro-image`) requires Cloud Billing to be enabled on the linked project; the free tier does not cover it.
2. Set `GEMINI_API_KEY` in `backend/.env`.
3. Set a shared secret in `APP_API_TOKEN` (must match between `backend/.env` and `frontend/.env.local`), and adjust `RATE_LIMIT_PER_HOUR` if needed.

Templates: [backend/.env.example](backend/.env.example), [frontend/.env.local.example](frontend/.env.local.example)

- Test command

```bash
curl -s -X POST http://localhost:8000/api/generate/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <APP_API_TOKEN>" \
  -d '{"prompt": "a quiet hot spring inn surrounded by mountains"}'
```

### Database migrations

Schema changes are managed with Alembic. On startup, the backend bootstraps a fresh database or applies any pending migrations automatically.

```bash
# After changing backend/models.py, create a new migration
docker compose exec backend alembic revision -m "describe the change"
```

## Author

[Asami.K](https://asami.tokyo/)

If you find this helpful, consider supporting the work:

[![BuyMeACoffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/asamiile)
