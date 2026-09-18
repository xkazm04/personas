// The two marks every grid card carries: the share-of-total stacked bar and
// the coverage sparkline. Both are drawn on a FIXED domain (share of total,
// and 0–1 coverage over one shared 30-day window) so the small multiples are
// comparable at a glance — which is the only reason to draw them small.
import { HATCH_BG } from '../kpiChartTheme';
import { TRACK_COLOR } from '../kpiMeta';
import { coverageArea, coverageLine, coveragePoints, type StackKey, type StackSegment } from './ProjectGrid.model';

/** Fill per stack segment. `unmeasured` is hatched — never a colored fill;
 *  `unpaced` is measured with no verdict, so it gets the muted tone at 40 %. */
const SEGMENT_STYLE: Record<StackKey, { background: string }> = {
  met: { background: TRACK_COLOR.met },
  onTrack: { background: TRACK_COLOR['on-track'] },
  offTrack: { background: TRACK_COLOR['off-track'] },
  unpaced: { background: 'color-mix(in srgb, var(--muted-foreground) 40%, transparent)' },
  unmeasured: { background: HATCH_BG },
};

export function GridStackBar({ segments, ariaLabel }: { segments: StackSegment[]; ariaLabel: string }) {
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-pill bg-secondary/40"
      role="img"
      aria-label={ariaLabel}
    >
      {segments.map((s) => (
        <span key={s.key} style={{ width: `${s.pct}%`, ...SEGMENT_STYLE[s.key] }} />
      ))}
    </div>
  );
}

const GHOST_BAR = 'rounded bg-primary/[0.06]';

export function GridCoverageSpark({ values, ghost }: { values: number[]; ghost?: boolean }) {
  if (ghost) {
    return (
      <span
        className={`block h-7 w-full ${GHOST_BAR} animate-fade-in`}
        style={{ animationDelay: '150ms' }}
        aria-hidden="true"
      />
    );
  }
  if (values.length === 0) return <span className="block h-7" aria-hidden="true" />;
  const area = coverageArea(values);
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="block h-7 w-full"
      aria-hidden="true"
    >
      {area && <path d={area} fill="var(--primary)" fillOpacity={0.14} />}
      {values.length < 2 ? (
        coveragePoints(values).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.5} fill="var(--primary)" />
        ))
      ) : (
        <polyline
          points={coverageLine(values)}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
