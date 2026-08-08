const IMAGE_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type GenerationStatus = "success" | "failed";

export type Provider = "gemini" | "local" | "openai" | "stability";

export type PreviewImage = {
  preview_id: number;
  candidate_index: number;
  image_path: string | null;
  status: GenerationStatus;
  // The result of finalizing this preview to 4K. Each preview holds its own independently.
  final_image_path: string | null;
  final_status: GenerationStatus | null;
  // Provider used for this preview's finalize attempt -- may differ from the
  // session's (preview-generating) provider. Null until finalize is attempted.
  final_provider: Provider | null;
  finalized_at: string | null;
};

export type GeneratePreviewResponse = {
  session_id: number;
  enhanced_prompt: string;
  provider: Provider;
  previews: PreviewImage[];
};

export type FinalizeResponse = {
  session_id: number;
  preview_id: number;
  image_path: string | null;
  status: GenerationStatus;
  provider: Provider;
  created_at: string;
};

export type HistorySessionItem = {
  session_id: number;
  original_prompt: string;
  enhanced_prompt: string;
  provider: Provider;
  created_at: string;
  previews: PreviewImage[];
};

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export function generatePreview(prompt: string, provider: Provider): Promise<GeneratePreviewResponse> {
  return apiFetch<GeneratePreviewResponse>("/api/generate/preview", {
    method: "POST",
    body: JSON.stringify({ prompt, provider }),
  });
}

export function generateFinalize(
  sessionId: number,
  previewId: number,
  provider?: Provider,
): Promise<FinalizeResponse> {
  return apiFetch<FinalizeResponse>("/api/generate/finalize", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, preview_id: previewId, provider }),
  });
}

export type HistorySort = "newest" | "oldest";

export function getHistory(
  limit = 20,
  offset = 0,
  sort: HistorySort = "newest",
): Promise<HistorySessionItem[]> {
  return apiFetch<HistorySessionItem[]>(
    `/api/history?limit=${limit}&offset=${offset}&sort=${sort}`,
  );
}

export function getAvailableProviders(): Promise<Provider[]> {
  return apiFetch<Provider[]>("/api/providers");
}

export function resolveImageUrl(imagePath: string): string {
  return `${IMAGE_BASE_URL}${imagePath}`;
}

export function downloadUrl(imagePath: string): string {
  return `/api/download?path=${encodeURIComponent(imagePath)}`;
}
