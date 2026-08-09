"use client";

import { useEffect, useState } from "react";
import {
  getHistory,
  resolveImageUrl,
  retryPreview,
  type HistorySessionItem,
  type HistorySort,
  type PreviewImage,
  type Provider,
} from "@/lib/api";
import { HistorySessionModal } from "@/components/HistorySessionModal";
import { PROVIDER_LABEL, ProviderSelect, useAvailableProviders } from "@/components/ProviderSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LONG_TIMEOUT_MS } from "@/lib/timeouts";

const PAGE_SIZE = 20;
// The backend commits the sessions row before generating previews, so a session with
// zero previews is normally still in progress. Cap how long we assume that at the
// same value the fetch itself is allowed to run (lib/backendFetch.ts) -- previously
// hardcoded to 10 minutes here, which was far shorter than the actual timeout and
// caused slow (especially local-provider) generations to show "Generation failed"
// well before they'd actually failed.
const GENERATING_THRESHOLD_MS = LONG_TIMEOUT_MS;

function isLikelyGenerating(session: HistorySessionItem): boolean {
  if (session.previews.length > 0) return false;
  return Date.now() - new Date(session.created_at).getTime() < GENERATING_THRESHOLD_MS;
}

function SessionMeta({ item, provider }: { item: HistorySessionItem; provider: Provider | null }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="truncate text-sm text-ink-secondary">{item.original_prompt}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs text-ink-faint">{new Date(item.created_at).toLocaleString()}</p>
        {provider && <Badge size="sm">{PROVIDER_LABEL[provider]}</Badge>}
      </div>
    </div>
  );
}

type Thumbnail = { url: string; provider: Provider };

// The thumbnail image and its badge always agree on which provider actually made
// them -- individual retry (POST /api/generate/preview/retry) means the 4
// previews in one session can have different providers, so there's no single
// "session provider" to show here anymore, only "whichever provider made THIS
// specific thumbnail".
function pickThumbnail(session: HistorySessionItem): Thumbnail | null {
  // If multiple previews have been finalized to 4K, use the most recently finalized one as the thumbnail.
  // The grid always displays it square (object-cover), matching the design regardless
  // of the underlying image's own aspect ratio.
  const finalized = session.previews.filter((p) => p.final_status === "success" && p.final_image_path);
  if (finalized.length > 0) {
    const latest = finalized.reduce((a, b) => ((b.finalized_at ?? "") > (a.finalized_at ?? "") ? b : a));
    return { url: latest.final_image_path!, provider: latest.final_provider ?? latest.provider };
  }
  const preview = session.previews.find((p) => p.status === "success" && p.image_path);
  return preview ? { url: preview.image_path!, provider: preview.provider } : null;
}

export function HistoryGallery() {
  const availableProviders = useAvailableProviders();
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

  // Debounced so typing doesn't fire a request (and a full history re-fetch) per
  // keystroke -- the search itself runs server-side (see below), unlike the
  // previous client-side filter over whatever page happened to be loaded already.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // (Re)load from the first page whenever the sort order or search query changes
  // (including on mount). Guarded against React Strict Mode's dev-only double
  // effect invocation, which would otherwise fetch and append the first page
  // twice (visible as duplicate images and duplicate-key warnings).
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    getHistory(PAGE_SIZE, 0, sort, debouncedQuery)
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
  }, [sort, debouncedQuery]);

  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getHistory(PAGE_SIZE, offset, sort, debouncedQuery);
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
    const chosenProvider = getRegenerateProvider(item);
    // Overwrites this session's existing 4 preview_images rows in place (same
    // endpoint individual "Retry" uses, called once per candidate) rather than
    // creating a brand-new session -- there's no use for this app in keeping a
    // fully-failed session sitting in history once it's been regenerated, same
    // reasoning as individual retry overwriting instead of appending. Reuses the
    // session's existing enhanced_prompt rather than re-expanding it, matching
    // individual retry's behavior.
    const results = await Promise.allSettled(
      item.previews.map((p) => retryPreview(item.session_id, p.preview_id, chosenProvider)),
    );
    const failureCount = results.filter((r) => r.status === "rejected").length;
    if (failureCount > 0) {
      // Some candidates may still have succeeded -- don't discard those (see
      // setItems below), just surface that not all 4 made it.
      setError(`Failed to regenerate ${failureCount} of ${results.length} previews`);
    }
    setItems((prev) =>
      prev.map((it) => {
        if (it.session_id !== item.session_id) return it;
        return {
          ...it,
          previews: it.previews.map((p, i) => {
            const result = results[i];
            return result.status === "fulfilled" ? result.value : p;
          }),
        };
      }),
    );
    setRegeneratingSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(item.session_id);
      return next;
    });
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

  const handleRetried = (sessionId: number, previewId: number, updated: PreviewImage) => {
    setItems((prev) =>
      prev.map((item) =>
        item.session_id === sessionId
          ? {
              ...item,
              previews: item.previews.map((p) => (p.preview_id === previewId ? updated : p)),
            }
          : item,
      ),
    );
    // Don't close the modal: matches handleFinalized -- lets the user keep working
    // on other previews in the same session.
  };

  const openSession = items.find((item) => item.session_id === openSessionId) ?? null;

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
            <Input placeholder="Search prompts" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" onClick={toggleSort} className="gap-1 px-3 py-2">
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
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sort === "newest" ? "Sorted newest first" : "Sorted oldest first"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {initialLoadDone && items.length === 0 && !loading ? (
          <p className="text-sm text-ink-muted">
            {debouncedQuery ? "No prompts match your search." : "No history yet."}
          </p>
        ) : initialLoadDone ? (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
            {items.map((item) => {
              const thumbnail = pickThumbnail(item);
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
                    <SessionMeta item={item} provider={null} />
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
                        <ProviderSelect
                          value={regenerateProvider}
                          disabled={isRegenerating}
                          title={`Provider: ${PROVIDER_LABEL[regenerateProvider]}`}
                          options={availableProviders}
                          onChange={(prov) =>
                            setRegenerateProviderBySession((prev) => ({
                              ...prev,
                              [item.session_id]: prov,
                            }))
                          }
                          triggerClassName="bg-[#0a0e12]/75 px-2.5 py-1.5 text-xs backdrop-blur-sm"
                        />
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => handleRegenerate(item)}
                          disabled={isRegenerating}
                        >
                          {isRegenerating ? "Regenerating…" : "Regenerate"}
                        </Button>
                      </div>
                    </div>
                    <SessionMeta item={item} provider={null} />
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
                      src={resolveImageUrl(thumbnail.url)}
                      alt={item.original_prompt}
                      className="h-full w-full object-cover transition hover:opacity-80"
                    />
                  </div>
                  <SessionMeta item={item} provider={thumbnail.provider} />
                </button>
              );
            })}
          </div>
        ) : null}

        {initialLoadDone && hasMore && (
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={loading}
            className="self-center px-7 py-3"
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>

      {openSession && (
        <HistorySessionModal
          session={openSession}
          onClose={() => setOpenSessionId(null)}
          onFinalized={handleFinalized}
          onRetried={handleRetried}
          availableProviders={availableProviders}
        />
      )}
    </div>
  );
}
