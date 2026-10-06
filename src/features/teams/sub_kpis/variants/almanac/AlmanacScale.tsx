// The axis the bands are drawn on, stated once at the top and once at the
// bottom, so a band read in the middle of eleven rows never has to scroll to
// find out which way is late.
//
// Four positions, in the module's existing words: `map_overdue`, `map_aging`,
// `schedules.scheduled`, and - the one that matters here - `due_by` composed
// with `read_never`, which says "due never" out of two keys that already
// exist. No new translation keys were spent on this surface.
import { useTranslation } from '@/i18n/useTranslation';

import { HATCH_BG } from '../../kpiChartTheme';
import type { Almanac } from './Almanac.model';

export function AlmanacScale({ almanac }: { almanac: Almanac }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const totals = almanac.totals;

  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1.5fr)_minmax(0,1fr)_4.5rem] items-baseline gap-x-1">
      <p className="typo-eyebrow">{t.kpis.overview.books_project}</p>

      <p className="flex items-baseline justify-between gap-2">
        <span className="typo-caption tabular-nums">
          {almanac.deepest > 0 ? tx(t.kpis.attn_overdue, { days: almanac.deepest }) : ''}
        </span>
        <span className="typo-eyebrow" style={{ color: 'var(--status-info)' }}>
          {`${o.map_overdue} ${totals.overdue.count}`}
        </span>
      </p>

      <p className="flex items-baseline justify-between gap-2 border-l border-primary/40 pl-1">
        <span className="typo-eyebrow">{t.shared.group_today}</span>
        <span className="typo-caption tabular-nums">
          {almanac.farthest > 0 ? tx(t.kpis.attn_days_left, { days: almanac.farthest }) : ''}
        </span>
      </p>

      <p className="flex items-center gap-1 border-l border-primary/15 pl-1.5">
        <span aria-hidden="true" className="block h-2.5 w-3 shrink-0" style={{ backgroundImage: HATCH_BG }} />
        <span className="typo-eyebrow">{tx(t.kpis.due_by, { date: o.read_never })}</span>
      </p>
    </div>
  );
}

/** The legend under the bands: what the three channels mean. It names the
 *  channels, not the colours - the point of the figure is that a bar's LENGTH
 *  and HEIGHT say different things, and that is not something a colour swatch
 *  can explain. */
export function AlmanacLegend({ almanac }: { almanac: Almanac }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const totals = almanac.totals;
  const promised = almanac.total - totals.never.count;

  return (
    <p className="typo-caption tabular-nums border-t border-primary/10 pt-2">
      {[
        tx(o.measured_of, { measured: promised, total: almanac.total }),
        `${o.map_overdue} ${totals.overdue.count}`,
        `${o.map_aging} ${totals.imminent.count}`,
        `${t.schedules.scheduled} ${totals.scheduled.count}`,
        `${tx(t.kpis.due_by, { date: o.read_never })} ${totals.never.count}`,
        `${o.count_never_read} ${totals.overdue.neverRead + totals.imminent.neverRead + totals.scheduled.neverRead + totals.never.neverRead}`,
      ].join(' · ')}
    </p>
  );
}
