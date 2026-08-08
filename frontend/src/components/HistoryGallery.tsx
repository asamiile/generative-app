"use client";

import { useEffect, useMemo, useState } from "react";
import {
  generatePreview,
  getHistory,
  resolveImageUrl,
  type HistorySessionItem,
  type HistorySort,
  type Provider,
} from "@/lib/api";
import { HistorySessionModal } from "@/components/HistorySessionModal";

const PAGE_SIZE = 20;
// The backend commits the sessions row before generating previews, so a session with
// zero previews is normally still in progress. Cap how long we assume that, matching
// the extended fetch timeout in lib/backendFetch.ts, so a session whose request
// actually crashed doesn't show "Generating…" forever.
const GENERATING_THRESHOLD_MS = 10 * 60 * 1000;

function isLikelyGenerating(session: HistorySessionItem): boolean {
  if (session.previews.length > 0) return false;
  return Date.now() - new Date(session.created_at).getTime() < GENERATING_THRESHOLD_MS;
}

const PROVIDER_LABEL: Record<HistorySessionItem["provider"], string> = {
  local: "Local",
  gemini: "Gemini",
  openai: "OpenAI",
  stability: "Stability AI",
};

function SessionMeta({ item }: { item: HistorySessionItem }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="truncate text-sm text-ink-secondary">{item.original_prompt}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs text-ink-faint">{new Date(item.created_at).toLocaleString()}</p>
        <span className="rounded-full border border-app-border px-1.5 py-0.5 text-[10px] text-ink-muted">
          {PROVIDER_LABEL[item.provider]}
        </span>
      </div>
    </div>
  );
}

function thumbnailPath(session: HistorySessionItem): string | null {
  // If multiple previews have been finalized to 4K, use the most recently finalized one as the thumbnail.
  // The grid always displays it square (object-cover), matching the design regardless
  // of the underlying image's own aspect ratio.
  const finalized = session.previews.filter((p) => p.final_status === "success" && p.final_image_path);
  if (finalized.length > 0) {
    const latest = finalized.reduce((a, b) => ((b.finalized_at ?? "") > (a.finalized_at ?? "") ? b : a));
    return latest.final_image_path;
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HistorySort>("newest");
  // A Set, not a single ID: regenerating two sessions back-to-back (before the first
  // finishes) previously shared one ID, so starting the second wiped the first's
  // "Regenerating…" state even though its request was still in flight.
  const [regeneratingSessionIds, setRegeneratingSessionIds] = useState<Set<number>>(new Set());
  // Regenerate provider is independently selectable per session (defaults to the
  // provider that failed), same rationale/pattern as finalize's provider dropdown.
  const [regenerateProviderBySession, setRegenerateProviderBySession] = useState<
    Record<number, Provider>
  >({});
  // Don't show either "No history yet" or "Load more" until the first fetch resolves.
  // Judging solely from items/hasMore's initial values (empty array / true) would make
  // both conditions true for a moment before the fetch completes.
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // (Re)load from the first page whenever the sort order changes (including on
  // mount). Guarded against React Strict Mode's dev-only double effect
  // invocation, which would otherwise fetch and append the first page twice
  // (visible as duplicate images and duplicate-key warnings).
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    getHistory(PAGE_SIZE, 0, sort)
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
        if (!ignore) {
          setLoading(false);
          setInitialLoadDone(true);
        }
      });
    return () => {
      ignore = true;
    };
  }, [sort]);

  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getHistory(PAGE_SIZE, offset, sort);
      setItems((prev) => [...prev, ...next]);
      setOffset((prev) => prev + next.length);
      setHasMore(next.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = () => {
    setSort((prev) => (prev === "newest" ? "oldest" : "newest"));
  };

  const getRegenerateProvider = (item: HistorySessionItem): Provider =>
    regenerateProviderBySession[item.session_id] ?? item.provider;

  const handleRegenerate = async (item: HistorySessionItem) => {
    setRegeneratingSessionIds((prev) => new Set(prev).add(item.session_id));
    setError(null);
    try {
      const result = await generatePreview(item.original_prompt, getRegenerateProvider(item));
      const newItem: HistorySessionItem = {
        session_id: result.session_id,
        original_prompt: item.original_prompt,
        enhanced_prompt: result.enhanced_prompt,
        provider: result.provider,
        created_at: new Date().toISOString(),
        previews: result.previews,
      };
      // Regenerate creates a new session, so add it to the front/back per the current sort order.
      setItems((prev) => (sort === "newest" ? [newItem, ...prev] : [...prev, newItem]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate previews");
    } finally {
      setRegeneratingSessionIds((prev) => {
        const next = new Set(prev);
        next.delete(item.session_id);
        return next;
      });
    }
  };

  const handleFinalized = (
    sessionId: number,
    previewId: number,
    imagePath: string,
    provider: Provider,
  ) => {
    const finalizedAt = new Date().toISOString();
    setItems((prev) =>
      prev.map((item) =>
        item.session_id === sessionId
          ? {
              ...item,
              previews: item.previews.map((p) =>
                p.preview_id === previewId
                  ? {
                      ...p,
                      final_image_path: imagePath,
                      final_status: "success",
                      final_provider: provider,
                      finalized_at: finalizedAt,
                    }
                  : p,
              ),
            }
          : item,
      ),
    );
    // Don't close the modal: lets the user keep finalizing other previews in the same session.
  };

  const openSession = items.find((item) => item.session_id === openSessionId) ?? null;

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.original_prompt.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col px-6 py-12">
      <div className="mb-11 flex items-center justify-between gap-4">
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink-primary">
          History
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex w-[260px] items-center gap-2 rounded-md border border-app-border bg-app-surface px-3 py-2">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="flex-shrink-0 text-ink-muted"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              placeholder="Search prompts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full border-none bg-transparent text-sm text-ink-secondary outline-none placeholder:text-ink-muted"
            />
          </div>
          <button
            type="button"
            onClick={toggleSort}
            title={sort === "newest" ? "Sorted newest first" : "Sorted oldest first"}
            className="flex items-center gap-1 rounded-md border border-app-border px-3 py-2 text-sm text-ink-secondary transition hover:bg-app-surfaceAlt"
          >
            {sort === "newest" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M6 12h12M10 18h4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 6H3M18 12H6M14 18h-4" />
              </svg>
            )}
            {sort === "newest" ? "Newest" : "Oldest"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {initialLoadDone && filteredItems.length === 0 && !loading ? (
          <p className="text-sm text-ink-muted">
            {items.length === 0 ? "No history yet." : "No prompts match your search."}
          </p>
        ) : initialLoadDone ? (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
            {filteredItems.map((item) => {
              const thumbnail = thumbnailPath(item);
              const isRegenerating = regeneratingSessionIds.has(item.session_id);

              if (!thumbnail && isLikelyGenerating(item)) {
                // The sessions row commits before previews exist, so zero previews on
                // a recent session means it's still generating, not failed. Square:
                // matches the (square) previews that will land here once ready.
                return (
                  <div key={item.session_id} className="flex flex-col gap-2 text-left">
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-app-surface text-ink-muted">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="animate-spin text-accent"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      <span className="text-xs">Generating…</span>
                    </div>
                    <SessionMeta item={item} />
                  </div>
                );
              }

              if (!thumbnail) {
                // Session where every preview failed: there's no image to show in the
                // modal, so the card isn't clickable — show a regenerate button instead.
                const regenerateProvider = getRegenerateProvider(item);

                return (
                  <div key={item.session_id} className="flex flex-col gap-2 text-left">
                    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-app-surface">
                      <div className="flex h-full w-full items-center justify-center text-xs text-red-400">
                        Generation failed
                      </div>
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                        <div className="relative flex items-center">
                          <select
                            value={regenerateProvider}
                            disabled={isRegenerating}
                            title={`Provider: ${PROVIDER_LABEL[regenerateProvider]}`}
                            onChange={(e) =>
                              setRegenerateProviderBySession((prev) => ({
                                ...prev,
                                [item.session_id]: e.target.value as Provider,
                              }))
                            }
                            className="cursor-pointer appearance-none rounded-md border border-app-border bg-[#0a0e12]/75 py-1.5 pl-2.5 pr-6 text-xs text-ink-secondary backdrop-blur-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {(Object.keys(PROVIDER_LABEL) as Provider[]).map((prov) => (
                              <option key={prov} value={prov}>
                                {PROVIDER_LABEL[prov]}
                              </option>
                            ))}
                          </select>
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            className="pointer-events-none absolute right-2 text-ink-muted"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRegenerate(item)}
                          disabled={isRegenerating}
                          className="rounded-md border border-app-border bg-[#0a0e12]/75 px-3.5 py-1.5 text-xs text-ink-secondary backdrop-blur-sm transition hover:bg-app-surfaceAlt disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRegenerating ? "Regenerating…" : "Regenerate"}
                        </button>
                      </div>
                    </div>
                    <SessionMeta item={item} />
                  </div>
                );
              }

              return (
                <button
                  key={item.session_id}
                  type="button"
                  onClick={() => setOpenSessionId(item.session_id)}
                  className="flex flex-col gap-2 text-left"
                >
                  <div className="aspect-square w-full overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resolveImageUrl(thumbnail)}
                      alt={item.original_prompt}
                      className="h-full w-full object-cover transition hover:opacity-80"
                    />
                  </div>
                  <SessionMeta item={item} />
                </button>
              );
            })}
          </div>
        ) : null}

        {initialLoadDone && hasMore && !query && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="self-center rounded-md border border-app-border px-7 py-3 text-sm text-ink-secondary transition hover:bg-app-surfaceAlt disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>

      {openSession && (
        <HistorySessionModal
          session={openSession}
          onClose={() => setOpenSessionId(null)}
          onFinalized={handleFinalized}
        />
      )}
    </div>
  );
}
