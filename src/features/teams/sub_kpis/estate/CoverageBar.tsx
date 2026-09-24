// The composition bar — one claim drawn as what it is made of.
//
// Solid segments are verdicts (met, on track, off track). A HOLLOW segment is
// measured-but-ungradable: there is a number and it cannot be judged, which is
// not health and not absence. A HATCHED segment is never measured at all.
// Because every segment is a share of `total`, colour can never outrun its
// denominator: a bar that is 5 % green and 95 % hatched cannot read as green.
import { useTranslation } from '@/i18n/useTranslation';

import { HATCH_BG } from '../kpiChartTheme';
import type { KpiTally } from './kpiEstate';

const SEGMENTS = [
  { key: 'met', color: 'var(--status-success)' },
  { key: 'onTrack', color: 'var(--primary)' },
  { key: 'offTrack', color: 'var(--status-error)' },
] as const;

export function CoverageBar({ tally, height = 8 }: { tally: KpiTally; height?: number }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const total = Math.max(1, tally.total);
  const pct = (n: number) => `${(n / total) * 100}%`;
  const label = tx(o.composition_aria, {
    met: tally.met,
    onTrack: tally.onTrack,
    offTrack: tally.offTrack,
    unpaced: tally.unpaced,
    unmeasured: tally.unmeasured,
    total: tally.total,
  });

  return (
    <span
      role="img"
      aria-label={label}
      className="flex w-full overflow-hidden rounded-interactive border border-card-border"
      style={{ height }}
    >
      {SEGMENTS.map(({ key, color }) =>
        tally[key] > 0 ? (
          <span key={key} style={{ width: pct(tally[key]), background: color }} />
        ) : null,
      )}
      {tally.unpaced > 0 && (
        <span
          style={{
            width: pct(tally.unpaced),
            border: '1px solid var(--status-warning)',
            background: 'transparent',
          }}
        />
      )}
      {tally.unmeasured > 0 && (
        <span style={{ width: pct(tally.unmeasured), backgroundImage: HATCH_BG }} />
      )}
    </span>
  );
}

/**
 * The size bar. Claims in this estate span 9 KPIs to 721, so a linear bar
 * makes every small project invisible; the square root keeps a 9-KPI project
 * legible beside a 721-KPI one while still ordering them correctly. It is a
 * COMPARISON of size, never a quantity to read off, so it carries no ticks.
 */
export function SizeBar({ total, max, height = 3 }: { total: number; max: number; height?: number }) {
  const width = max <= 0 ? 0 : Math.sqrt(total / max) * 100;
  return (
    <span aria-hidden="true" className="block w-full rounded-full bg-secondary/40" style={{ height }}>
      <span className="block h-full rounded-full bg-primary/50" style={{ width: `${width}%` }} />
    </span>
  );
}
