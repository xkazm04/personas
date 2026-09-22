// One tributary: a project (or a group) as its own bed, on the shared scale.
//
// Every tributary carries a COMPUTED SENTENCE rather than a shape to
// interpret - "never had a reading, 721 declared", "narrowing: 17 to 1 read
// over 3 weeks". Eleven similar dark ribbons are eleven things a reader has
// to decode; eleven sentences are eleven things a reader already knows.
import { useTranslation } from '@/i18n/useTranslation';

import type { KpiTally } from '../../estate/kpiEstate';
import { RiverbedChart } from './RiverbedChart';
import { describeFlow, type Riverbed } from './riverbed';

export function RiverTributary({
  rank,
  label,
  tally,
  bed,
  cursor,
  onOpen,
}: {
  rank: number;
  label: string;
  tally: KpiTally;
  bed: Riverbed;
  cursor: number | null;
  onOpen: () => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const flow = describeFlow(bed, tally.measured);
  const sentence = {
    never: () => tx(o.river_flow_never, { declared: flow.declared }),
    'before-window': () => tx(o.river_flow_before_window, { read: flow.to, declared: flow.declared }),
    'first-water': () => tx(o.river_flow_first_water, { weeks: flow.weeksAgo, read: flow.read, declared: flow.declared }),
    narrowing: () => tx(o.river_flow_narrowing, { from: flow.from, to: flow.to }),
    widening: () => tx(o.river_flow_widening, { from: flow.from, to: flow.to }),
    steady: () => tx(o.river_flow_steady, { read: flow.read }),
    quiet: () => tx(o.river_flow_quiet, { weeks: flow.weeksAgo, read: flow.to }),
  }[flow.kind]();

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`kpi-river-tributary-${label}`}
      className="flex w-full items-center gap-3 rounded-card px-2 py-1.5 text-left transition-colors hover:bg-secondary/25 focus-ring"
    >
      <span aria-hidden="true" className="w-5 shrink-0 typo-code text-foreground tabular-nums">
        {rank}
      </span>
      <span className="w-[13rem] shrink-0">
        <span className="block truncate typo-title text-foreground">{label}</span>
        <span className="block typo-caption text-foreground">{sentence}</span>
      </span>
      <span className="min-w-0 flex-1">
        <RiverbedChart bed={bed} height={34} cursor={cursor} compact />
      </span>
      <span className="w-20 shrink-0 text-right">
        <span className="block typo-data text-foreground tabular-nums">{`${tally.measured}/${tally.total}`}</span>
        <span className="block typo-caption text-foreground tabular-nums">
          {tx(o.river_ever_read, { pct: Math.round(tally.coverage * 100) })}
        </span>
      </span>
    </button>
  );
}
