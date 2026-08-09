# API

FastAPI backend. See [backend/main.py](../../backend/main.py) for the source of truth.

All endpoints below except static file serving require `Authorization: Bearer <APP_API_TOKEN>` (see [overview.md](overview.md#security)). The browser never sends this header directly — it calls the frontend's own `/api/*` Route Handlers (BFF), which attach the token and proxy to the backend.

## Providers

Image generation is provider-pluggable: `gemini` (default), `local` (Ollama + ComfyUI), `openai` (GPT Image), or `stability` (Stable Image; prompt expansion delegated to another provider, `STABILITY_TEXT_PROVIDER` — see [overview.md](overview.md#providers)). `backend/providers/get_provider(name)` resolves a provider name to its module (`providers/{gemini,local,openai,stability}.py`), each exposing the same three async functions: `expand_prompt`, `generate_preview_batch`, `generate_final_image`.

`sessions.provider` (set on `/api/generate/preview`) fixes which provider generated the 4 previews. `/api/generate/finalize` accepts its **own** optional `provider` — defaults to the session's provider when omitted, but can be set to a different one per preview. This is deliberate: local CPU-only finalize at high resolution can take hours (see [overview.md](overview.md#providers)), so a session previewed locally for free can still be finalized with a fast/reliable cloud provider.

## `POST /api/generate/preview`

Generates 4 low-resolution preview candidates. Rate-limited (`RATE_LIMIT_PER_HOUR`, default 10/hour, shared by all providers — see [database.md](database.md)).

- Request: `{"prompt": "a quiet hot spring inn surrounded by mountains", "provider": "gemini"}` (prompt 1–200 chars; `provider` **required** — no default, since the frontend always sends an explicit choice and there's no longer a neutral one to fall back to across 4 equally-supported providers)
- Processing:
  1. Resolve the provider (`gemini`, `local`, `openai`, or `stability`) and expand the prompt into an English, photorealistic-only prompt (same system prompt for all — see [overview.md](overview.md)). No provider's `expand_prompt` catches its own errors, so `main.py` wraps this call and turns any exception into `502` (`{"detail": "Failed to expand the prompt via <provider>: <error>"}`) rather than an unhandled 500 — nothing has been persisted yet at this point (no session row, no images attempted), so there's nothing to record as failed.
  2. Create a `sessions` row (with its `provider`) and commit immediately — the write lock must be released before the slow generation call, or a concurrent request fails with `database is locked`.
  3. Generate 4 previews at low resolution:
     - `gemini`: `gemini-3-pro-image` at `image_size="1K"` called **4 separate times in parallel** (`asyncio.gather`) — the image models don't support `candidateCount`, so one request can't return multiple candidates. A single preview's failure doesn't fail the whole batch: each call catches `APIError` and returns `None`, recorded as `status: "failed"` for that candidate only. Transient `503` (high demand) is retried with backoff (`IMAGE_RETRY_DELAYS_SECONDS`, 2/5/10s).
     - `local`: 4 **sequential** `batch_size=1` ComfyUI jobs (see [overview.md](overview.md#providers)) — not one `batch_size=4` job, which was found to multiply peak memory enough to get ComfyUI OOM-killed on CPU-only inference. Each job's failure (validation error, connection drop, timeout) is caught independently and recorded as `status: "failed"` for that candidate only, same isolation as Gemini.
     - `openai`: **one** call to `/v1/images/generations` with `n=4` — the only provider whose API natively batches multiple candidates in a single request. Transient 5xx/dropped-connection is retried with backoff via `providers/_http.py::request_with_retry` (shared with `stability`, same 2/5/10s schedule as Gemini's).
     - `stability`: 4 separate parallel calls to Stable Image Core (`/v2beta/stable-image/generate/core`), same shape as Gemini, same shared retry helper as `openai`.
  4. Persist all 4 results to `preview_images`.
- Response: `{"session_id": 1, "enhanced_prompt": "...", "provider": "gemini", "previews": [{"preview_id": 1, "candidate_index": 0, "image_path": "...", "status": "success", "final_image_path": null, "final_status": null, "final_provider": null, "finalized_at": null}, ...4 total]}`

## `POST /api/generate/finalize`

Finalizes one selected preview into a high-resolution image. Rate-limited the same as preview.

- Request: `{"session_id": 1, "preview_id": 3, "provider": "gemini"}` (`provider` optional, defaults to `sessions.provider` when omitted — may differ from the provider that generated the preview)
- Processing:
  1. Validate that `preview_id` belongs to `session_id` and has a non-null `image_path`.
  2. Resolve the finalize provider (request body, falling back to `sessions.provider`).
  3. Pass the selected preview image as a **reference image**, upscaling while preserving composition:
     - `gemini`: reference image + `enhanced_prompt` to `gemini-3-pro-image` at `image_size="4K"`.
     - `local`: upload the preview to ComfyUI (`/upload/image`), then run an img2img workflow (resize + low-denoise `KSampler` pass, tiled VAE — see [overview.md](overview.md#providers)). Verified working but slow at high resolution: ~7 min at 1024x1024, ~75 min at 2048x2048.
     - `openai`: reference image + `enhanced_prompt` to `/v1/images/edits`.
     - `stability`: reference image + `enhanced_prompt` to the SD3 endpoint in image-to-image mode (`strength=STABILITY_FINAL_STRENGTH`). Output is **square**, not 16:9 like the other three providers — the endpoint rejects an `aspect_ratio` field outright in this mode (verified against a live call, see [overview.md](overview.md#providers)).
  4. Save the result and update `preview_images.final_image_path` / `final_status` / `final_error_message` / `final_provider` / `resolution` / `finalized_at` — **not** any column on `sessions`, since each preview in a session finalizes independently (including, independently, which provider finalized it).
- Response: `{"session_id": 1, "preview_id": 3, "image_path": "...", "status": "success", "created_at": "..."}`
- On failure, the provider function returns `None` and this is recorded as `final_status: "failed"` rather than raising an unhandled 500. `final_provider` is still recorded (the attempted provider) even on failure.

## `GET /api/history`

- Query params: `limit` (default 20), `offset` (default 0), `sort` (`newest` | `oldest`, default `newest`), `q` (optional, substring match against `original_prompt`, case-insensitive via `ilike`).
- Returns sessions (regardless of finalize state) ordered by `created_at`, with `id` as a tiebreaker since SQLite's `CURRENT_TIMESTAMP` only has second precision. Each session includes all 4 of its previews, each with its own `final_*` fields.
- `q` filters server-side before `limit`/`offset` are applied, so a match on an unloaded page is still reachable by paging further in — the History screen's search box used to filter only the already-loaded page client-side (and hid "Load more" while a query was active), which made matches outside the first page unreachable. Fixed 2026-08-09.
- Response: array of `{"session_id", "original_prompt", "enhanced_prompt", "provider", "created_at", "previews": [...]}`.

## Static file serving

`app.mount("/static", StaticFiles(directory="static"), name="static")`. Unauthenticated — protected only by unguessable UUID filenames. The frontend builds absolute URLs by joining `NEXT_PUBLIC_API_URL` with `image_path`.

## Timeouts

Both preview and finalize generation can legitimately take several minutes under Gemini API load, and local CPU-only inference (no GPU passthrough, e.g. Docker Desktop on Apple Silicon) can run even longer. `frontend/src/lib/backendFetch.ts` passes a per-request `undici.Agent` with `headersTimeout`/`bodyTimeout` of 15 minutes to the BFF's `fetch()` calls — Node's default `fetch` (undici) has a 5-minute `headersTimeout` that is too short for this workload. `frontend/next.config.ts` sets `serverExternalPackages: ["undici"]` so this doesn't get bundled by webpack (bundling `undici`'s mock subsystem fails on a `node:console` import it can't resolve). The `local` provider's own poll loop against ComfyUI is separately bounded by `LOCAL_GENERATION_TIMEOUT_SECONDS` (default 900s).
