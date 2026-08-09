# Screen: Generate (`/`)

Component: [frontend/src/components/GeneratorApp.tsx](../../../frontend/src/components/GeneratorApp.tsx), tiles rendered via the shared [PreviewTile.tsx](../../../frontend/src/components/PreviewTile.tsx) (also used by [History](history.md)'s session modal).

The default landing screen. One prompt → 4 previews → pick one to finish in 4K, all in a single-session flow (no persistence of in-progress state across reloads beyond the resume-on-navigate marker below — completed sessions show up in [History](history.md) afterward).

## States

`idle → generating-preview → preview-ready → done`

1. **idle**: a textarea (max 200 chars), a provider `ProviderSelect` ("Model"), and a "Generate previews" button. Button is disabled while empty or busy.
2. **generating-preview**: calls `POST /api/generate/preview` (via `lib/api.ts#generatePreview`). Shows `ProgressIndicator` with label "Generating 4 previews". On failure, shows the error message and returns to `idle`. Writes a `sessionStorage` marker (`writePendingGeneration`) so navigating away and back resumes into this state instead of showing an empty form (see Notes).
3. **preview-ready**: renders the 4 preview candidates in a `grid-cols-4`, each as a `PreviewTile`. Each tile independently shows one of three states based on that specific preview's own data — not a page-level phase, since finalize/retry now happen per-tile and can be in flight on different tiles at once:
   - **Finalized** (`final_status === "success"`): the 4K image, an accent badge naming `final_provider`, and a "Download 4K" link.
   - **Successful, not yet finalized**: the 1K image, a badge naming that preview's own `provider`, a per-tile `ProviderSelect` (defaults to the preview's own provider — see [api.md](../api.md#providers)) and a "Generate 4K" button (`POST /api/generate/finalize`).
   - **Failed** (`status !== "success"`): a "Generation failed" placeholder, a per-tile `ProviderSelect` and a "Retry" button (`POST /api/generate/preview/retry`) — regenerates just this one candidate, not the other 3.
   Only the tile with an action in flight shows its own `ProgressBar`; the other tiles are disabled meanwhile (`PreviewTile`'s `disabled` prop) so a second action can't start on top of it.
4. **done**: reached once at least one tile has been finalized (there's no dedicated large "final image" section anymore — the finalized tile in the grid above already shows it full-size-enough with its badge and download link; see History below for why this changed from an earlier single-`finalImagePath` design).

## Notes

- Generation is genuinely slow (the preview batch, a single retry, and the 4K finalize can each take minutes under provider load) — see the timeout handling in [api.md](../api.md#timeouts).
- **Resume on navigate**: `handleGeneratePreview` records `{prompt, provider, startedAt}` to `sessionStorage` before calling the API, and clears it on settle. If this component mounts with a recent-enough (< `LONG_TIMEOUT_MS`) marker still present, it restores the prompt/provider, shows `generating-preview`, and polls `GET /api/history` every 5s looking for a matching session (by `original_prompt` + `provider` + a `created_at` window) instead of showing an empty form. Matched by content/timing rather than `session_id`, since the tab that navigated away never saw the original response.
- **Per-tile provider state**: `finalizeProviderByPreview`/`retryProviderByPreview` are `Record<previewId, Provider>` maps, not one page-level value — individual retry means the 4 tiles in one session can end up with genuinely different providers (see [api.md](../api.md#providers)), so a single global "4K with" selector would be misleading once that happens. This mirrors [History](history.md)'s session modal, which established the pattern first.
