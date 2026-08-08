# generative-app

A local web app that generates photorealistic images from short text prompts, with a pluggable choice of image-generation backends (Gemini, OpenAI, Stability AI, or a fully local Ollama + ComfyUI pipeline).

[![Image from Gyazo](https://i.gyazo.com/4da86262aa6b1a39ef6aa1fd5172e2e7.jpg)](https://gyazo.com/4da86262aa6b1a39ef6aa1fd5172e2e7)

[![Image from Gyazo](https://i.gyazo.com/25d5535acfbc109245f1a9165bb43d24.jpg)](https://gyazo.com/25d5535acfbc109245f1a9165bb43d24)

[![Image from Gyazo](https://i.gyazo.com/2501efdbb7f810062d7d5c26335d2c5b.jpg)](https://gyazo.com/2501efdbb7f810062d7d5c26335d2c5b)

- Runs entirely locally via Docker / docker-compose — no cloud deployment required
- Two-step generation flow: 4 low-resolution previews → pick one → finish it in high resolution
- Switchable image generation backend, independently selectable for previews and for the finalize (4K) step — see [Available models](#available-models)
- Generated images and history persist across restarts (Docker volumes + SQLite)
- Photorealistic output only, enforced via prompt engineering (no anime/illustration styles)

## Available models

| Provider | Preview generation | Finalize (4K) | Cost |
|---|---|---|---|
| **Local** (Ollama + ComfyUI) | ComfyUI (SDXL checkpoint) | ComfyUI (img2img) | Free, but slow — needs real PC-spec headroom |
| **Gemini** (default) | `gemini-3-pro-image` | `gemini-3-pro-image` | ~$0.40/full cycle (4 previews + 1 final) |
| **OpenAI** | `gpt-image-2` | `gpt-image-2` | ~$0.02-0.06/image depending on quality tier |
| **Stability AI** | Stable Image Core | Stable Image (SD3, image-to-image) | Core ~$0.03/image, SD3 varies |

Preview generation and the finalize (4K) step use **independently selectable** providers, so you don't have to pick one for everything:
- Speed matters most → an API provider (Gemini/OpenAI/Stability AI)
- Want to keep API usage down → Local
- Local 4K fails or is too slow → switch just that step to an API provider (see [Local provider setup](#local-provider-setup-ollama--comfyui-optional) for why)

At least one provider needs to be configured — pick one from the table above and follow its setup section below. **Local** needs no API key (just Ollama + ComfyUI); the others each need one.

## Setup

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Clone this repository.
3. Pick a model from [Available models](#available-models) and follow its setup section below (issue an API key, or — for **Local** — see [Local provider setup](#local-provider-setup-ollama--comfyui-optional)).
4. Copy the env file templates and configure the shared settings:
   - `backend/.env.example` → `backend/.env`: set `APP_API_TOKEN` (a long random string), plus whichever provider's API key from step 3.
   - `frontend/.env.local.example` → `frontend/.env.local`: set `APP_API_TOKEN` to the same value as `backend/.env`.
   - Set a value for `RATE_LIMIT_PER_HOUR` (default 10) — the requests/hour cap on `/api/generate/preview` and `/api/generate/finalize`, **each independently**. Testing/iterating on prompts can burn through 10/hour quickly (surfaces as `429 Rate limit exceeded`), so consider raising it.

   Templates: [backend/.env.example](backend/.env.example), [frontend/.env.local.example](frontend/.env.local.example)
5. Run it locally:
   ```bash
   docker compose up --build
   ```
6. Open [http://localhost:3000](http://localhost:3000), pick your model in the app, and generate an image.

### Gemini API setup

1. Issue an API key at [Google AI Studio](https://aistudio.google.com/apikey).
   - Image generation (`gemini-3-pro-image`) requires Cloud Billing; the free tier doesn't cover it.
2. In AI Studio's **Spend** tab, set a monthly dollar cap — `/api/generate/preview` and `/api/generate/finalize` call paid models. Enforcement lags ~10 minutes, so also consider a [Cloud Billing budget alert](https://cloud.google.com/billing/docs/how-to/budgets) as backup.
3. Set `GEMINI_API_KEY` in `backend/.env`.

### OpenAI API setup

1. Issue an API key at the [OpenAI platform](https://platform.openai.com/api-keys) and set a [usage limit](https://platform.openai.com/settings/organization/limits) — the image endpoints are paid, no free tier.
2. Set `OPENAI_API_KEY` in `backend/.env`.
3. Model names change fast — verify `OPENAI_TEXT_MODEL` against [platform.openai.com/docs/models](https://platform.openai.com/docs/models) and `OPENAI_IMAGE_MODEL` against [the image generation guide](https://platform.openai.com/docs/guides/image-generation) before relying on the defaults in `backend/.env.example`.
4. Restart the backend so it picks up the key: `docker compose up -d backend` (`restart` alone does **not** reload `.env`).

### Stability AI API setup

1. Issue an API key at [platform.stability.ai/account/keys](https://platform.stability.ai/account/keys).
2. Set `STABILITY_API_KEY` in `backend/.env`.
3. Stability has no general-purpose text/chat API, so prompt expansion is delegated to another provider — set via `STABILITY_TEXT_PROVIDER` (`gemini` | `local` | `openai`, default `local`/Ollama, so no extra cloud API key is needed by default). **The default requires [Local provider setup](#local-provider-setup-ollama--comfyui-optional) (Ollama) to be done first — without it, prompt expansion fails before an image is ever generated.** Set it to `gemini` or `openai` instead if you'd rather skip the Local setup and delegate expansion to one of those.
4. Restart the backend: `docker compose up -d backend`.

**Known limitation**: finalize's exact request shape wasn't confirmable against Stability's docs at write time — if it fails, check `backend/providers/stability.py`'s module docstring.

### Local provider setup (Ollama + ComfyUI, optional)

The Gemini provider works out of the box. The `local` provider (offline, no per-request cost) needs one-time setup after `docker compose up --build`:

> **Recommended usage**: use **Local** for previews and iterating on prompts freely, including regenerating a failed preview. Treat **Generate 4K as an API-model (Gemini, or another cloud provider) operation** — local 4K needs real PC-spec headroom (see below) and, even then, is slow. If local 4K fails or is taking too long, switch the provider dropdown next to "Generate 4K" to an API model instead of waiting it out.

1. Pull an Ollama model (used for prompt expansion):
   ```bash
   docker compose exec ollama ollama pull llama3.1:8b
   ```
   Check [ollama.com/library](https://ollama.com/library) for current model tags — update `OLLAMA_TEXT_MODEL` in `backend/.env` if you pick a different one.
2. Download a photorealistic SDXL checkpoint in your browser, e.g. [Juggernaut XL](https://civitai.com/models/133005/juggernaut-xl) (~6-7GB, [Civitai](https://civitai.com/) account required for many models).
3. Copy the downloaded file into the `comfyui_models` volume, matching `COMFYUI_CHECKPOINT` in `backend/.env` (rename the file or update the env var if the downloaded filename differs):
   ```bash
   docker compose cp ~/Downloads/juggernautXL_v10.safetensors comfyui:/app/models/checkpoints/
   ```
4. Restart the backend so it picks up the new checkpoint filename if you changed `COMFYUI_CHECKPOINT`: `docker compose up -d backend` (`restart` alone does **not** reload `.env`).
5. In the app, switch the Gemini/Local toggle to **Local** before generating.

No separate upscale model download is needed — finalize resizes and refines the selected preview via img2img instead.

**GPU**: `comfyui/Dockerfile` defaults to `--cpu` (works everywhere, but slow for SDXL). On Linux with an NVIDIA GPU and `nvidia-container-toolkit`, uncomment the GPU passthrough block and the `command:` override in `docker-compose.yml`.

**Recommended environment**: allocate at least ~20GB to Docker Desktop (Settings → Resources → Memory) — the ~15.6GB default isn't enough and ComfyUI gets OOM-killed loading the checkpoint.

Local 4K needs **24GB+ Docker memory** to run reliably, and even then is slow (a CPU-inference ceiling, not a bug) — see [.agents/docs/overview.md](.agents/docs/overview.md) for measured benchmarks. If you don't have that headroom, use an API model for Generate 4K instead.

The default sampling params (`COMFYUI_STEPS=8`, `COMFYUI_CFG=1.5`) assume a turbo/lightning-distilled checkpoint; Juggernaut XL (recommended above) is a standard checkpoint, so raise `COMFYUI_STEPS` to ~25-30 and `COMFYUI_CFG` to ~5-7 for it (slower, but avoids noisy/undertrained-looking output) — or swap in an actual turbo/lightning checkpoint to keep the fast defaults.

**Known limitation**: the ComfyUI workflows in `backend/comfyui_workflows/` may need further tuning (sampler, quality) as you try different checkpoints.

**Troubleshooting — permission errors on `ollama_models`/`comfyui_models`**:
```bash
docker compose exec --user root ollama chown -R appuser:appuser /home/appuser/.ollama
docker compose exec --user root comfyui chown -R appuser:appuser /app/models /app/output
```

## Development

### URLs

| Service                  | URL                         | Port  |
| ------------------------ | ---------------------------- | ----- |
| Frontend (Next.js)       | http://localhost:3000        | 3000  |
| API (FastAPI)            | http://localhost:8000        | 8000  |
| API Docs (Swagger UI)    | http://localhost:8000/docs   | 8000  |
| Ollama (local provider)  | http://localhost:11435       | 11435 |
| ComfyUI (local provider) | http://localhost:8188        | 8188  |

Ollama's host port is shifted to 11435 to avoid clashing with a native Ollama install (default 11434); the backend still reaches the container internally at `ollama:11434`.

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

Tests cover auth and the `/api/generate/*` and `/api/history` endpoints, with all providers' API calls mocked (no real API key or cost involved). Each test runs against an isolated temporary SQLite database.

```bash
docker compose exec backend pip install -r requirements-dev.txt
docker compose exec backend pytest
```

### Calling the API directly

Useful for confirming `APP_API_TOKEN` and a provider's API key are wired up correctly without going through the frontend:

```bash
curl -s -X POST http://localhost:8000/api/generate/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <APP_API_TOKEN>" \
  -d '{"prompt": "a quiet hot spring inn surrounded by mountains", "provider": "gemini"}'
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
