# Screen: Generate (`/`)

Component: [frontend/src/components/GeneratorApp.tsx](../../../frontend/src/components/GeneratorApp.tsx)

The default landing screen. One prompt → 4 previews → pick one → 4K final image, all in a single-session flow (no persistence of in-progress state across reloads — completed sessions show up in [History](history.md) afterward).

## States

`idle → generating-preview → preview-ready → finalizing → done`

1. **idle**: a textarea (max 200 chars) and a "Generate previews" button. Button is disabled while empty or busy.
2. **generating-preview**: calls `POST /api/generate/preview` (via `lib/api.ts#generatePreview`). Shows `ProgressIndicator` with label "Generating 4 previews". On failure, shows the error message and returns to `idle`.
3. **preview-ready**: renders the 4 preview candidates in a `grid-cols-4`. A candidate that failed (`status !== "success"`) is shown as a disabled tile with "Generation failed" instead of an image. Clicking a successful candidate calls `POST /api/generate/finalize` with that `preview_id`.
4. **finalizing**: shows `ProgressIndicator` with label "Finishing in 4K — this can take a minute". On failure, shows the error and returns to `preview-ready` (the previews stay selectable, so the user can retry or pick a different candidate).
5. **done**: shows the finalized 4K image plus a "Download" link (`lib/api.ts#downloadUrl`, proxied through the BFF).

## Notes

- Generation is genuinely slow (the preview batch and the 4K finalize can each take minutes under Gemini API load) — see the timeout handling in [api.md](../api.md#timeouts).
- There's no retry-in-place for a failed candidate on this screen; the [History](history.md) screen has a "Regenerate" affordance for entire failed sessions.
