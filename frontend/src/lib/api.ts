const IMAGE_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type GenerationStatus = "success" | "failed";

export type PreviewImage = {
  preview_id: number;
  candidate_index: number;
  image_path: string | null;
  status: GenerationStatus;
  // The result of finalizing this preview to 4K. Each preview holds its own independently.
  final_image_path: string | null;
  final_status: GenerationStatus | null;
  finalized_at: string | null;
};

export type GeneratePreviewResponse = {
  session_id: number;
  enhanced_prompt: string;
  previews: PreviewImage[];
};

export type FinalizeResponse = {
  session_id: number;
  preview_id: number;
  image_path: string | null;
  status: GenerationStatus;
  created_at: string;
};

export type HistorySessionItem = {
  session_id: number;
  original_prompt: string;
  enhanced_prompt: string;
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

export function generatePreview(prompt: string): Promise<GeneratePreviewResponse> {
  return apiFetch<GeneratePreviewResponse>("/api/generate/preview", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

export function generateFinalize(sessionId: number, previewId: number): Promise<FinalizeResponse> {
  return apiFetch<FinalizeResponse>("/api/generate/finalize", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, preview_id: previewId }),
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

export function resolveImageUrl(imagePath: string): string {
  return `${IMAGE_BASE_URL}${imagePath}`;
}

export function downloadUrl(imagePath: string): string {
  return `/api/download?path=${encodeURIComponent(imagePath)}`;
}
