// Shared card frame for the Cockpit view-mode three-card layout. All
// three cards use a uniform 220 px height so the row aligns cleanly
// regardless of content length. Overflow is hidden so content can't
// spill past the card edge during HMR / transitions.

export function Panel({
  ariaLabel,
  children,
  // `square` kept for back-compat with earlier iterations; all cards are
  // now the same explicit height so the prop is a no-op.
  square: _square,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  square?: boolean;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="relative flex flex-col rounded-card ring-1 ring-border/70 bg-background/80 shadow-elevation-1 p-4 h-[220px] overflow-hidden"
    >
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}
