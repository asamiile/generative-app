import { Agent } from "undici";

// Node's built-in fetch (undici) defaults to a 5-minute headers timeout. Gemini
// image generation can exceed that under load, and the frontend would then give
// up and return a 500 even though the backend is still working. Extend it to 10
// minutes via a per-request dispatcher.
const longTimeoutDispatcher = new Agent({
  headersTimeout: 600_000,
  bodyTimeout: 600_000,
});

export function backendFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, dispatcher: longTimeoutDispatcher } as RequestInit);
}
