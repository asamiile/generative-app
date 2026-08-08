"use client";

import { useState } from "react";
import {
  downloadUrl,
  generateFinalize,
  generatePreview,
  resolveImageUrl,
  type GeneratePreviewResponse,
  type Provider,
} from "@/lib/api";
import { ProgressIndicator } from "@/components/ProgressIndicator";
import { PROVIDER_LABEL, ProviderSelect } from "@/components/ProviderSelect";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Phase = "idle" | "generating-preview" | "preview-ready" | "finalizing" | "done";

export function GeneratorApp() {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<Provider>("gemini");
  const [finalizeProvider, setFinalizeProvider] = useState<Provider>("gemini");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratePreviewResponse | null>(null);
  const [finalImagePath, setFinalImagePath] = useState<string | null>(null);
  const [finalProvider, setFinalProvider] = useState<Provider | null>(null);

  const isBusy = phase === "generating-preview" || phase === "finalizing";

  const handleGeneratePreview = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setPreview(null);
    setFinalImagePath(null);
    setFinalProvider(null);
    setPhase("generating-preview");
    try {
      const result = await generatePreview(prompt, provider);
      setPreview(result);
      // Finalize defaults to whatever generated the previews, but stays independently
      // selectable -- local CPU-only finalize can be too slow, so it's common to want
      // a different provider for the finalize step specifically.
      setFinalizeProvider(result.provider);
      setPhase("preview-ready");
    } catch (err) {
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
