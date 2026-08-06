# API

FastAPI backend. See [backend/main.py](../../backend/main.py) for the source of truth.

All endpoints below except static file serving require `Authorization: Bearer <APP_API_TOKEN>` (see [overview.md](overview.md#security)). The browser never sends this header directly — it calls the frontend's own `/api/*` Route Handlers (BFF), which attach the token and proxy to the backend.

## `POST /api/generate/preview`

Generates 4 low-resolution preview candidates. Rate-limited (`RATE_LIMIT_PER_HOUR`, default 10/hour).

- Request: `{"prompt": "a quiet hot spring inn surrounded by mountains"}` (1–200 chars)
- Processing:
  1. Expand the prompt into an English, photorealistic-only prompt via `gemini-3.6-flash` (see the system prompt rules in [overview.md](overview.md)).
  2. Create a `sessions` row and commit immediately — the write lock must be released before the slow Gemini call, or a concurrent request fails with `database is locked`.
  3. Call `gemini-3-pro-image` at `image_size="1K"` **4 separate times in parallel** (`asyncio.gather`) — the image models don't support `candidateCount`, so one request can't return multiple candidates.
  4. A single preview's failure doesn't fail the whole batch: each call catches `APIError` and returns `None`, recorded as `status: "failed"` for that candidate only.
  5. Persist all 4 results to `preview_images`.
- Response: `{"session_id": 1, "enhanced_prompt": "...", "previews": [{"preview_id": 1, "candidate_index": 0, "image_path": "...", "status": "success", "final_image_path": null, "final_status": null, "finalized_at": null}, ...4 total]}`

## `POST /api/generate/finalize`

Finalizes one selected preview into a 4K image. Rate-limited the same as preview.

- Request: `{"session_id": 1, "preview_id": 3}`
- Processing:
  1. Validate that `preview_id` belongs to `session_id` and has a non-null `image_path`.
  2. Pass the selected preview image as a **reference image** to `gemini-3-pro-image`, with the same `enhanced_prompt` and `image_size="4K"`, so the composition is preserved while upscaling.
  3. Save the result and update `preview_images.final_image_path` / `final_status` / `final_error_message` / `resolution` / `finalized_at` — **not** any column on `sessions`, since each preview in a session finalizes independently.
- Response: `{"session_id": 1, "preview_id": 3, "image_path": "...", "status": "success", "created_at": "..."}`
- On failure (e.g. `APIError` from Gemini), `services.py` returns `None` and this is recorded as `final_status: "failed"` rather than raising an unhandled 500.

## `GET /api/history`

- Query params: `limit` (default 20), `offset` (default 0), `sort` (`newest` | `oldest`, default `newest`).
- Returns sessions (regardless of finalize state) ordered by `created_at`, with `id` as a tiebreaker since SQLite's `CURRENT_TIMESTAMP` only has second precision. Each session includes all 4 of its previews, each with its own `final_*` fields.
- Response: array of `{"session_id", "original_prompt", "enhanced_prompt", "created_at", "previews": [...]}`.

## Static file serving

`app.mount("/static", StaticFiles(directory="static"), name="static")`. Unauthenticated — protected only by unguessable UUID filenames. The frontend builds absolute URLs by joining `NEXT_PUBLIC_API_URL` with `image_path`.

## Timeouts

Both preview and finalize generation can legitimately take several minutes under Gemini API load. `frontend/src/lib/backendFetch.ts` passes a per-request `undici.Agent` with `headersTimeout`/`bodyTimeout` of 10 minutes to the BFF's `fetch()` calls — Node's default `fetch` (undici) has a 5-minute `headersTimeout` that is too short for this workload. `frontend/next.config.ts` sets `serverExternalPackages: ["undici"]` so this doesn't get bundled by webpack (bundling `undici`'s mock subsystem fails on a `node:console` import it can't resolve).
