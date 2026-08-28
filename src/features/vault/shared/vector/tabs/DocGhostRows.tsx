/**
 * Calm, geometry-matched placeholder for the KB document list while the first
 * fetch is in flight.
 *
 * Both cold-load surfaces in this feature used to paint a hand-rolled
 * `animate-spin` ring, which this repo bans for a *surface* loading its data
 * (`docs/design/overview-loading.md` §C — a spinner belongs on an action
 * control, never on a region fetching itself). Bars are the calm
 * `bg-primary/[0.06]` treatment with NO pulse, each row fades in behind a
 * 120ms delay so a warm load never flashes a ghost at all.
 */
interface DocGhostRowsProps {
  /** Placeholder rows. Default 4 — enough to read as a list, short enough to stay calm. */
  rows?: number;
  /** Also ghost the toolbar band, for surfaces whose real toolbar has not mounted yet. */
  header?: boolean;
}

const BAR = 'bg-primary/[0.06]';
// Deterministic width variation so it reads as document titles, not a barcode.
const TITLE_WIDTHS = ['w-48', 'w-36', 'w-56', 'w-40'];

export function DocGhostRows({ rows = 4, header = false }: DocGhostRowsProps) {
  return (
    <div aria-hidden="true">
      {header && (
        <div
          className="flex items-center gap-2 px-6 py-3 border-b border-primary/10 animate-fade-in"
          style={{ animationDelay: '120ms' }}
        >
          <span className={`h-3.5 w-28 rounded-card ${BAR}`} />
        </div>
      )}
      <div className="p-4 space-y-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 rounded-modal animate-fade-in"
            style={{ animationDelay: `${120 + i * 35}ms` }}
          >
            <span className={`w-8 h-8 rounded-card shrink-0 ${BAR}`} />
            <div className="flex-1 min-w-0 space-y-1.5">
              <span className={`block h-3.5 rounded-card ${TITLE_WIDTHS[i % TITLE_WIDTHS.length]} ${BAR}`} />
              <span className={`block h-2.5 w-32 rounded-card ${BAR}`} />
            </div>
            <span className={`h-5 w-16 rounded-card shrink-0 ${BAR}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
