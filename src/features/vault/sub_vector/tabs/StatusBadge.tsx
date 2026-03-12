interface StatusBadgeProps {
  status: string;
  error: string | null;
}

export function StatusBadge({ status, error: errorMsg }: StatusBadgeProps) {
  if (status === 'indexed') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/15">
        indexed
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-lg bg-red-500/10 text-red-400/80 border border-red-500/15" title={errorMsg || undefined}>
        error
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-400/80 border border-amber-500/15">
      {status}
    </span>
  );
}
