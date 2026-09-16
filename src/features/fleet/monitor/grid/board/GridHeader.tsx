// GridHeader — the Activity card's 44px title strip.
//
// It carries the state key. That key used to be a `pointer-events-none
// absolute` box in the board's bottom-right corner — out of the way of the
// squares, and out of the way of being read. At header width it is a row of
// count pills, which is the same information without a floating overlay on top
// of the board, and it is where a key belongs when it also carries numbers.
//
// The `AutopilotSwitch` is the board's one control: the attention loop's
// on/off, with the pacing verdict beside it. It sits before the key because a
// control outranks a legend.
//
// The usage strip's auto-rotate controls are portaled into this header (see
// `controlsSlotRef`). The `SimulationToggle` (icon-only) renders itself away outside a test build, so this
// header is byte-identical in a shipped installer.

import { LayoutGrid } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SimulationToggle } from '../simulation';
import { SQUARE_STATE_ORDER, SQUARE_VISUAL, type SquareState } from '../fleetGridModel';
import { AutopilotSwitch } from './AutopilotSwitch';

/** The state key, as count pills. */
function StateTally({
  totals, labels,
}: { totals: Record<SquareState, number>; labels: Record<SquareState, string> }) {
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5" data-testid="fleet-grid-tally">
      {SQUARE_STATE_ORDER.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/20 px-2 py-0.5 typo-caption text-foreground"
        >
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${SQUARE_VISUAL[s].accent} ${
              SQUARE_VISUAL[s].pulse ? 'animate-pulse' : ''
            }`}
          />
          <span className="opacity-70">{labels[s]}</span>
          <span className="tabular-nums">{totals[s]}</span>
        </span>
      ))}
    </div>
  );
}

export function GridHeader({
  totals, showTally, controlsSlotRef,
}: {
  totals: Record<SquareState, number>;
  /** False before the first read lands — zeros would be a tally of nothing. */
  showTally: boolean;
  /**
   * Mount point for the usage strip's auto-rotate controls. `UsageStrip` owns
   * that state (the accounts read, the save action, the simulated plans) and
   * portals the controls here, so the header shows them without a second copy
   * of the hooks. Empty — and zero-width — while there is only one login.
   */
  controlsSlotRef?: (el: HTMLDivElement | null) => void;
}) {
  const { t } = useTranslation();
  const labels: Record<SquareState, string> = {
    running: t.monitor.grid_state_running,
    attention: t.monitor.grid_state_attention,
    failed: t.monitor.grid_state_failed,
    idle: t.monitor.grid_state_idle,
  };

  return (
    <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border bg-foreground/[0.015] px-3">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15">
        <LayoutGrid className="h-3.5 w-3.5 text-foreground" />
      </div>
      <span className="typo-title">{t.monitor.activity_mode}</span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <div
          ref={controlsSlotRef}
          className="flex min-w-0 items-center gap-3 typo-caption text-foreground empty:hidden"
          data-testid="fleet-grid-usage-controls"
        />
        <AutopilotSwitch />
        <SimulationToggle />
        {showTally && <StateTally totals={totals} labels={labels} />}
      </div>
    </div>
  );
}

export default GridHeader;
