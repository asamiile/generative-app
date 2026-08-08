"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAvailableProviders, type Provider } from "@/lib/api";

export const PROVIDER_LABEL: Record<Provider, string> = {
  local: "Local",
  gemini: "Gemini",
  openai: "OpenAI",
  stability: "Stability AI",
};

const ALL_PROVIDERS = Object.keys(PROVIDER_LABEL) as Provider[];

// Call once per page (not once per ProviderSelect) and pass the result down as
// `options` -- every select on a page wants the same answer. Falls back to
// showing all 4 until the fetch resolves, and stays there if it fails: better to
// let a request fail on submit than to hide every option over a network hiccup.
export function useAvailableProviders(): Provider[] {
  const [available, setAvailable] = useState<Provider[]>(ALL_PROVIDERS);
  useEffect(() => {
    let cancelled = false;
    getAvailableProviders()
      .then((providers) => {
        if (!cancelled && providers.length > 0) setAvailable(providers);
      })
      .catch(() => {
        // See comment above -- keep the all-providers fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

export function ProviderSelect({
  value,
  onChange,
  disabled,
  title,
  triggerClassName,
  options = ALL_PROVIDERS,
}: {
  value: Provider;
  onChange: (p: Provider) => void;
  disabled?: boolean;
  title?: string;
  triggerClassName?: string;
  options?: Provider[];
}) {
  // Always include the current value even if it's not in `options` -- e.g. a
  // past session used a provider whose API key has since been removed from
  // backend/.env. Dropping it here would leave the trigger with nothing to
  // display.
  const items = options.includes(value) ? options : [value, ...options];

  return (
    <Select value={value} onValueChange={(v) => onChange(v as Provider)} disabled={disabled}>
      <SelectTrigger className={triggerClassName} title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((p) => (
          <SelectItem key={p} value={p}>
            {PROVIDER_LABEL[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
