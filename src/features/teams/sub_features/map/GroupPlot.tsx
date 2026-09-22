// One group as a plot of context squares.
//
// A square takes the temperature of WHOEVER CLAIMS IT, so the map answers
// "which feature owns this ground" rather than "how many contexts are there".
// Scale is the constraint: 25 plots over 200+ contexts have to stay legible, so
// a plot with many contexts scrolls inside its own frame and never overflows
// into its neighbour.
import { useRef, useState } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { SQUARE_FILL, squareTone } from '../featureRules';
import { roleLabel, type ContextCell, type GroupPlot as GroupPlotModel, type TFeatures } from '../featuresModel';
import { ClaimantPopover } from './ClaimantPopover';

/** Above this the plot gets its own scroller rather than growing the card. */
const SCROLL_AT = 30;

export interface GroupPlotProps {
  plot: GroupPlotModel;
  /** The selected feature's contexts. Empty means nothing is lit and nothing
   *  is dimmed; a non-empty set lights its own and dims the rest. */
  litContextIds: ReadonlySet<string>;
  hasSelection: boolean;
  onPickFeature: (featureId: string) => void;
  onOpenContext: (contextId: string) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

function SquareButton({
  cell,
  dimmed,
  onPickFeature,
  onOpenContext,
  t,
  tx,
}: {
  cell: ContextCell;
  dimmed: boolean;
  onPickFeature: (featureId: string) => void;
  onOpenContext: (contextId: string) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const tone = squareTone(cell.role, cell.claimMove);
  const hollow = tone === 'unclaimed' || tone === 'unknown';
  const shared = cell.claimants.length > 1;

  const label = tx(t.map_square_label, { context: cell.context.name, role: roleLabel(cell.role, t) });
  const used = cell.claimants.length === 0
    ? t.map_used_by_none
    : tx(t.map_used_by, { features: cell.claimants.map((f) => f.name).join(', ') });

  const activate = () => {
    if (cell.claimants.length === 1) {
      const only = cell.claimants[0];
      if (only) onPickFeature(only.id);
      return;
    }
    if (cell.claimants.length > 1) {
      setPicking(true);
      return;
    }
    onOpenContext(cell.context.id);
  };

  return (
    <>
      <Tooltip content={<span className="block max-w-[18rem]">{label}<br />{used}</span>}>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          data-testid="features-map-square"
          onClick={activate}
          style={{
            background: hollow ? 'transparent' : SQUARE_FILL[tone],
            borderColor: hollow ? 'color-mix(in srgb, var(--foreground) 30%, transparent)' : 'transparent',
            opacity: dimmed ? 0.22 : 1,
          }}
          className="relative h-[18px] w-[18px] rounded-[3px] border focus-ring"
        >
          {shared ? (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-[6px] w-[6px] rounded-full bg-violet-400"
            />
          ) : null}
        </button>
      </Tooltip>
      {picking ? (
        <ClaimantPopover
          triggerRef={ref}
          features={cell.claimants}
          title={t.map_pick_feature}
          onPick={(id) => { setPicking(false); onPickFeature(id); }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}

export function GroupPlotCard({
  plot,
  litContextIds,
  hasSelection,
  onPickFeature,
  onOpenContext,
  t,
  tx,
}: GroupPlotProps) {
  const scrolls = plot.cells.length > SCROLL_AT;
  return (
    <section
      data-testid="features-map-plot"
      className={`rounded-card border p-2.5 ${
        plot.group.untouched ? 'border-dashed border-status-warning/50' : 'border-border'
      }`}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate typo-body text-foreground">{plot.group.name}</h3>
        <span className="typo-data flex-none text-foreground">{plot.group.contextCount}</span>
      </header>
      <div className={scrolls ? 'max-h-[132px] overflow-y-auto pr-1' : ''}>
        <div className="flex flex-wrap gap-1">
          {plot.cells.map((cell) => (
            <SquareButton
              key={cell.context.id}
              cell={cell}
              dimmed={hasSelection && !litContextIds.has(cell.context.id)}
              onPickFeature={onPickFeature}
              onOpenContext={onOpenContext}
              t={t}
              tx={tx}
            />
          ))}
        </div>
      </div>
      {plot.group.untouched ? (
        <p className="mt-2 typo-caption text-status-warning">{t.map_untouched_group}</p>
      ) : null}
    </section>
  );
}
