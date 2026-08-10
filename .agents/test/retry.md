# Manual test: individual retry & regenerate

Quick manual checklist for the retry feature (`POST /api/generate/preview/retry`) and
the Regenerate-in-place change built on top of it. See [../docs/api.md](../docs/api.md)
and [../docs/screens/](../docs/screens/) for the full design — this is just a "does it
still work" pass, not exhaustive.

**Prerequisites**: at least 2 providers configured in `backend/.env` (e.g. `gemini` +
`local`), so the cross-provider fallback case (below) is actually testable. `docker
compose up`, then open [http://localhost:3000](http://localhost:3000).

## 1. Individual retry — Generate screen (`/generate/image`)

1. Enter a prompt, pick a provider, click "Generate previews".
2. Once the 4 tiles appear, force one to fail — easiest way is to temporarily set a
   wrong API key for the chosen provider in `backend/.env` and restart the backend
   (`docker compose up -d backend`) before generating, or just wait for an organic
   failure (rare when providers are healthy). Revert the key afterward.
3. On the failed tile: confirm it shows "Generation failed" + a provider dropdown +
   "Retry" button (not the old "click the whole image" behavior).
4. Change the dropdown to a *different* provider than the one that failed, click Retry.
5. **Expected**: the tile switches to the new image, its badge now shows the new
   provider, and the other 3 tiles are untouched.

## 2. Individual retry — History screen (`/generate/image/history` modal)

1. Open a past session that has at least one failed preview (or produce one via step 1
   above, then navigate to `/generate/image/history`).
2. Click the card to open the session modal.
3. **Expected**: same three-state tile rendering as `/generate/image` (finalized / success+Generate 4K
   / failed+Retry) — this is the shared `PreviewTile` component, so behavior should be
   identical to section 1.
4. Retry the failed tile with a provider left at its default (don't touch the dropdown).
5. **Expected**: the dropdown's default equals the tile's own last provider, not
   necessarily the session's original one (see section 4 below for why this matters).

## 3. Regenerate — History screen (all 4 failed)

1. Get a session where **all 4** previews failed (temporarily break every configured
   provider's key, generate once, then restore the keys).
2. On `/generate/image/history`, the card should be non-interactive ("Generation failed" + a provider
   dropdown + "Regenerate" button, no click-to-open).
3. Click Regenerate.
4. **Expected**: the *same* card updates in place (compare the thumbnail/prompt) —
   confirm via the URL bar or a DB check (`sqlite3` into the container, or just note
   the session's position in the list before/after) that this did **not** insert a new
   entry. Total session count in the list should be unchanged.

## 4. Fallback: finalize follows the retried provider, not the session's

This is the specific bug this feature fixed — worth checking explicitly, not just
trusting the pytest coverage.

1. Generate previews with provider A (e.g. `gemini`).
2. Retry one preview with provider B (e.g. `local`) — see section 1 or 2.
3. On that *same* tile, click "Generate 4K" **without touching the finalize provider
   dropdown** (i.e. leave it at its default).
4. **Expected**: the dropdown's default (and the resulting finalized badge) is
   provider B (`local`), not provider A (`gemini`) — confirming finalize defaulted to
   this preview's own current provider, not the session's original one.

## 5. Badge sanity check

- Every preview tile (Generate and History modal) shows exactly one badge, in the
  top-left corner: the finalize provider once finalized, otherwise the preview's own
  generating provider.
- After doing a mixed-provider retry (section 4), open that session's card in
  `/generate/image/history` and confirm the grid thumbnail's badge matches whichever image was
  actually picked as the thumbnail (finalized image takes priority — see
  `pickThumbnail` in [../docs/screens/history.md](../docs/screens/history.md)), not
  necessarily the session's original provider.

## Automated coverage

Steps 1, 2, and 4 above are also covered by `backend/tests/test_retry_preview.py` and
`test_generate_finalize_defaults_to_retried_provider_not_session_provider` in
`backend/tests/test_generate.py` (`docker compose exec backend pytest`) — this manual
pass is for the parts those can't reach (actual UI rendering, click flow).
