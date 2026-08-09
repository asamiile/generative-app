"use client";

import { downloadUrl, resolveImageUrl, type PreviewImage, type Provider } from "@/lib/api";
import { ProgressBar } from "@/components/ProgressIndicator";
import { PROVIDER_LABEL, ProviderSelect } from "@/components/ProviderSelect";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";

type Props = {
  preview: PreviewImage;
  availableProviders: Provider[];
  aspectClassName?: string;
  finalizeProvider: Provider;
  onFinalizeProviderChange: (provider: Provider) => void;
  onFinalize: () => void;
  isFinalizing: boolean;
  retryProvider: Provider;
  onRetryProviderChange: (provider: Provider) => void;
  onRetry: () => void;
  isRetrying: boolean;
  // Something else (another tile's action, or the page-level prompt submission)
  // is in flight -- don't let this tile start something new on top of it.
  disabled?: boolean;
};

// Every tile shows exactly one badge: whichever provider actually made the image
// currently shown -- the finalize (4K) provider once finalized, otherwise this
// preview's own generating provider. Individual retry (POST
// /api/generate/preview/retry) means these can genuinely differ per tile within
// one session, so there's no single session-wide provider badge anymore (see
// .agents/docs/screens/generate.md and screens/history.md).
export function PreviewTile({
  preview: p,
  availableProviders,
  aspectClassName = "aspect-square",
  finalizeProvider,
  onFinalizeProviderChange,
  onFinalize,
  isFinalizing,
  retryProvider,
  onRetryProviderChange,
  onRetry,
  isRetrying,
  disabled = false,
}: Props) {
  const isFinalized = p.final_status === "success" && !!p.final_image_path;
  const isFailed = p.status !== "success" || !p.image_path;
  const busy = isFinalizing || isRetrying || disabled;
  const tileClassName = `relative ${aspectClassName} overflow-hidden rounded-md border border-app-border`;

  if (isFinalized) {
    return (
      <div className={tileClassName}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolveImageUrl(p.final_image_path!)}
          alt={`Preview candidate ${p.candidate_index + 1} (4K)`}
          className="h-full w-full object-cover"
        />
        {p.final_provider && (
          <Badge variant="accent" size="sm" className="absolute top-2.5 left-2.5">
            {PROVIDER_LABEL[p.final_provider]}
          </Badge>
        )}
        <a
          href={downloadUrl(p.final_image_path!)}
          onClick={(e) => e.stopPropagation()}
          className={buttonVariants({
            variant: "accent",
            size: "sm",
            className: "absolute top-2.5 right-2.5",
          })}
        >
          Download 4K
        </a>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className={tileClassName}>
        <div className="flex h-full w-full items-center justify-center text-xs text-red-400">
          Generation failed
        </div>
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          <ProviderSelect
            value={retryProvider}
            disabled={busy}
            title={`Provider: ${PROVIDER_LABEL[retryProvider]}`}
            options={availableProviders}
            onChange={onRetryProviderChange}
            triggerClassName="bg-[#0a0e12]/75 px-2.5 py-1.5 text-xs backdrop-blur-sm"
          />
          <Button variant="subtle" size="sm" disabled={busy} onClick={onRetry}>
            {isRetrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
        {isRetrying && (
          <div className="absolute inset-x-0 top-0">
            <ProgressBar className="h-1 rounded-none" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`group ${tileClassName}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolveImageUrl(p.image_path!)}
        alt={`Preview candidate ${p.candidate_index + 1}`}
        className="h-full w-full object-cover transition group-hover:opacity-80"
      />
      <Badge size="sm" className="absolute top-2.5 left-2.5">
        {PROVIDER_LABEL[p.provider]}
      </Badge>
      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
        <ProviderSelect
          value={finalizeProvider}
          disabled={busy}
          title={`Provider: ${PROVIDER_LABEL[finalizeProvider]}`}
          options={availableProviders}
          onChange={onFinalizeProviderChange}
          triggerClassName="bg-[#0a0e12]/75 px-2.5 py-1.5 text-xs backdrop-blur-sm"
        />
        <Button variant="subtle" size="sm" disabled={busy} onClick={onFinalize}>
          Generate 4K
        </Button>
      </div>
      {isFinalizing && (
        <div className="absolute inset-x-0 top-0">
          <ProgressBar className="h-1 rounded-none" />
        </div>
      )}
    </div>
  );
}
