# Database

SQLite (`history.db`), schema versioned with Alembic. See [backend/models.py](../../backend/models.py) for the source of truth and [backend/alembic/versions/](../../backend/alembic/versions/) for migration history.

Two tables: `sessions` (one row per prompt submission) and `preview_images` (four rows per session — one per preview candidate). Finalize (4K) state lives on `preview_images`, not `sessions`, because each of the 4 previews in a session can be independently finalized to 4K.

## `sessions`

| column | type | notes |
|---|---|---|
| id | Integer (PK) | autoincrement |
| original_prompt | String(200) | the user's raw input |
| enhanced_prompt | Text | English prompt expanded by the session's provider |
| provider | Enum(`gemini`, `local`, `openai`, `stability`), `server_default="gemini"` | which provider generated the 4 previews. Finalize is independently selectable per preview, see `preview_images.final_provider` below |
| created_at | DateTime (tz-aware, `server_default=func.now()`, **indexed**) | indexed because `/api/history` sorts by it |

## `preview_images`

| column | type | notes |
|---|---|---|
| id | Integer (PK) | autoincrement |
| session_id | Integer (FK → `sessions.id`, `ondelete="CASCADE"`, **indexed**) | deleting a session deletes its previews |
| candidate_index | Integer | 0–3, display order |
| image_path | String(255), nullable | relative path to the 1K preview; NULL on failure |
| status | Enum(`success`, `failed`) | preview generation result |
| error_message | Text, nullable | |
| provider | Enum(`gemini`, `local`, `openai`, `stability`), not nullable | provider that generated the *current* `image_path`/`status`. Initially copied from `sessions.provider` at creation; overwritten by `POST /api/generate/preview/retry`, which can retry with a different provider than the rest of the session. Unlike `final_provider` below, this is never NULL — every preview has a generating provider from the moment it's created |
| created_at | DateTime (tz-aware, `server_default=func.now()`) | |
| final_image_path | String(255), nullable | relative path to the 4K result; NULL until finalized |
| final_status | Enum(`success`, `failed`), nullable | NULL until finalize is attempted |
| final_error_message | Text, nullable | |
| resolution | String(16), nullable | `"4K"` once finalized |
| finalized_at | DateTime (tz-aware), nullable | |
| final_provider | Enum(`gemini`, `local`, `openai`, `stability`), nullable | provider used for *this preview's* finalize attempt; NULL until finalize is attempted. Defaults to this row's own `provider` when the finalize request omits it (not `sessions.provider` — see below), but can differ (e.g. preview generated locally, finalized with Gemini because local finalize is too slow/unreliable at high resolution). Cleared back to NULL if this preview is later retried (see `provider` above and `POST /api/generate/preview/retry` in [api.md](api.md)) |

## Migration policy

- Every schema change gets an Alembic revision — never rely on `Base.metadata.create_all()` alone.
- `backend/database.py`'s `init_db()` bootstraps a fresh DB (no `alembic_version` table) with `create_all()` + `stamp("head")`, and applies `upgrade head` to an existing DB. This mirrors the pattern used in the sibling repo `spira-base`.
- Foreign keys always specify an `ondelete` policy and `index=True`; `status`-like columns are always an Enum, never a free-form string.

## History

`sessions.selected_preview_id` and the session-level `final_*` columns from the original design existed briefly but were removed in migration `0002_finalize_state_per_preview`: finalize state was moved onto `preview_images` so multiple previews in one session can each be finalized to 4K independently, instead of a session holding only one "selected" result that gets overwritten.

`sessions.provider` was added in migration `0003_add_session_provider.py` (plain `op.add_column` with `nullable=False, server_default="gemini"` — SQLite allows this natively for adding a column; `batch_alter_table` is only needed for `drop_column`, as in `0002`) to support the local Ollama+ComfyUI generation path alongside Gemini (see [api.md](api.md#providers)).

`preview_images.final_provider` was added in migration `0004_add_preview_final_provider.py` (nullable, no default needed since existing rows' finalize state is either NULL or already reflects their session's provider at the time). Introduced once local CPU-only finalize was confirmed impractical at high resolution (hours per image, see [overview.md](overview.md#providers)) — finalize needed to pick a different provider than the one that generated the preview, which `sessions.provider` alone couldn't express.

`openai`/`stability` were added to `ProviderType` in migration `0005_add_openai_stability_providers.py`. Note this DB has no CHECK constraint enforcing the enum's allowed values on SQLite (confirmed by inspecting the schema — this SQLAlchemy version doesn't add one), so adding new Python enum members alone would already "work" at the DB layer; the migration instead widens the declared column type from `VARCHAR(6)` (auto-sized to fit `"gemini"`, the longest of the original two values) to fit `"stability"` (9 chars) — a schema-correctness fix, not a functional one, but matters if this ever runs against a backend that does enforce VARCHAR length.

`preview_images.provider` was added in migration `0006_add_preview_provider.py` to support individual-preview retry (`POST /api/generate/preview/retry` in [api.md](api.md)): before this, only `sessions.provider` existed, which was accurate for the initial batch of 4 but went stale the instant any one preview was retried with a different provider. Added as nullable, backfilled from each row's `sessions.provider` via a correlated `UPDATE`, then altered to `NOT NULL` (`batch_alter_table`, required on SQLite for altering nullability, same as the `final_provider` type widen in `0005`) — the same nullable → backfill → NOT NULL sequence would apply to any future column that needs a value derived from existing data rather than one literal default.
