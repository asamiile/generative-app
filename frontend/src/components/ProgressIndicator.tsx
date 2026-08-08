export function ProgressBar({ className = "" }: { className?: string }) {
  return (
    <div className={`h-0.5 w-full overflow-hidden rounded-full bg-app-surfaceAlt ${className}`}>
      <div className="h-full w-[30%] rounded-full bg-accent animate-[indet_1.2s_ease-in-out_infinite]" />
    </div>
  );
}

export function ProgressIndicator({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="animate-spin text-accent"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
      <ProgressBar />
    </div>
  );
}
