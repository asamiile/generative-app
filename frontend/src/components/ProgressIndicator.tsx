// Placeholder progress UI. Will be redesigned in a later design pass.
export function ProgressIndicator({ label }: { label: string }) {
  return (
    <div className="space-y-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full w-1/3 rounded-full bg-indigo-500 animate-[indeterminate_1.2s_ease-in-out_infinite]" />
      </div>
      <p className="text-sm text-neutral-400">{label}</p>
    </div>
  );
}
