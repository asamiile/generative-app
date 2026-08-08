"use client";

import { useState } from "react";
import {
  downloadUrl,
  generateFinalize,
  resolveImageUrl,
  type HistorySessionItem,
  type Provider,
} from "@/lib/api";
import { ProgressIndicator } from "@/components/ProgressIndicator";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";

const PROVIDER_LABEL: Record<Provider, string> = {
  local: "Local",
  gemini: "Gemini",
  openai: "OpenAI",
  stability: "Stability AI",
};

type Props = {
  session: HistorySessionItem;
  onClose: () => void;
  onFinalized: (sessionId: number, previewId: number, imagePath: string, provider: Provider) => void;
};

export function HistorySessionModal({ session, onClose, onFinalized }: Props) {
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Finalize provider is selectable per preview, independent of the session's
  // (preview-generating) provider -- local CPU-only finalize can be too slow/
  // unreliable at high resolution, so defaulting to the session's provider but
  // letting it be overridden per image is the point. Chosen via a dropdown (not an
  // always-visible button row) so this scales as more providers are added.
  const [providerByPreview, setProviderByPreview] = useState<Record<number, Provider>>({});

  const getSelectedProvider = (previewId: number): Provider =>
    providerByPreview[previewId] ?? session.provider;

  const handleSelectPreview = async (previewId: number) => {
    setError(null);
    setFinalizing(true);
    try {
      const result = await generateFinalize(
        session.session_id,
        previewId,
        getSelectedProvider(previewId),
      );
      if (result.status !== "success" || !result.image_path) {
        throw new Error("Failed to generate the 4K image");
      }
      onFinalized(session.session_id, previewId, result.image_path, result.provider);
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
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="max-w-[92%] overflow-y-auto sm:max-w-[560px]">
        <SheetHeader className="pr-10">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm text-ink-secondary">{session.original_prompt}</p>
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
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {new Date(session.created_at).toLocaleString()}
            </p>
          </div>
        </SheetHeader>

        {finalizing && <ProgressIndicator label="Finishing in 4K — this can take a minute" />}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium text-ink-secondary">Previews</h3>
          <div className="flex flex-col gap-3.5">
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
                    className="relative aspect-[16/10] overflow-hidden rounded-md border border-app-border"
                  >
                    {image}
                    {p.final_provider && (
                      <span className="absolute top-2.5 left-2.5 rounded-md bg-accent px-2.5 py-0.5 font-mono text-[10px] font-semibold text-accent-on">
                        {PROVIDER_LABEL[p.final_provider]}
                      </span>
                    )}
                    <a
                      href={downloadUrl(p.final_image_path!)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-2.5 right-2.5 rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-on"
                    >
                      Download 4K
                    </a>
                  </div>
                );
              }

              const isSelectable = p.status === "success" && !!p.image_path;
              const selectedProvider = getSelectedProvider(p.preview_id);

              return (
                <div
                  key={p.preview_id}
                  className="group relative aspect-[16/10] overflow-hidden rounded-md border border-app-border"
                >
                  {image}
                  {isSelectable && (
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                      <div className="relative flex items-center">
                        <select
                          value={selectedProvider}
                          disabled={finalizing}
                          title={`Provider: ${PROVIDER_LABEL[selectedProvider]}`}
                          onChange={(e) =>
                            setProviderByPreview((prev) => ({
                              ...prev,
                              [p.preview_id]: e.target.value as Provider,
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
                        className="rounded-md border border-app-border bg-[#0a0e12]/75 px-3.5 py-1.5 text-xs text-ink-secondary backdrop-blur-sm transition hover:bg-app-surfaceAlt disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={finalizing}
                        onClick={() => handleSelectPreview(p.preview_id)}
                      >
                        Generate 4K
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
