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
  onFinalized: (sessionId: number, previewId: number, imagePath: string) => void;
};

export function HistorySessionModal({ session, onClose, onFinalized }: Props) {
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSelectPreview = async (previewId: number) => {
    setError(null);
    setFinalizing(true);
    try {
      const result = await generateFinalize(session.session_id, previewId);
      if (result.status !== "success" || !result.image_path) {
        throw new Error("Failed to generate the 4K image");
      }
      onFinalized(session.session_id, previewId, result.image_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the 4K image");
    } finally {
      setFinalizing(false);
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(session.original_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser; failing silently is fine here.
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05080b]/70 px-8"
      onClick={onClose}
    >
      <div
        className="max-h-[640px] w-full max-w-[700px] overflow-y-auto rounded-lg border border-app-border bg-app-surface p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-base text-ink-secondary">{session.original_prompt}</p>
              <button
                type="button"
                onClick={handleCopyPrompt}
                title={copied ? "Copied" : "Copy prompt"}
                className="flex items-center border-none bg-transparent p-1 text-ink-muted transition hover:text-ink-secondary"
              >
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="14" height="14" x="8" y="8" rx="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {new Date(session.created_at).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-app-border px-3 py-2 text-xs text-ink-muted transition hover:bg-app-surfaceAlt"
          >
            Close
          </button>
        </div>

        {finalizing && (
          <div className="mb-5">
            <ProgressIndicator label="Finishing in 4K — this can take a minute" />
          </div>
        )}
        {error && <p className="mb-5 text-sm text-red-400">{error}</p>}

        <h3 className="mb-4 text-sm font-medium text-ink-secondary">Previews</h3>
        <div className="grid grid-cols-2 gap-5">
          {session.previews.map((p) => {
            // Each preview's finalize result is independent, so judge them one at a
            // time (multiple previews in a session can each be finalized to 4K).
            const isPreviewFinalized = p.final_status === "success" && !!p.final_image_path;
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

            if (isPreviewFinalized) {
              return (
                <div
                  key={p.preview_id}
                  className="relative aspect-square overflow-hidden rounded-md border border-app-border"
                >
                  {image}
                  <a
                    href={downloadUrl(p.final_image_path!)}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-2 right-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-on"
                  >
                    Download 4K
                  </a>
                </div>
              );
            }

            return (
              <button
                key={p.preview_id}
                type="button"
                className="group relative aspect-square overflow-hidden rounded-md border border-app-border disabled:cursor-not-allowed disabled:opacity-40"
                disabled={p.status !== "success" || !p.image_path || finalizing}
                onClick={() => handleSelectPreview(p.preview_id)}
              >
                {image}
                {p.status === "success" && p.image_path && (
                  <span className="absolute top-2 right-2 rounded-md border border-app-border bg-[#0a0e12]/75 px-3 py-2 text-sm text-ink-secondary backdrop-blur-sm">
                    Generate 4K
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
