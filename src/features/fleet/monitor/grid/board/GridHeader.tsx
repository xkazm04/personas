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
// The `SimulationToggle` renders itself away outside a test build, so this
// header is byte-identical in a shipped installer.

import { Inbox, LayoutGrid } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SimulationToggle } from '../simulation';
import { SQUARE_STATE_ORDER, SQUARE_VISUAL, type SquareState } from '../fleetGridModel';
import { AutopilotSwitch } from './AutopilotSwitch';

/**
 * The queue switch. The Project-columns view this board replaced showed only
 * personas with something pending; this puts that predicate back as a control
 * rather than as a second surface. `aria-pressed` carries the state, so the
 * chip is one button and never a checkbox pretending to be one.
 */
function ActionableToggle({
  on, onToggle, label,
}: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      data-testid="fleet-grid-actionable-toggle"
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 typo-caption transition-colors ${
        on
          ? 'border-status-warning/50 bg-status-warning/15 text-status-warning'
          : 'border-border bg-secondary/20 text-foreground opacity-70 hover:opacity-100'
      }`}
    >
      <Inbox className="h-3 w-3 flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

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
  totals, showTally, actionableOnly, onToggleActionable,
}: {
  totals: Record<SquareState, number>;
  /** False before the first read lands — zeros would be a tally of nothing. */
  showTally: boolean;
  /** The board is narrowed to cards with something pending. */
  actionableOnly: boolean;
  onToggleActionable: () => void;
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
      <div className="ml-auto flex flex-shrink-0 items-center gap-2">
        <AutopilotSwitch />
        <SimulationToggle />
        <ActionableToggle
          on={actionableOnly}
          onToggle={onToggleActionable}
          label={t.monitor.grid_filter_actionable}
        />
        {showTally && <StateTally totals={totals} labels={labels} />}
      </div>
    </div>
  );
}

export default GridHeader;
