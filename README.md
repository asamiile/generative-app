# generative-app

A local web app that generates photorealistic images from short text prompts, with a pluggable choice of image-generation backends (Gemini, OpenAI, Stability AI, or a fully local Ollama + ComfyUI pipeline).

[![Image from Gyazo](https://i.gyazo.com/4da86262aa6b1a39ef6aa1fd5172e2e7.jpg)](https://gyazo.com/4da86262aa6b1a39ef6aa1fd5172e2e7)

[![Image from Gyazo](https://i.gyazo.com/dcebe41ad28bd1e27c20446ff81be784.jpg)](https://gyazo.com/dcebe41ad28bd1e27c20446ff81be784)

[![Image from Gyazo](https://i.gyazo.com/dda2997f417be76c7c772dcec1680de9.jpg)](https://gyazo.com/dda2997f417be76c7c772dcec1680de9)

- Runs entirely locally via Docker / docker-compose — no cloud deployment required
- Two-step generation flow: 4 low-resolution previews → pick one → finish it in high resolution
- Switchable image generation backend, independently selectable for previews and for the finalize (4K) step — see [Available models](#available-models)
- Generated images and history persist across restarts (Docker volumes + SQLite)
- Photorealistic output only, enforced via prompt engineering (no anime/illustration styles)

## Available models

| Provider | Preview generation | Finalize (4K) | Cost | Setup |
|---|---|---|---|---|
| **Local** (Ollama + ComfyUI) | ComfyUI (SDXL checkpoint) | ComfyUI (img2img) | Free, but slow — needs real PC-spec headroom | [Local provider setup](#local-provider-setup-ollama--comfyui-optional) |
| **Gemini** (default) | `gemini-3-pro-image` | `gemini-3-pro-image` | ~$0.40/full cycle (4 previews + 1 final) | [Gemini API setup](#gemini-api-setup) |
| **OpenAI** | `gpt-image-2` | `gpt-image-2` | ~$0.02-0.06/image depending on quality tier | [OpenAI API setup](#openai-api-setup) |
| **Stability AI** | Stable Image Core | Stable Image (SD3, image-to-image) | Core ~$0.03/image, SD3 varies | [Stability AI API setup](#stability-ai-api-setup) |

Preview generation and the finalize (4K) step use **independently selectable** providers per session/preview (a dropdown next to "Generate previews" and another next to "Generate 4K" / "Regenerate") — e.g. preview locally for free, then finalize with an API model when you need real 4K quickly. See [Local provider setup](#local-provider-setup-ollama--comfyui-optional) for why this matters.

Only Gemini is required to run the app at all; the other three are optional, each needing its own API key setup below.

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
   - Image generation (`gemini-3-pro-image`) requires Cloud Billing; the free tier doesn't cover it.
2. In AI Studio's **Spend** tab, set a monthly dollar cap for the project — `/api/generate/preview` and `/api/generate/finalize` call paid models, so this is strongly recommended.
   - Enforcement has a ~10 minute delay, so a request burst right at the cap may still incur a small extra charge. A [Cloud Billing budget alert](https://cloud.google.com/billing/docs/how-to/budgets) is a useful addition (email only, doesn't block requests) but not a substitute.
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

### Local provider setup (Ollama + ComfyUI, optional)

The Gemini provider works out of the box. The `local` provider (offline, no per-request cost) needs one-time setup after `docker compose up --build`:

> **Recommended usage**: use **Local** for previews and iterating on prompts freely, including regenerating a failed preview. Treat **Generate 4K as an API-model (Gemini, or another cloud provider) operation** — local 4K needs real PC-spec headroom (see the table below) and, even then, is slow. If local 4K fails or is taking too long, switch the provider dropdown next to "Generate 4K" to an API model instead of waiting it out.

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

No separate upscale model download is needed — finalize resizes the selected preview directly (`COMFYUI_FINAL_WIDTH`/`HEIGHT`, default 1280x720, 16:9) and refines it via img2img, rather than running a 4x AI upscale model (that reliably OOM-kills ComfyUI on CPU-only inference — see below). Preview (`COMFYUI_WIDTH`/`HEIGHT`) defaults to square, matching the source images previews are meant to look like; finalize intentionally targets 16:9 instead, center-cropping the square preview rather than stretching it.

**GPU**: `comfyui/Dockerfile` defaults to `--cpu` (works everywhere, but slow for SDXL). On Linux with an NVIDIA GPU and `nvidia-container-toolkit`, uncomment the GPU passthrough block and the `command:` override in `docker-compose.yml`.

**Recommended environment**: Apple Silicon Mac, 32GB physical RAM, with at least ~20GB allocated to Docker Desktop (Settings → Resources → Memory) — Docker's default allocation (~15.6GB) isn't enough; ComfyUI gets OOM-killed just loading the checkpoint. Also close other unrelated Docker projects while generating (`docker stats` to check) — they compete for the same CPU/memory budget and measurably slow things down.

**PC spec guideline for local Generate 4K** (CPU-only, no GPU passthrough — a rough guideline, not a guarantee, since actual results depend on your exact CPU and what else is running):

| `COMFYUI_FINAL_WIDTH`/`HEIGHT` | Docker memory | Result | Time |
|---|---|---|---|
| 1280x720 (default, 16:9) | ~16GB (Docker default) | OOM-killed | — |
| 1280x720 (default, 16:9) | 24GB+ | Works | ~7 min (same pixel count as the old 1024x1024 default) |
| 2560x1440 (16:9) | 24GB+ | Works | ~1h 15min (same pixel count as 2048x2048) |
| 3840x2160 ("true" 4K, 16:9) | 24GB+ | Not attempted | Extrapolated 7-8+ hours — impractical |

Bottom line: local 4K needs **24GB+ Docker memory** just to run reliably, and even then is not fast — this is a CPU-inference ceiling, not a bug. If you don't have that headroom, or don't want to wait, use an API model for Generate 4K instead. This is exactly why finalize has its own provider selector, independent of what generated the previews — preview locally for free, then finalize with Gemini (or another cloud provider) when you actually need high resolution quickly.

The default sampling params (`COMFYUI_STEPS=8`, `COMFYUI_CFG=1.5`, etc.) assume a turbo/lightning-distilled SDXL checkpoint; using a standard (non-distilled) checkpoint like Juggernaut XL at these settings finishes faster but produces visibly noisy, undertrained-looking output — for that checkpoint, raise `COMFYUI_STEPS` to ~25-30 and `COMFYUI_CFG` to ~5-7 (slower still) or switch to an actual turbo/lightning checkpoint (keeps these fast defaults, better quality).

**Known limitation**: the ComfyUI workflows in `backend/comfyui_workflows/` may need further tuning (sampler, quality) as you try different checkpoints.

### OpenAI API setup

1. Issue an API key at the [OpenAI platform](https://platform.openai.com/api-keys) and set a [usage limit](https://platform.openai.com/settings/organization/limits) — the image endpoints are paid, no free tier.
2. Set `OPENAI_API_KEY` in `backend/.env`.
3. Model names change fast — verify `OPENAI_TEXT_MODEL` against [platform.openai.com/docs/models](https://platform.openai.com/docs/models) and `OPENAI_IMAGE_MODEL` against [the image generation guide](https://platform.openai.com/docs/guides/image-generation) before relying on the defaults in `backend/.env.example`.
4. Restart the backend so it picks up the key: `docker compose up -d backend` (`restart` alone does **not** reload `.env`).

Unlike Gemini/Local (4 separate calls), the Images API's `n` parameter generates all 4 previews in a single request. Finalize uses the edits endpoint (`/v1/images/edits`) with the selected preview as a reference image.

### Stability AI API setup

1. Issue an API key at [platform.stability.ai/account/keys](https://platform.stability.ai/account/keys).
2. Set `STABILITY_API_KEY` in `backend/.env`.
3. Stability has no general-purpose text/chat API, so prompt expansion is delegated to another provider — set via `STABILITY_TEXT_PROVIDER` (`gemini` | `local` | `openai`, default `local`/Ollama, so no extra cloud API key is needed by default — this does mean the [Local provider setup](#local-provider-setup-ollama--comfyui-optional) must be done first). Change it to `gemini` or `openai` if you'd rather use one of those for the expansion step instead.
4. Restart the backend: `docker compose up -d backend`.

Previews use Stable Image Core (cheap, ~$0.03/image); finalize uses the SD3 endpoint's image-to-image mode (`STABILITY_FINAL_STRENGTH`, default 0.35, controls how much the reference composition is preserved). **Known limitation**: Stability's exact parameter names for this endpoint weren't confirmable against their docs at the time this was written — if finalize fails, check `backend/providers/stability.py`'s module docstring and [platform.stability.ai/docs/api-reference](https://platform.stability.ai/docs/api-reference) directly.

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
