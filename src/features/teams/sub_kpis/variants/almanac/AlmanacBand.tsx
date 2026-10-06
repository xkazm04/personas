// One place's band on the almanac's axis: a bar for every position it holds,
// all four of them on ONE row, so a project's debt and its forecast are the
// same object rather than two lists you have to join by name.
//
// A figure (doctrine 6c), and it carries exactly three channels so none of
// them has to share a meaning:
//
//   x - LATENESS. A bar's length is how late (left of today) or how far ahead
//       (right of it) the extreme KPI in that place is. Square-rooted, the
//       convention `CoverageBar`'s SizeBar already set, so a 2-day debt beside
//       a 91-day one is still a visible mark.
//   y - POPULATION. A bar's height is how many KPIs sit at that position.
//   hatch - NEVER READ. The hatched share of a bar's height is the part of
//       that population that has produced no reading at all, drawn with the
//       module's own `HATCH_BG`, which can never read as a fill.
//
// Due NEVER has no distance, so it cannot be a bar: it is pinned to the right
// margin, past the end of the axis, which is exactly where a reading nobody
// promised belongs.
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

import { HATCH_BG } from '../../kpiChartTheme';
import type { AlmanacMark, AlmanacRow } from './Almanac.model';

/** The band's drawing height. A bar never exceeds it; the smallest population
 *  still gets `MIN_BAR` so a single late KPI is not invisible. */
export const BAND_HEIGHT = 20;
const MIN_BAR = 4;

const TONE: Record<string, string> = {
  // A reading that exists and has gone late is the module's `stale` fact, and
  // it already has a tone: info. Gate 5 - "waiting on you" is info-blue.
  overdue: 'var(--status-info)',
  imminent: 'var(--status-warning)',
  scheduled: 'var(--primary)',
};

function barHeight(count: number, tallest: number): number {
  if (count <= 0) return 0;
  return Math.max(MIN_BAR, Math.round(Math.sqrt(count / Math.max(1, tallest)) * BAND_HEIGHT));
}

function barWidth(days: number | null, edge: number): number {
  if (days == null || days <= 0 || edge <= 0) return 6;
  return Math.max(6, Math.round(Math.sqrt(days / edge) * 100));
}

function Bar({ mark, edge, tallest, align }: { mark: AlmanacMark; edge: number; tallest: number; align: 'end' | 'start' }) {
  if (mark.count === 0) return null;
  const h = barHeight(mark.count, tallest);
  const dark = mark.count === 0 ? 0 : (mark.neverRead / mark.count) * h;
  return (
    <span
      className={`flex flex-col ${align === 'end' ? 'items-end' : 'items-start'} overflow-hidden rounded-[2px]`}
      style={{ width: `${barWidth(mark.days, edge)}%`, height: h }}
    >
      {dark > 0 && <span className="block w-full shrink-0" style={{ height: dark, backgroundImage: HATCH_BG }} />}
      <span className="block w-full flex-1" style={{ background: TONE[mark.state] }} />
    </span>
  );
}

export function AlmanacBandRow({
  row,
  deepest,
  farthest,
  tallest,
  onPress,
}: {
  row: AlmanacRow;
  deepest: number;
  farthest: number;
  tallest: number;
  onPress: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const never = row.marks.never;

  return (
    <li
      className="grid grid-cols-[8.5rem_minmax(0,1.5fr)_minmax(0,1fr)_4.5rem] items-center gap-x-1 py-0.5"
      data-testid={`kpi-almanac-band-${row.id}`}
    >
      <Button
        variant="ghost"
        size="xs"
        className="min-w-0 justify-start px-1"
        onClick={() => onPress(row.id)}
        data-testid={`kpi-almanac-place-${row.id}`}
      >
        <span className="min-w-0 truncate typo-data">{row.label}</span>
        <span className="shrink-0 typo-caption tabular-nums">{row.total}</span>
      </Button>

      {/* Left of today: the debt, deepest reaching furthest back. */}
      <span className="flex items-center justify-end gap-px">
        {row.depth > 0 && (
          <span className="mr-1 shrink-0 typo-caption tabular-nums" style={{ color: TONE.overdue }}>
            {tx(t.kpis.attn_overdue, { days: row.depth })}
          </span>
        )}
        <Bar mark={row.marks.overdue} edge={deepest} tallest={tallest} align="end" />
      </span>

      {/* Right of today: what is coming. The border IS the horizon, drawn by
          every row, so the line is continuous without an overlay. */}
      <span className="flex items-center gap-px border-l border-primary/40 pl-1">
        <Bar mark={row.marks.imminent} edge={farthest} tallest={tallest} align="start" />
        <Bar mark={row.marks.scheduled} edge={farthest} tallest={tallest} align="start" />
      </span>

      {/* Past the end of the axis: due never. */}
      <span className="flex items-center justify-start gap-1 border-l border-primary/15 pl-1.5">
        {never.count > 0 && (
          <>
            <span
              aria-hidden="true"
              className="block w-3 shrink-0 rounded-[2px]"
              style={{ height: barHeight(never.count, tallest), backgroundImage: HATCH_BG }}
            />
            <span className="typo-caption tabular-nums">
              {never.neverRead === never.count ? never.count : tx(o.measured_of, { measured: never.count - never.neverRead, total: never.count })}
            </span>
          </>
        )}
      </span>
    </li>
  );
}
