"use client";

import { useEffect, useState } from "react";
import {
  generateFinalize,
  generatePreview,
  getHistory,
  retryPreview,
  type GeneratePreviewResponse,
  type PreviewImage,
  type Provider,
} from "@/lib/api";
import { LONG_TIMEOUT_MS } from "@/lib/timeouts";
import { ProgressIndicator } from "@/components/ProgressIndicator";
import { PreviewTile } from "@/components/PreviewTile";
import { ProviderSelect, useAvailableProviders } from "@/components/ProviderSelect";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Phase = "idle" | "generating-preview" | "preview-ready" | "done";

// Navigating away mid-generation (e.g. to History) and back used to lose all memory
// of it -- the form looked idle again, so it was easy to accidentally kick off a
// second generation while the first was still running. This records enough to
// resume: on mount, if a recent-enough marker is here, show "generating" and poll
// history for it instead of the empty form.
const RESUME_STORAGE_KEY = "generative-app:pending-generation";
const RESUME_MAX_AGE_MS = LONG_TIMEOUT_MS;
const POLL_INTERVAL_MS = 5000;

type PendingGeneration = { prompt: string; provider: Provider; startedAt: number };

function readPendingGeneration(): PendingGeneration | null {
  try {
    const raw = sessionStorage.getItem(RESUME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.prompt === "string" &&
      typeof parsed.provider === "string" &&
      typeof parsed.startedAt === "number"
    ) {
      return parsed as PendingGeneration;
    }
    return null;
  } catch {
    return null;
  }
}

function writePendingGeneration(pending: PendingGeneration) {
  try {
    sessionStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Storage can be unavailable (e.g. private browsing) -- resume-on-navigate is a
    // nicety, not required for generation itself to work.
  }
}

function clearPendingGeneration() {
  try {
    sessionStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    // See writePendingGeneration.
  }
}

export function GeneratorApp() {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<Provider>("local");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratePreviewResponse | null>(null);
  // Which preview tile (if any) currently has a finalize/retry in flight, and
  // which action -- each tile's own provider choice is tracked separately from
  // the OTHER tiles', since individual retry means they can diverge (see
  // PreviewTile / .agents/docs/screens/generate.md).
  const [finalizingPreviewId, setFinalizingPreviewId] = useState<number | null>(null);
  const [retryingPreviewId, setRetryingPreviewId] = useState<number | null>(null);
  const [finalizeProviderByPreview, setFinalizeProviderByPreview] = useState<
    Record<number, Provider>
  >({});
  const [retryProviderByPreview, setRetryProviderByPreview] = useState<Record<number, Provider>>(
    {},
  );

  const isBusy = phase === "generating-preview";
  const anyPreviewActionBusy = finalizingPreviewId !== null || retryingPreviewId !== null;
  const availableProviders = useAvailableProviders();

  // Runs once on mount: if we're landing here with a pending generation recorded
  // (started before navigating away, not yet resolved), resume into the
  // "generating" state and poll history for it instead of showing the empty form.
  useEffect(() => {
    const pending = readPendingGeneration();
    if (!pending) return;
    if (Date.now() - pending.startedAt > RESUME_MAX_AGE_MS) {
      clearPendingGeneration();
      return;
    }

    let cancelled = false;
    setPrompt(pending.prompt);
    setProvider(pending.provider);
    setPhase("generating-preview");

    const poll = async () => {
      if (cancelled) return;
      try {
        // Matched by prompt/provider/timing rather than session_id: the session_id
        // is only known once generatePreview's response arrives, which this tab
        // never saw if it navigated away before that (the original request may
        // still complete in the background, but its response lands on the
        // unmounted component instance and is a no-op there).
        const recent = await getHistory(5, 0, "newest");
        const match = recent.find(
          (item) =>
            item.original_prompt === pending.prompt &&
            item.provider === pending.provider &&
            new Date(item.created_at).getTime() >= pending.startedAt - 15_000 &&
            item.previews.length > 0,
        );
        if (match) {
          clearPendingGeneration();
          if (!cancelled) {
            setPreview({
              session_id: match.session_id,
              enhanced_prompt: match.enhanced_prompt,
              provider: match.provider,
              previews: match.previews,
            });
            setPhase("preview-ready");
          }
          return;
        }
      } catch {
        // Transient error while polling -- just try again next tick.
      }
      if (Date.now() - pending.startedAt > RESUME_MAX_AGE_MS) {
        clearPendingGeneration();
        if (!cancelled) setPhase("idle");
        return;
      }
      if (!cancelled) setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleGeneratePreview = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setPreview(null);
    setFinalizeProviderByPreview({});
    setRetryProviderByPreview({});
    setPhase("generating-preview");
    writePendingGeneration({ prompt, provider, startedAt: Date.now() });
    try {
      const result = await generatePreview(prompt, provider);
      clearPendingGeneration();
      setPreview(result);
      setPhase("preview-ready");
    } catch (err) {
      clearPendingGeneration();
      setError(err instanceof Error ? err.message : "Failed to generate previews");
      setPhase("idle");
    }
  };

  const previewById = (previewId: number): PreviewImage | undefined =>
    preview?.previews.find((p) => p.preview_id === previewId);

  // Falls back to the preview's OWN provider, not the session's -- see
  // .agents/docs/api.md's note on POST /api/generate/finalize's default.
  const getFinalizeProvider = (previewId: number): Provider =>
    finalizeProviderByPreview[previewId] ?? previewById(previewId)?.provider ?? provider;
  const getRetryProvider = (previewId: number): Provider =>
    retryProviderByPreview[previewId] ?? previewById(previewId)?.provider ?? provider;

  const updatePreview = (previewId: number, updated: PreviewImage) => {
    setPreview((prev) =>
      prev
        ? { ...prev, previews: prev.previews.map((p) => (p.preview_id === previewId ? updated : p)) }
        : prev,
    );
  };

  const handleFinalize = async (previewId: number) => {
    if (!preview) return;
    setError(null);
    setFinalizingPreviewId(previewId);
    try {
      const result = await generateFinalize(
        preview.session_id,
        previewId,
        getFinalizeProvider(previewId),
      );
      if (result.status !== "success" || !result.image_path) {
        throw new Error("Failed to generate the 4K image");
      }
      const current = previewById(previewId);
      if (current) {
        updatePreview(previewId, {
          ...current,
          final_image_path: result.image_path,
          final_status: "success",
          final_provider: result.provider,
          finalized_at: new Date().toISOString(),
        });
      }
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the 4K image");
    } finally {
      setFinalizingPreviewId(null);
    }
  };

  const handleRetry = async (previewId: number) => {
    if (!preview) return;
    setError(null);
    setRetryingPreviewId(previewId);
    try {
      const updated = await retryPreview(preview.session_id, previewId, getRetryProvider(previewId));
      updatePreview(previewId, updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry the preview");
    } finally {
      setRetryingPreviewId(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-11 px-6 py-12">
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink-primary">
        Image Generator
      </h1>

      <section className="flex flex-col gap-5">
        <div className="rounded-md border border-app-border bg-app-surface px-5 py-4">
          <Textarea
            rows={3}
            maxLength={200}
            placeholder="e.g. Tokyo at night, a crosswalk just after the rain"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isBusy}
          />
        </div>
        <div className="flex items-center gap-4">
          <Button variant="accent" onClick={handleGeneratePreview} disabled={isBusy || !prompt.trim()}>
            {phase === "generating-preview" ? "Generating previews…" : "Generate previews"}
          </Button>
          <div className="flex items-center gap-2 rounded-md border border-app-border bg-app-surface py-0 pl-3.5 pr-1">
            <span className="font-mono text-xs text-ink-muted">Model</span>
            <ProviderSelect
              value={provider}
              onChange={setProvider}
              disabled={isBusy}
              options={availableProviders}
              triggerClassName="border-none py-2.5 pl-1 pr-1"
            />
          </div>
        </div>
        {phase === "generating-preview" && <ProgressIndicator label="Generating 4 previews" />}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {preview && (
        <section className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold text-ink-primary">Choose a preview</h2>
          <div className="grid grid-cols-2 gap-4">
            {preview.previews.map((p) => (
              <PreviewTile
                key={p.preview_id}
                preview={p}
                availableProviders={availableProviders}
                aspectClassName="aspect-[16/9]"
                finalizeProvider={getFinalizeProvider(p.preview_id)}
                onFinalizeProviderChange={(prov) =>
                  setFinalizeProviderByPreview((prev) => ({ ...prev, [p.preview_id]: prov }))
                }
                onFinalize={() => handleFinalize(p.preview_id)}
                isFinalizing={finalizingPreviewId === p.preview_id}
                retryProvider={getRetryProvider(p.preview_id)}
                onRetryProviderChange={(prov) =>
                  setRetryProviderByPreview((prev) => ({ ...prev, [p.preview_id]: prov }))
                }
                onRetry={() => handleRetry(p.preview_id)}
                isRetrying={retryingPreviewId === p.preview_id}
                disabled={
                  anyPreviewActionBusy &&
                  finalizingPreviewId !== p.preview_id &&
                  retryingPreviewId !== p.preview_id
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
