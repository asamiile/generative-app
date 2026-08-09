# API

FastAPI backend. See [backend/main.py](../../backend/main.py) for the source of truth.

All endpoints below except static file serving require `Authorization: Bearer <APP_API_TOKEN>` (see [overview.md](overview.md#security)). The browser never sends this header directly — it calls the frontend's own `/api/*` Route Handlers (BFF), which attach the token and proxy to the backend.

## Providers

Image generation is provider-pluggable: `gemini` (default), `local` (Ollama + ComfyUI), `openai` (GPT Image), or `stability` (Stable Image; prompt expansion delegated to another provider, `STABILITY_TEXT_PROVIDER` — see [overview.md](overview.md#providers)). `backend/providers/get_provider(name)` resolves a provider name to its module (`providers/{gemini,local,openai,stability}.py`), each exposing the same four async functions: `expand_prompt`, `generate_preview_batch`, `generate_one_preview`, `generate_final_image`. `generate_one_preview` (added 2026-08-09) regenerates a single candidate — it's what `POST /api/generate/preview/retry` calls, reusing the same per-candidate logic `generate_preview_batch` already uses internally rather than generating (and discarding) 3 unwanted images to retry 1.

`sessions.provider` (set on `/api/generate/preview`) records which provider generated the *initial* 4 previews, but is otherwise not read anywhere — both `/api/generate/finalize` and `/api/generate/preview/retry` default to **the specific preview's own current `provider`** (`preview_images.provider`) when their request omits one, not the session's. This matters once a preview has been individually retried with a different provider than the session started with: the session's provider would then be stale for that preview specifically. (Before `preview_images.provider` existed, finalize *did* fall back to `sessions.provider` — fine when every preview shared one provider, wrong the moment retry could diverge them; fixed 2026-08-09.)

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
- Response: `{"session_id": 1, "enhanced_prompt": "...", "provider": "gemini", "previews": [{"preview_id": 1, "candidate_index": 0, "image_path": "...", "status": "success", "provider": "gemini", "final_image_path": null, "final_status": null, "final_provider": null, "finalized_at": null}, ...4 total]}` — each preview's own `provider` starts equal to the session's, then can diverge via `/api/generate/preview/retry` (see Providers above).

## `POST /api/generate/finalize`

Finalizes one selected preview into a high-resolution image. Rate-limited the same as preview.

- Request: `{"session_id": 1, "preview_id": 3, "provider": "gemini"}` (`provider` optional, defaults to that preview's own current provider when omitted — may differ from `sessions.provider` after a retry, see Providers above)
- Processing:
  1. Validate that `preview_id` belongs to `session_id` and has a non-null `image_path`.
  2. Resolve the finalize provider (request body, falling back to `preview_images.provider`).
  3. Pass the selected preview image as a **reference image**, upscaling while preserving composition:
     - `gemini`: reference image + `enhanced_prompt` to `gemini-3-pro-image` at `image_size="4K"`.
     - `local`: upload the preview to ComfyUI (`/upload/image`), then run an img2img workflow (resize + low-denoise `KSampler` pass, tiled VAE — see [overview.md](overview.md#providers)). Verified working but slow at high resolution: ~7 min at 1024x1024, ~75 min at 2048x2048.
     - `openai`: reference image + `enhanced_prompt` to `/v1/images/edits`.
     - `stability`: reference image + `enhanced_prompt` to the SD3 endpoint in image-to-image mode (`strength=STABILITY_FINAL_STRENGTH`). Output is **square**, not 16:9 like the other three providers — the endpoint rejects an `aspect_ratio` field outright in this mode (verified against a live call, see [overview.md](overview.md#providers)).
  4. Save the result and update `preview_images.final_image_path` / `final_status` / `final_error_message` / `final_provider` / `resolution` / `finalized_at` — **not** any column on `sessions`, since each preview in a session finalizes independently (including, independently, which provider finalized it).
- Response: `{"session_id": 1, "preview_id": 3, "image_path": "...", "status": "success", "created_at": "..."}`
- On failure, the provider function returns `None` and this is recorded as `final_status: "failed"` rather than raising an unhandled 500. `final_provider` is still recorded (the attempted provider) even on failure.

## `POST /api/generate/preview/retry`

Regenerates a single preview candidate in place — the individual-retry counterpart to `/api/generate/preview`'s all-4 batch. Rate-limited the same as preview/finalize (it's still a real generation call).

- Request: `{"session_id": 1, "preview_id": 3, "provider": "local"}` (`provider` optional, defaults to this preview's own current provider when omitted — i.e. a plain "try again")
- Processing:
  1. Validate that `preview_id` belongs to `session_id` (unlike finalize, a non-null `image_path` is NOT required — retrying an already-failed preview, the common case, has `image_path: null`).
  2. Resolve the provider (request body, falling back to `preview_images.provider`) and call `generate_one_preview(enhanced_prompt)`.
  3. Overwrite this `preview_images` row's `image_path` / `status` / `error_message` / `provider` in place — there's no value in keeping a failed (or unwanted) attempt around once retried, and the UI should just reflect the latest attempt for this `candidate_index`. Does **not** touch the other 3 previews or `sessions.provider`.
  4. If this preview already had a finalize result, it's **cleared** (`final_image_path`/`final_status`/`final_error_message`/`final_provider`/`resolution`/`finalized_at` all set to `NULL`): that result was made *from* the pre-retry image as a reference, so it no longer corresponds to what the preview now shows. The frontend currently only offers retry on failed previews (which can't have a finalize result yet), but the API enforces this regardless of what the UI allows.
- Response: same shape as a single item in `/api/generate/preview`'s `previews` array — `{"preview_id": 3, "candidate_index": 2, "image_path": "...", "status": "success", "provider": "local", "final_image_path": null, "final_status": null, "final_provider": null, "finalized_at": null}`.
- Failure (provider function returns `None`) is recorded as `status: "failed"`, same as the initial batch — not an unhandled 500.

## `GET /api/history`

- Query params: `limit` (default 20), `offset` (default 0), `sort` (`newest` | `oldest`, default `newest`), `q` (optional, substring match against `original_prompt`, case-insensitive via `ilike`).
- Returns sessions (regardless of finalize state) ordered by `created_at`, with `id` as a tiebreaker since SQLite's `CURRENT_TIMESTAMP` only has second precision. Each session includes all 4 of its previews, each with its own `final_*` fields.
- `q` filters server-side before `limit`/`offset` are applied, so a match on an unloaded page is still reachable by paging further in — the History screen's search box used to filter only the already-loaded page client-side (and hid "Load more" while a query was active), which made matches outside the first page unreachable. Fixed 2026-08-09.
- Response: array of `{"session_id", "original_prompt", "enhanced_prompt", "provider", "created_at", "previews": [...]}`.

## Static file serving

`app.mount("/static", StaticFiles(directory="static"), name="static")`. Unauthenticated — protected only by unguessable UUID filenames. The frontend builds absolute URLs by joining `NEXT_PUBLIC_API_URL` with `image_path`.

## Timeouts

Both preview and finalize generation can legitimately take several minutes under Gemini API load, and local CPU-only inference (no GPU passthrough, e.g. Docker Desktop on Apple Silicon) can run even longer. `frontend/src/lib/backendFetch.ts` passes a per-request `undici.Agent` with `headersTimeout`/`bodyTimeout` of 15 minutes to the BFF's `fetch()` calls — Node's default `fetch` (undici) has a 5-minute `headersTimeout` that is too short for this workload. `frontend/next.config.ts` sets `serverExternalPackages: ["undici"]` so this doesn't get bundled by webpack (bundling `undici`'s mock subsystem fails on a `node:console` import it can't resolve). The `local` provider's own poll loop against ComfyUI is separately bounded by `LOCAL_GENERATION_TIMEOUT_SECONDS` (default 900s).
