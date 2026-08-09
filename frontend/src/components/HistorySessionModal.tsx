"use client";

import { useState } from "react";
import {
  generateFinalize,
  retryPreview,
  type HistorySessionItem,
  type PreviewImage,
  type Provider,
} from "@/lib/api";
import { PreviewTile } from "@/components/PreviewTile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  session: HistorySessionItem;
  onClose: () => void;
  onFinalized: (sessionId: number, previewId: number, imagePath: string, provider: Provider) => void;
  onRetried: (sessionId: number, previewId: number, updated: PreviewImage) => void;
  availableProviders: Provider[];
};

export function HistorySessionModal({
  session,
  onClose,
  onFinalized,
  onRetried,
  availableProviders,
}: Props) {
  const [finalizingPreviewId, setFinalizingPreviewId] = useState<number | null>(null);
  const [retryingPreviewId, setRetryingPreviewId] = useState<number | null>(null);
  const busy = finalizingPreviewId !== null || retryingPreviewId !== null;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Finalize provider is selectable per preview, independent of that preview's
  // own (generating) provider -- local CPU-only finalize can be too slow/
  // unreliable at high resolution, so defaulting to the preview's provider but
  // letting it be overridden is the point. Chosen via a dropdown (not an
  // always-visible button row) so this scales as more providers are added.
  const [finalizeProviderByPreview, setFinalizeProviderByPreview] = useState<
    Record<number, Provider>
  >({});
  const [retryProviderByPreview, setRetryProviderByPreview] = useState<Record<number, Provider>>(
    {},
  );

  const previewById = (previewId: number) =>
    session.previews.find((p) => p.preview_id === previewId);

  // Falls back to the preview's OWN provider, not the session's -- individual
  // retry can give a preview a different provider than the rest of the session,
  // and the default here should follow whatever actually made this specific
  // image, not the session's original (possibly stale) provider.
  const getFinalizeProvider = (previewId: number): Provider =>
    finalizeProviderByPreview[previewId] ?? previewById(previewId)?.provider ?? session.provider;
  const getRetryProvider = (previewId: number): Provider =>
    retryProviderByPreview[previewId] ?? previewById(previewId)?.provider ?? session.provider;

  const handleFinalize = async (previewId: number) => {
    setError(null);
    setFinalizingPreviewId(previewId);
    try {
      const result = await generateFinalize(
        session.session_id,
        previewId,
        getFinalizeProvider(previewId),
      );
      if (result.status !== "success" || !result.image_path) {
        throw new Error("Failed to generate the 4K image");
      }
      onFinalized(session.session_id, previewId, result.image_path, result.provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the 4K image");
    } finally {
      setFinalizingPreviewId(null);
    }
  };

  const handleRetry = async (previewId: number) => {
    setError(null);
    setRetryingPreviewId(previewId);
    try {
      const updated = await retryPreview(session.session_id, previewId, getRetryProvider(previewId));
      onRetried(session.session_id, previewId, updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry the preview");
    } finally {
      setRetryingPreviewId(null);
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
              <Tooltip open={copied || undefined}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleCopyPrompt} className="h-6 w-6">
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
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copied ? "Copied" : "Copy prompt"}</TooltipContent>
              </Tooltip>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {new Date(session.created_at).toLocaleString()}
            </p>
          </div>
        </SheetHeader>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium text-ink-secondary">Previews</h3>
          <div className="flex flex-col gap-3.5">
            {session.previews.map((p) => (
              <PreviewTile
                key={p.preview_id}
                preview={p}
                availableProviders={availableProviders}
                aspectClassName="aspect-[16/10]"
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
                disabled={busy && finalizingPreviewId !== p.preview_id && retryingPreviewId !== p.preview_id}
              />
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
