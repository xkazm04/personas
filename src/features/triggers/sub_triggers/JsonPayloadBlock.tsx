/**
 * Shared JSON payload display block used by trigger inspectors (webhook
 * request logs, persona execution history). Pretty-prints JSON when
 * possible, falls back to the raw string otherwise, and renders nothing
 * when there is no data.
 */
export function JsonPayloadBlock({
  label,
  data,
  labelClassName = 'typo-label',
}: {
  label: string;
  data: string | null;
  /** Typography class applied to the label above the block (defaults to typo-label). */
  labelClassName?: string;
}) {
  if (!data) return null;

  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    formatted = data;
  }

  return (
    <div className="space-y-1">
      <div className={`${labelClassName} font-medium text-foreground uppercase tracking-wide`}>{label}</div>
      <pre className="px-2.5 py-2 rounded-card bg-background/40 border border-primary/5 typo-code font-mono text-foreground overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
        {formatted}
      </pre>
    </div>
  );
}
