# Database

SQLite (`history.db`), schema versioned with Alembic. See [backend/models.py](../../backend/models.py) for the source of truth and [backend/alembic/versions/](../../backend/alembic/versions/) for migration history.

Two tables: `sessions` (one row per prompt submission) and `preview_images` (four rows per session — one per preview candidate). Finalize (4K) state lives on `preview_images`, not `sessions`, because each of the 4 previews in a session can be independently finalized to 4K.

## `sessions`

| column | type | notes |
|---|---|---|
| id | Integer (PK) | autoincrement |
| original_prompt | String(200) | the user's raw input |
| enhanced_prompt | Text | English prompt expanded by Gemini |
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
| created_at | DateTime (tz-aware, `server_default=func.now()`) | |
| final_image_path | String(255), nullable | relative path to the 4K result; NULL until finalized |
| final_status | Enum(`success`, `failed`), nullable | NULL until finalize is attempted |
| final_error_message | Text, nullable | |
| resolution | String(16), nullable | `"4K"` once finalized |
| finalized_at | DateTime (tz-aware), nullable | |

## Migration policy

- Every schema change gets an Alembic revision — never rely on `Base.metadata.create_all()` alone.
- `backend/database.py`'s `init_db()` bootstraps a fresh DB (no `alembic_version` table) with `create_all()` + `stamp("head")`, and applies `upgrade head` to an existing DB. This mirrors the pattern used in the sibling repo `spira-base`.
- Foreign keys always specify an `ondelete` policy and `index=True`; `status`-like columns are always an Enum, never a free-form string.

## History

`sessions.selected_preview_id` and the session-level `final_*` columns from the original design existed briefly but were removed in migration `0002_finalize_state_per_preview`: finalize state was moved onto `preview_images` so multiple previews in one session can each be finalized to 4K independently, instead of a session holding only one "selected" result that gets overwritten.
