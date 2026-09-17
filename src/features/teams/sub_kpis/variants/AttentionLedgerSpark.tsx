// The ledger's sparkline — 96×24, one FIXED y-domain (-15…115 % of target)
// for every series on the surface, so two sparklines in different sections are
// read against the same axis. Fewer than 3 points draws dots and no line (a
// two-point line invents a trend); an empty series draws nothing at all.
import { sparkPoints, sparkPolyline } from './AttentionLedger.model';

const GHOST_BAR = 'rounded bg-primary/[0.06]';

export function LedgerSpark({
  values,
  color,
  ghost,
}: {
  values: number[];
  color: string;
  /** Measurements are still in flight: hold the slot, never hide the row. */
  ghost?: boolean;
}) {
  if (ghost) {
    return (
      <span
        className={`inline-block h-6 w-24 flex-shrink-0 ${GHOST_BAR} animate-fade-in`}
        style={{ animationDelay: '150ms' }}
        aria-hidden="true"
      />
    );
  }
  if (values.length === 0) return null;
  const pts = sparkPoints(values);
  return (
    <svg width={96} height={24} viewBox="0 0 96 24" className="flex-shrink-0" aria-hidden="true">
      {values.length < 3 ? (
        pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2} fill={color} />)
      ) : (
        <polyline
          points={sparkPolyline(values)}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
