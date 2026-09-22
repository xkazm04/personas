// One tributary: a project (or a group) as its own bed, on the shared scale.
//
// Every tributary carries a COMPUTED SENTENCE rather than a shape to
// interpret - "never had a reading, 721 declared", "narrowing: 17 to 1 read".
// Eleven similar dark ribbons are eleven things a reader has to decode; eleven
// sentences are eleven things a reader already knows. The bed takes whatever
// width is left, and the row closes on the bare denominator: the headline's
// stat cards already say what the figures mean.
import { useTranslation } from '@/i18n/useTranslation';

import type { KpiTally } from '../../estate/kpiEstate';
import { KT } from '../../estate/kpiType';
import { RiverbedChart } from './RiverbedChart';
import { describeFlow, type Riverbed } from './riverbed';

export function RiverTributary({
  rank,
  label,
  tally,
  bed,
  onOpen,
}: {
  rank: number;
  label: string;
  tally: KpiTally;
  bed: Riverbed;
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
      className="flex w-full items-center gap-4 px-2 py-2.5 text-left transition-colors hover:bg-secondary/15 focus-ring"
    >
      <span aria-hidden="true" className={`w-5 shrink-0 ${KT.metaFigure}`}>
        {rank}
      </span>
      <span className="w-[16rem] shrink-0">
        <span className={`block truncate ${KT.name}`}>{label}</span>
        <span className={`block ${KT.meta}`}>{sentence}</span>
      </span>
      <span className="min-w-0 flex-1">
        <RiverbedChart bed={bed} height={34} />
      </span>
      <span className={`w-16 shrink-0 text-right ${KT.figure}`}>{`${tally.measured}/${tally.total}`}</span>
    </button>
  );
}
