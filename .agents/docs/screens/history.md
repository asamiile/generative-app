# Screen: History (`/history`)

Components: [frontend/src/components/HistoryGallery.tsx](../../../frontend/src/components/HistoryGallery.tsx), [HistorySessionModal.tsx](../../../frontend/src/components/HistorySessionModal.tsx)

Lists every past session as a thumbnail grid, paginated via `GET /api/history`.

## Gallery (`HistoryGallery.tsx`)

- Fetches page 1 on mount and whenever `sort` changes; `loadMore` appends subsequent pages (`PAGE_SIZE = 20`).
- **Thumbnail selection** (`thumbnailPath`): if any preview in the session has been finalized to 4K, use the most recently finalized one (`finalized_at`); otherwise fall back to the first successful 1K preview.
- **Failed sessions** (all 4 previews failed, so `thumbnailPath` returns `null`): rendered as a non-interactive card with "Generation failed" and a **Regenerate** button (top-right of the thumbnail). Regenerate calls `generatePreview(item.original_prompt)` to create a brand-new session and inserts it into the list (prepended if `sort === "newest"`, appended if `"oldest"`). Clicking the card itself does nothing — there's no image to show in the modal.
- **Search**: client-side substring filter over `original_prompt` (`filteredItems`, no server round-trip).
- **Sort**: `newest` | `oldest`, toggled by a button; refetches page 1 from the server (`GET /api/history?sort=...`) rather than re-sorting client-side.
- Empty/loading states are gated on an `initialLoadDone` flag so "No history yet" and "Load more" never flash before the first fetch resolves.

## Session modal (`HistorySessionModal.tsx`)

Opens when a non-failed card is clicked. Shows the original prompt (with a copy-to-clipboard button) and all 4 previews in a 2×2 grid.

- A preview with `final_status === "success"` shows a "Download 4K" badge (top-right) linking to the 4K file.
- A preview without a finalized result is clickable and shows a "Generate 4K" badge; clicking calls `POST /api/generate/finalize` for that specific `preview_id`.
- Multiple previews within the same session can each be finalized independently in one sitting — the modal does **not** auto-close after a successful finalize, so the user can finalize a second (or third, or fourth) preview right after.
- `onFinalized` updates only the specific preview's `final_*` fields in the gallery's in-memory state (no full refetch).
