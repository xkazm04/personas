// The plot under the pointer, in words.
//
// The map's one weakness is that a plot is a square: it can carry a state and
// a denominator but never a name. This card is where the name goes, and it
// holds its shape when nothing is hovered so the canvas beside it never
// reflows under the reader's own pointer.
import { useTranslation } from '@/i18n/useTranslation';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { kpiNextMoveOf, nextMoveText } from '../../estate/kpiNextMove';
import { ageDays } from '../../estate/kpiEstate';
import { plotStyle } from './mapPlot';

export function MapFocusCard({
  kpi,
  now,
  onOpen,
}: {
  kpi: DevKpi | null;
  now: number;
  onOpen: (kpiId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  if (!kpi) {
    return (
      <section className="min-h-[7.5rem] rounded-card border border-card-border bg-secondary/10 p-3">
        <h3 className="typo-heading text-foreground">{o.map_focus_title}</h3>
        <p className="typo-caption text-foreground">{o.map_focus_hint}</p>
      </section>
    );
  }

  const style = plotStyle(kpi, now, 'state');
  const age = ageDays(kpi, now);

  return (
    <section className="min-h-[7.5rem] rounded-card border border-card-border bg-secondary/10 p-3 space-y-1.5">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 block size-3 shrink-0 rounded-[2px]"
          style={{ background: style.fill ?? 'transparent', border: style.fill ? undefined : '1px solid var(--card-border)' }}
        />
        <button
          type="button"
          onClick={() => onOpen(kpi.id)}
          className="min-w-0 flex-1 rounded-interactive text-left typo-title text-foreground hover:text-primary focus-ring"
        >
          {kpi.name}
        </button>
      </div>
      <p className="typo-caption text-foreground">
        {age == null ? o.map_never_read : tx(o.map_last_read, { days: Math.round(age), cadence: kpi.cadence ?? 'manual' })}
      </p>
      <p className="typo-caption text-foreground">{nextMoveText(kpiNextMoveOf(kpi, now), t, tx)}</p>
    </section>
  );
}
