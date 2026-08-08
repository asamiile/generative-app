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

type Phase = "idle" | "generating-preview" | "preview-ready" | "finalizing" | "done";

const PROVIDER_LABEL: Record<Provider, string> = {
  local: "Local",
  gemini: "Gemini",
  openai: "OpenAI",
  stability: "Stability AI",
};

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
          <textarea
            className="w-full resize-none border-none bg-transparent text-base leading-relaxed tracking-tight text-ink-primary outline-none placeholder:text-ink-muted disabled:opacity-50"
            rows={3}
            maxLength={200}
            placeholder="e.g. Tokyo at night, a crosswalk just after the rain"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isBusy}
          />
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-md bg-accent px-6 py-3 text-sm font-semibold tracking-tight text-accent-on transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleGeneratePreview}
            disabled={isBusy || !prompt.trim()}
          >
            {phase === "generating-preview" ? "Generating previews…" : "Generate previews"}
          </button>
          <div className="flex items-center gap-2 rounded-md border border-app-border bg-app-surface py-0 pl-3.5 pr-1">
            <span className="font-mono text-xs text-ink-muted">Model</span>
            <div className="relative flex items-center">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
                disabled={isBusy}
                className="cursor-pointer appearance-none bg-transparent py-2.5 pl-1 pr-6 text-sm text-ink-secondary outline-none disabled:cursor-not-allowed"
              >
                {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABEL[p]}
                  </option>
                ))}
              </select>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="pointer-events-none absolute right-1.5 text-ink-muted"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
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
              <span className="rounded-full border border-app-border px-2 py-0.5 text-xs text-ink-muted">
                {PROVIDER_LABEL[preview.provider]}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">4K with</span>
              <div className="flex items-center gap-1 rounded-md border border-app-border p-1">
                {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`rounded px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      finalizeProvider === p
                        ? "bg-ink-primary text-app-bg"
                        : "text-ink-secondary hover:bg-app-surfaceAlt"
                    }`}
                    onClick={() => setFinalizeProvider(p)}
                    disabled={isBusy}
                  >
                    {PROVIDER_LABEL[p]}
                  </button>
                ))}
              </div>
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
              {finalProvider && (
                <span className="rounded-full border border-app-border px-2 py-0.5 text-xs text-ink-muted">
                  {PROVIDER_LABEL[finalProvider]}
                </span>
              )}
            </div>
            <a
              href={downloadUrl(finalImagePath)}
              className="flex items-center gap-2 rounded-md border border-app-border px-4 py-2 text-sm text-ink-secondary transition hover:bg-app-surfaceAlt"
            >
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
