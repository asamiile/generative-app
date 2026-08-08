import { Agent } from "undici";

// Node's built-in fetch (undici) defaults to a 5-minute headers timeout. Gemini
// image generation can exceed that under load, and the frontend would then give
// up and return a 500 even though the backend is still working. Extended well
// beyond what Gemini alone needs: the local provider's CPU-only finalize step at
// large resolutions (targeting 4K) was measured taking 15+ minutes per attempt in
// testing, so this must comfortably exceed backend's own LOCAL_GENERATION_TIMEOUT_SECONDS.
const longTimeoutDispatcher = new Agent({
  headersTimeout: 5_700_000,
  bodyTimeout: 5_700_000,
});

export function backendFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, dispatcher: longTimeoutDispatcher } as RequestInit);
}
