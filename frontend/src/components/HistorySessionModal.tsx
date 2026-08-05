"use client";

import { useState } from "react";
import {
  downloadUrl,
  generateFinalize,
  resolveImageUrl,
  type HistorySessionItem,
} from "@/lib/api";
import { ProgressIndicator } from "@/components/ProgressIndicator";

type Props = {
  session: HistorySessionItem;
  onClose: () => void;
  onFinalized: (sessionId: number, imagePath: string, previewId: number) => void;
};

export function HistorySessionModal({ session, onClose, onFinalized }: Props) {
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFinalized = session.final_status === "success" && !!session.final_image_path;

  const handleSelectPreview = async (previewId: number) => {
    setError(null);
    setFinalizing(true);
    try {
      const result = await generateFinalize(session.session_id, previewId);
      if (result.status !== "success" || !result.image_path) {
        throw new Error("Failed to generate the 4K image");
      }
      onFinalized(session.session_id, result.image_path, previewId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the 4K image");
      setFinalizing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-neutral-300">{session.original_prompt}</p>
            <p className="text-xs text-neutral-500">
              {new Date(session.created_at).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 transition hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-200">
            {isFinalized ? "Previews" : "Pick a preview to generate the 4K image"}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {session.previews.map((p) => {
              const isSelected = isFinalized && session.selected_preview_id === p.preview_id;
              const image =
                p.status === "success" && p.image_path ? (
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
                );

              if (isFinalized) {
                return (
                  <div
                    key={p.preview_id}
                    className="relative aspect-square overflow-hidden rounded-md border border-neutral-700"
                  >
                    {image}
                    {isSelected && (
                      <a
                        href={downloadUrl(session.final_image_path!)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute bottom-2 right-2 rounded-md border border-neutral-600 bg-neutral-900/90 px-2 py-1 text-xs text-neutral-200 transition hover:bg-neutral-800"
                      >
                        Download 4K
                      </a>
                    )}
                  </div>
                );
              }

              return (
                <button
                  key={p.preview_id}
                  type="button"
                  className="group relative aspect-square overflow-hidden rounded-md border border-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={p.status !== "success" || !p.image_path || finalizing}
                  onClick={() => handleSelectPreview(p.preview_id)}
                >
                  {image}
                </button>
              );
            })}
          </div>
          {!isFinalized && finalizing && (
            <ProgressIndicator label="Generating the 4K image. This can take a minute…" />
          )}
          {!isFinalized && error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
