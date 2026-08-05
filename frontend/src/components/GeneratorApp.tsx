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
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Photorealistic Image Generator</h1>
        <p className="text-sm text-neutral-400">
          Generate photorealistic images from a short prompt. First, four previews are created; pick one to finish it in 4K.
        </p>
      </header>

      <section className="space-y-3">
        <textarea
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          rows={3}
          maxLength={200}
          placeholder="e.g. Tokyo at night, a crosswalk just after the rain"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isBusy}
        />
        <button
          type="button"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleGeneratePreview}
          disabled={isBusy || !prompt.trim()}
        >
          {phase === "generating-preview" ? "Generating previews…" : "Generate previews"}
        </button>
        {phase === "generating-preview" && (
          <ProgressIndicator label="Generating 4 previews…" />
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {preview && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Choose a preview</h2>
          <p className="break-words text-xs text-neutral-500">{preview.enhanced_prompt}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {preview.previews.map((p) => (
              <button
                key={p.preview_id}
                type="button"
                className="group relative aspect-square overflow-hidden rounded-md border border-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
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
            <ProgressIndicator label="Generating the 4K image. This can take a minute…" />
          )}
        </section>
      )}

      {finalImagePath && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Final image (4K)</h2>
            <a
              href={downloadUrl(finalImagePath)}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-800"
            >
              Download
            </a>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolveImageUrl(finalImagePath)}
            alt="Final 4K image"
            className="w-full rounded-md border border-neutral-700"
          />
        </section>
      )}
    </main>
  );
}
