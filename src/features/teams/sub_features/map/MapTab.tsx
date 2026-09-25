// The Map tab: the context map seen through the features that claim it.
//
// With a feature selected its slice is LIT and everything else dims - and the
// dimmed count is said out loud, because hiding a hundred squares and hiding
// nothing look identical once they are faded.
import { useMemo } from 'react';

import { SQUARE_FILL, type SquareTone } from '../featureRules';
import type { FeaturesModel, TFeatures } from '../featuresModel';
import { ActionLists } from './ActionLists';
import { GroupPlotCard } from './GroupPlot';

export interface MapTabProps {
  model: FeaturesModel;
  selectedContextIds: ReadonlySet<string>;
  hasSelection: boolean;
  onPickFeature: (featureId: string) => void;
  onOpenContext: (contextId: string) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

const LEGEND: Array<{ tone: SquareTone; key: keyof TFeatures }> = [
  { tone: 'gate', key: 'map_legend_gate' },
  { tone: 'trouble', key: 'map_legend_trouble' },
  { tone: 'running', key: 'map_legend_running' },
  { tone: 'settled', key: 'map_legend_settled' },
  { tone: 'claimed', key: 'map_legend_claimed' },
  { tone: 'platform', key: 'map_legend_platform' },
  { tone: 'tests', key: 'map_legend_tests' },
  { tone: 'unclaimed', key: 'map_legend_unclaimed' },
];

export function MapTab({
  model,
  selectedContextIds,
  hasSelection,
  onPickFeature,
  onOpenContext,
  t,
  tx,
}: MapTabProps) {
  const groupNameById = useMemo(
    () => new Map(model.plots.map((p) => [p.group.id, p.group.name])),
    [model.plots],
  );
  const dimmed = hasSelection ? model.cellById.size - selectedContextIds.size : 0;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="features-map">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {LEGEND.map(({ tone, key }) => (
          <span key={tone} className="inline-flex items-center gap-1.5 typo-caption">
            <i
              aria-hidden="true"
              className="h-[12px] w-[12px] rounded-[3px] border"
              style={{
                background: tone === 'unclaimed' ? 'transparent' : SQUARE_FILL[tone],
                borderColor:
                  tone === 'unclaimed' ? 'color-mix(in srgb, var(--foreground) 30%, transparent)' : 'transparent',
              }}
            />
            {t[key]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 typo-caption">
          <i aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-violet-400" />
          {t.map_legend_shared}
        </span>
        {hasSelection ? (
          <span className="typo-caption text-foreground" data-testid="features-map-dimmed">
            {tx(t.map_dimmed, { count: dimmed })}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
        {model.plots.map((plot) => (
          <GroupPlotCard
            key={plot.group.id}
            plot={plot}
            litContextIds={selectedContextIds}
            hasSelection={hasSelection}
            onPickFeature={onPickFeature}
            onOpenContext={onOpenContext}
            t={t}
            tx={tx}
          />
        ))}
      </div>

      <ActionLists
        unclaimed={model.unclaimed}
        untouched={model.untouched}
        loadBearing={model.loadBearing}
        groupNameById={groupNameById}
        onOpenContext={onOpenContext}
        t={t}
        tx={tx}
      />
    </div>
  );
}
