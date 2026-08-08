// How long a generation request is allowed to run end-to-end (see backendFetch.ts,
// which is the actual enforcement point). Kept in its own dependency-free module so
// client components can reason about "how long can this legitimately still be
// running" (HistoryGallery's generating-vs-failed guess, GeneratorApp's
// resume-after-navigation window) without pulling backendFetch.ts's undici import
// (Node-only) into the browser bundle.
export const LONG_TIMEOUT_MS = 5_700_000;
