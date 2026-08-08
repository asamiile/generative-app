"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Provider } from "@/lib/api";

export const PROVIDER_LABEL: Record<Provider, string> = {
  local: "Local",
  gemini: "Gemini",
  openai: "OpenAI",
  stability: "Stability AI",
};

export function ProviderSelect({
  value,
  onChange,
  disabled,
  title,
  triggerClassName,
}: {
  value: Provider;
  onChange: (p: Provider) => void;
  disabled?: boolean;
  title?: string;
  triggerClassName?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Provider)} disabled={disabled}>
      <SelectTrigger className={triggerClassName} title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
          <SelectItem key={p} value={p}>
            {PROVIDER_LABEL[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
