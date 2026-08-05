"use client";

import { useEffect, useState } from "react";
import { getHistory, resolveImageUrl, type HistorySessionItem } from "@/lib/api";
import { HistorySessionModal } from "@/components/HistorySessionModal";

const PAGE_SIZE = 20;

function thumbnailPath(session: HistorySessionItem): string | null {
  if (session.final_status === "success" && session.final_image_path) {
    return session.final_image_path;
  }
  return session.previews.find((p) => p.status === "success" && p.image_path)?.image_path ?? null;
}

export function HistoryGallery() {
  const [items, setItems] = useState<HistorySessionItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);

  // Initial load. Guarded against React Strict Mode's dev-only double effect
  // invocation, which would otherwise fetch and append the first page twice
  // (visible as duplicate images and duplicate-key warnings).
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    getHistory(PAGE_SIZE, 0)
      .then((next) => {
        if (ignore) return;
        setItems(next);
        setOffset(next.length);
        setHasMore(next.length === PAGE_SIZE);
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : "Failed to load history");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getHistory(PAGE_SIZE, offset);
      setItems((prev) => [...prev, ...next]);
      setOffset((prev) => prev + next.length);
      setHasMore(next.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  const handleFinalized = (sessionId: number, imagePath: string, previewId: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.session_id === sessionId
          ? {
              ...item,
              final_image_path: imagePath,
              final_status: "success",
              selected_preview_id: previewId,
            }
          : item,
      ),
    );
    setOpenSessionId(null);
  };

  const openSession = items.find((item) => item.session_id === openSessionId) ?? null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">History</h1>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {items.length === 0 && !loading ? (
        <p className="text-sm text-neutral-500">No history yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => {
            const isFinalized = item.final_status === "success" && !!item.final_image_path;
            const thumbnail = thumbnailPath(item);
            return (
              <div key={item.session_id} className="space-y-2">
                <button
                  type="button"
                  onClick={() => setOpenSessionId(item.session_id)}
                  className="block aspect-square w-full overflow-hidden rounded-md border border-neutral-700"
                >
                  {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveImageUrl(thumbnail)}
                      alt={item.original_prompt}
                      className="h-full w-full object-cover transition hover:opacity-80"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-red-400">
                      Generation failed
                    </div>
                  )}
                </button>
                <p className="truncate text-xs text-neutral-400">{item.original_prompt}</p>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-neutral-600">
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                  {!isFinalized && (
                    <button
                      type="button"
                      onClick={() => setOpenSessionId(item.session_id)}
                      className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800"
                    >
                      Generate 4K
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="rounded-md border border-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}

      {openSession && (
        <HistorySessionModal
          session={openSession}
          onClose={() => setOpenSessionId(null)}
          onFinalized={handleFinalized}
        />
      )}
    </main>
  );
}
