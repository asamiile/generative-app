"use client";

import { useEffect, useState } from "react";
import {
  downloadUrl,
  generateFinalize,
  generatePreview,
  getHistory,
  resolveImageUrl,
  type GeneratePreviewResponse,
  type Provider,
} from "@/lib/api";
import { LONG_TIMEOUT_MS } from "@/lib/timeouts";
import { ProgressIndicator } from "@/components/ProgressIndicator";
import { PROVIDER_LABEL, ProviderSelect, useAvailableProviders } from "@/components/ProviderSelect";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Phase = "idle" | "generating-preview" | "preview-ready" | "finalizing" | "done";

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
  const [finalizeProvider, setFinalizeProvider] = useState<Provider>("local");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratePreviewResponse | null>(null);
  const [finalImagePath, setFinalImagePath] = useState<string | null>(null);
  const [finalProvider, setFinalProvider] = useState<Provider | null>(null);

  const isBusy = phase === "generating-preview" || phase === "finalizing";
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
            setFinalizeProvider(match.provider);
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
    setFinalImagePath(null);
    setFinalProvider(null);
    setPhase("generating-preview");
    writePendingGeneration({ prompt, provider, startedAt: Date.now() });
    try {
      const result = await generatePreview(prompt, provider);
      clearPendingGeneration();
      setPreview(result);
      // Finalize defaults to whatever generated the previews, but stays independently
      // selectable -- local CPU-only finalize can be too slow, so it's common to want
      // a different provider for the finalize step specifically.
      setFinalizeProvider(result.provider);
      setPhase("preview-ready");
    } catch (err) {
      clearPendingGeneration();
      setError(err instanceof Error ? err.message : "Failed to generate previews");
      setPhase("idle");
    }
  };

  const handleSelectPreview = async (previewId: number) => {
    if (!preview) return;
    setError(null);
    setPhase("finalizing");
    try {
      const result = await generateFinalize(preview.session_id, previewId, finalizeProvider);
      if (result.status !== "success" || !result.image_path) {
        throw new Error("Failed to generate the 4K image");
      }
      setFinalImagePath(result.image_path);
      setFinalProvider(result.provider);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the 4K image");
      setPhase("preview-ready");
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-ink-primary">Choose a preview</h2>
              <Badge>{PROVIDER_LABEL[preview.provider]}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">4K with</span>
              <ProviderSelect
                value={finalizeProvider}
                onChange={setFinalizeProvider}
                disabled={isBusy}
                options={availableProviders}
                triggerClassName="bg-app-surface px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {preview.previews.map((p) => (
              <button
                key={p.preview_id}
                type="button"
                className="group relative aspect-square overflow-hidden rounded-md border border-app-border disabled:cursor-not-allowed disabled:opacity-40"
                disabled={p.status !== "success" || !p.image_path || isBusy}
                onClick={() => handleSelectPreview(p.preview_id)}
              >
                {p.status === "success" && p.image_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImageUrl(p.image_path)}
                    alt={`Preview candidate ${p.candidate_index + 1}`}
                    className="h-full w-full object-cover transition group-hover:opacity-80"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-red-400">
                    Generation failed
                  </div>
                )}
              </button>
            ))}
          </div>
          {phase === "finalizing" && (
            <ProgressIndicator label="Finishing in 4K — this can take a minute" />
          )}
        </section>
      )}

      {finalImagePath && (
        <section className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-ink-primary">Rendered Image</h2>
              {finalProvider && <Badge>{PROVIDER_LABEL[finalProvider]}</Badge>}
            </div>
            <a href={downloadUrl(finalImagePath)} className={buttonVariants({ variant: "outline", className: "px-4 py-2" })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </a>
          </div>
          <div className="aspect-video w-full overflow-hidden rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveImageUrl(finalImagePath)}
              alt="Final 4K image"
              className="h-full w-full object-cover"
            />
          </div>
        </section>
      )}
    </div>
  );
}
