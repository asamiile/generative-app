import { Agent, fetch as undiciFetch, type RequestInit, type Response } from "undici";

import { LONG_TIMEOUT_MS } from "@/lib/timeouts";

// Node's built-in fetch defaults to a 5-minute headers timeout. Gemini image
// generation can exceed that under load, and the frontend would then give up
// and return a 500 even though the backend is still working. Extended well
// beyond what Gemini alone needs: the local provider's CPU-only finalize step at
// large resolutions (targeting 4K) was measured taking 15+ minutes per attempt in
// testing, so this must comfortably exceed backend's own LOCAL_GENERATION_TIMEOUT_SECONDS.
//
// Use undici's own fetch here rather than Node's built-in global fetch: a
// `dispatcher` must come from the same undici version as the fetch implementation
// that consumes it. Node's built-in fetch is powered by whatever undici version
// ships inside that Node release, which can be an older major than the `undici`
// package installed from npm -- passing a newer Agent into the older built-in
// fetch throws (e.g. "invalid onRequestStart method"). Importing fetch from the
// `undici` package itself keeps both sides pinned to the same version.
const longTimeoutDispatcher = new Agent({
  headersTimeout: LONG_TIMEOUT_MS,
  bodyTimeout: LONG_TIMEOUT_MS,
});

export function backendFetch(url: string, init: RequestInit): Promise<Response> {
  return undiciFetch(url, { ...init, dispatcher: longTimeoutDispatcher });
}
