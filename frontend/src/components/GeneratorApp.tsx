"use client";

import { useState } from "react";
import {
  downloadUrl,
  generateFinalize,
  generatePreview,
  resolveImageUrl,
  type GeneratePreviewResponse,
} from "@/lib/api";
import { ProgressIndicator } from "@/components/ProgressIndicator";

type Phase = "idle" | "generating-preview" | "preview-ready" | "finalizing" | "done";

export function GeneratorApp() {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratePreviewResponse | null>(null);
  const [finalImagePath, setFinalImagePath] = useState<string | null>(null);

  const isBusy = phase === "generating-preview" || phase === "finalizing";

  const handleGeneratePreview = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setPreview(null);
    setFinalImagePath(null);
    setPhase("generating-preview");
    try {
      setPreview(await generatePreview(prompt));
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
      const result = await generateFinalize(preview.session_id, previewId);
      if (result.status !== "success" || !result.image_path) {
        throw new Error("Failed to generate the 4K image");
      }
      setFinalImagePath(result.image_path);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the 4K image");
      setPhase("preview-ready");
    }
  };

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-11 px-6 py-12">
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink-primary">
        Photorealistic Image Generator
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
        </div>
        {phase === "generating-preview" && <ProgressIndicator label="Generating 4 previews" />}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {preview && (
        <section className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold text-ink-primary">Choose a preview</h2>
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
            <h2 className="text-lg font-semibold text-ink-primary">Rendered Image</h2>
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
