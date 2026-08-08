# Overview

A local web app that uses the Gemini API to generate photorealistic-only images from short text prompts (MVP). The repo is named `generative-app`, not `image-generator`, because generation beyond images (text/video, etc.) may be added later.

See also: [database.md](database.md), [api.md](api.md), [screens/generate.md](screens/generate.md), [screens/history.md](screens/history.md).

## Tech stack

- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS
- Backend: FastAPI, Python, SQLAlchemy, Uvicorn
- Database: SQLite (`history.db`), Alembic for migrations
- File storage: local directory (`backend/static/images/`)
- Image generation providers (switchable per session, see [Providers](#providers)):
  - `gemini` (default): Gemini API (`google-genai` SDK, API key auth) — prompt expansion via `gemini-3.6-flash` (free tier), image generation via `gemini-3-pro-image` (Nano Banana Pro), chosen for 4K output and strong instruction-following
  - `local`: Ollama (prompt expansion, any local text model) + ComfyUI (image synthesis, SDXL-family checkpoint)
  - `openai`: OpenAI (`gpt-image-2` for images; a GPT chat model for prompt expansion)
  - `stability`: Stability AI (Stable Image Core/SD3 for images); prompt expansion delegated to `openai` (no Stability text API)
- Rate limiting: `slowapi`
- Runtime: Docker / docker-compose, local only (no cloud deployment)

Model IDs and parameters change frequently — always confirm against the [official docs](https://ai.google.dev/gemini-api/docs/image-generation) right before implementing.

## Providers

Image generation is provider-pluggable. `backend/providers/{gemini,local,openai,stability}.py` each expose the same three async functions (`expand_prompt`, `generate_preview_batch`, `generate_final_image`); `backend/providers/__init__.py`'s `get_provider(name)` returns the matching module. `backend/providers/prompts.py` holds the shared `SYSTEM_PROMPT` (photorealistic-only rules, all providers) and `NEGATIVE_PROMPT` (used by providers without built-in photorealism bias — local/Stability's SDXL-family models — Gemini and OpenAI's image models are steered via prompt phrasing instead, since neither exposes a dedicated negative-prompt field). `backend/providers/_storage.py` holds the shared `save_image_bytes` helper.

`stability.py::expand_prompt` delegates to another provider's `expand_prompt`, since Stability has no general-purpose text API — which one is configurable via `STABILITY_TEXT_PROVIDER` (`gemini` | `local` | `openai`, default `local`/Ollama, so no extra cloud API key is needed for the text step by default). Implemented as module-level imports (`from providers import gemini as gemini_provider`, etc., not function-level — see the monkeypatch-safety note in `providers/__init__.py`), so using `stability` only additionally requires whichever text provider `STABILITY_TEXT_PROVIDER` points at to be configured (Ollama running, or the relevant API key) — not necessarily `openai`.

`sessions.provider` fixes which provider generated the 4 previews. Finalize is **independently selectable per preview** (`preview_images.final_provider`, defaults to the session's provider when omitted) — deliberately decoupled, since local CPU-only inference can be too slow/unreliable for the finalize step specifically (see below), so a session can preview locally for free and finalize with a cloud provider, or vice versa.

Previews default to **square** for every provider, matching the source images they're meant to look like. Only the 4K finalize step targets **16:9** (`GEMINI_ASPECT_RATIO`, `COMFYUI_FINAL_WIDTH`/`HEIGHT`, `OPENAI_FINAL_SIZE`, `STABILITY_ASPECT_RATIO`) — Gemini and OpenAI regenerate from the reference image rather than resizing, so they can target a different aspect ratio for free. `local`'s finalize literally resizes the selected (square) preview, so the `ImageScale` node in `img2img_upscale.json` uses `crop="center"` to center-crop into 16:9 instead of stretching.

### Provider roadmap

| Provider | Status | Notes |
|---|---|---|
| `gemini` (Google) | Implemented | Default. ~$0.40/full cycle (4 previews + 1 final) — see Cost notes below. |
| `local` (Ollama + ComfyUI) | Implemented | Free, but CPU-only inference (no Docker GPU passthrough on Apple Silicon) is slow and resolution-sensitive — see below. |
| `openai` | Implemented (2026-08-09) | `gpt-image-2`; ~$0.02-0.06/image depending on quality tier. Model IDs (`OPENAI_TEXT_MODEL`/`OPENAI_IMAGE_MODEL`) are the fastest-moving of any provider here — verify before relying on the defaults. |
| `stability` | Implemented (2026-08-09) | Stable Image Core (previews, ~$0.03/image) + SD3 image-to-image (finalize). Prompt expansion delegated via `STABILITY_TEXT_PROVIDER` (default `local`, see above). Finalize's exact request shape is unverified against a live call — Stability's docs page didn't render for automated fetching at implementation time. |
| Adobe Firefly | Rejected | Evaluated 2026-08-08: API access requires a separate Enterprise agreement (~$1,000/month minimum via Adobe Sales) that the consumer Creative Cloud Photography plan does not unlock — not viable for this project's scale. |

**`local` provider** (`backend/providers/local.py`):
- Prompt expansion: `POST {OLLAMA_BASE_URL}/api/generate` (non-streaming), same `SYSTEM_PROMPT` as Gemini.
- Image generation: ComfyUI workflows checked into `backend/comfyui_workflows/` (`txt2img_batch.json` for previews, `img2img_upscale.json` for finalize), queued via `POST /prompt` and polled via `GET /history/{prompt_id}` (fixed 2s interval, bounded by `LOCAL_GENERATION_TIMEOUT_SECONDS`). The 4 previews are 4 **sequential** `batch_size=1` jobs, not one `batch_size=4` job — batching them was found to multiply peak memory enough to get ComfyUI OOM-killed under CPU-only inference. Both `ComfyUIError` (workflow validation) and `httpx.HTTPError` (connection drop mid-request, e.g. from a crash) are caught per-job, preserving Gemini-like per-candidate failure isolation.
- `img2img_upscale.json` does NOT run a separate AI upscale model (`ImageUpscaleWithModel`): applying one at its native factor (e.g. 4x) to a 1024x1024 preview produces a 4096x4096 intermediate image whose forward pass was confirmed in testing to OOM-kill ComfyUI even with 24GB allocated to Docker. Instead an `ImageScale` node resizes the selected (square) preview directly to `COMFYUI_FINAL_WIDTH`/`COMFYUI_FINAL_HEIGHT` (16:9) before `VAEEncode`/`KSampler` refines it via img2img (denoise < 1.0 preserves composition) — `crop="center"` on that node center-crops into 16:9 rather than stretching, since preview and finalize are intentionally different aspect ratios. `VAEEncode`/`VAEDecode` are tiled (`VAEEncodeTiled`/`VAEDecodeTiled`, `COMFYUI_VAE_TILE_SIZE`/`COMFYUI_VAE_TILE_OVERLAP`) — a non-tiled pass OOM'd even at 2048x2048.

### Measured performance (local provider)

Measured 2026-08-08 end-to-end against a live ComfyUI instance. **Test environment**: MacBook Pro (Apple Silicon, CPU-only — Docker Desktop has no GPU passthrough), 32GB physical RAM, 24GB allocated to Docker Desktop (raised from the ~15.6GB default after OOM crashes — see below). Other unrelated Docker containers running concurrently on the same machine measurably slowed generation (CPU/memory contention) — close unrelated projects for best results. Checkpoint: `juggernautXL_ragnarok.safetensors` (a standard, non-distilled SDXL checkpoint — see the sampling-params caveat above).

| Stage | Resolution | Result | Time |
|---|---|---|---|
| Finalize (img2img) | 1024x1024 | Success | ~7 min |
| Finalize (img2img) | 2048x2048 | Success | 1h 14m 38s (KSampler alone: 1h 2m 31s, ~469s/step) |
| Finalize (img2img) | 3840x3840 ("true" 4K) | Not attempted | Extrapolated 7-8+ hours based on the 1024→2048 scaling factor (~9x time for 2x resolution — self-attention cost scales worse than linearly) |

These were measured with square test resolutions, matching `COMFYUI_WIDTH`/`HEIGHT`'s square default. `COMFYUI_FINAL_WIDTH`/`HEIGHT` defaults to 16:9 instead (see above); total pixel count, not exact shape, is what drives time here, so e.g. 1280x720 (16:9) tracks the 1024x1024 row above and 2560x1440 tracks the 2048x2048 row.

**OOM history** (all on the pre-24GB / pre-tiling setup, now fixed): Docker's default memory allocation (~15.6GB) OOM-killed ComfyUI just loading the ~7GB fp32 checkpoint; a non-tiled 4x AI upscale (1024→4096 intermediate) OOM-killed it even at 24GB; a non-tiled `VAEEncode`/`VAEDecode` at 2048x2048 OOM-killed it even at 24GB. Fixed by removing the AI upscale step (direct resize instead) and switching to `VAEEncodeTiled`/`VAEDecodeTiled`.

**Conclusion**: local finalize is verified working and crash-free, but a literal 4K target (3840x2160, 16:9) is impractical on CPU-only inference (hours per image) — this is *why* finalize has independent provider selection (see above), not a workflow bug. The default `COMFYUI_FINAL_WIDTH`/`HEIGHT` is a judgment call between "true 4K" and "finishes in reasonable time"; see [README.md](../../README.md) for current defaults and recommended hardware.

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
│   ├── providers/                 # Pluggable image-generation providers
│   │   ├── __init__.py                # get_provider(name) -> gemini | local module
│   │   ├── gemini.py                  # Gemini API calls, image save logic
│   │   ├── local.py                   # Ollama (text) + ComfyUI (images) calls
│   │   ├── prompts.py                 # Shared SYSTEM_PROMPT / local-only NEGATIVE_PROMPT
│   │   └── _storage.py                # Shared save_image_bytes helper
│   ├── comfyui_workflows/          # ComfyUI workflow JSON (txt2img_batch, img2img_upscale)
│   ├── auth.py                    # Shared-token auth dependency
│   ├── alembic/                   # Migrations
│   ├── static/images/             # Generated images (served via StaticFiles, persisted in a named volume)
│   ├── history.db                 # SQLite file (persisted in a named volume)
│   ├── requirements.txt / requirements-dev.txt
│   └── .env                       # GEMINI_API_KEY, APP_API_TOKEN, RATE_LIMIT_PER_HOUR, provider settings
├── ollama/                      # Ollama container (non-root wrapper around ollama/ollama)
│   └── Dockerfile
├── comfyui/                     # ComfyUI container (built from source, non-root)
│   └── Dockerfile
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
- `ollama/Dockerfile`: wraps the official `ollama/ollama:latest` image (which runs as root) with a non-root `appuser`, since every container in this project must be non-root.
- `comfyui/Dockerfile`: `python:3.12-slim` + `git clone` of ComfyUI, non-root `appuser`. No GPU is baked in — see docker-compose.yml's commented-out NVIDIA passthrough block for Linux; Docker Desktop on Apple Silicon has no GPU passthrough at all, so local image generation falls back to (slow) CPU.
- `docker-compose.yml`: four services (`backend`, `frontend`, `ollama`, `comfyui`). `history.db`, `static/images/`, and the Ollama/ComfyUI model directories live in named volumes so data survives container recreation. Ports bind to `127.0.0.1` only. `.env` files are loaded via `env_file`, never baked into the image.
- ComfyUI's checkpoint (`COMFYUI_CHECKPOINT`) is a multi-GB file not included in the image or repo — it must be manually downloaded into the `comfyui_models` volume post-build (see [README.md](../../README.md)). No separate upscale model is needed; finalize resizes directly instead of running a 4x AI upscale model (see [Providers](#providers)).

## Cost notes

- `gemini-3.6-flash` (prompt expansion) is free tier.
- `gemini-3-pro-image` has no free tier and requires Cloud Billing: ~$0.039/image at 1K, ~$0.24/image at 4K.
- One full Gemini cycle (4 previews + 1 final) costs ~$0.40.
- The `local` provider has no per-request API cost (Ollama + ComfyUI run entirely on local hardware), at the cost of needing GPU hardware for reasonable latency and manual model downloads.
