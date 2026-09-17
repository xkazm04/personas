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

import { LayoutGrid } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SimulationToggle } from '../simulation';
import { SQUARE_STATE_ORDER, SQUARE_VISUAL, type SquareState } from '../fleetGridModel';
import { AutopilotSwitch } from './AutopilotSwitch';

/**
 * The state key, as count pills — and each pill is the filter for its own
 * number. A legend that carries counts and cannot be clicked is a legend that
 * asks the operator to find those six cards by eye across a wrapped board of
 * hundreds; the number is only worth printing if it is also a door. Clicking
 * the pressed pill clears it, so the control is its own escape.
 */
function StateTally({
  totals, labels, active, onPick, filterAria,
}: {
  totals: Record<SquareState, number>;
  labels: Record<SquareState, string>;
  active: SquareState | null;
  onPick: (state: SquareState) => void;
  filterAria: (label: string) => string;
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5" data-testid="fleet-grid-tally">
      {SQUARE_STATE_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          aria-pressed={active === s}
          aria-label={filterAria(labels[s])}
          data-testid={`fleet-grid-tally-${s}`}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 typo-caption text-foreground transition-colors ${
            active === s
              ? 'border-primary/60 bg-primary/15'
              : 'border-border bg-secondary/20 hover:border-primary/30'
          }`}
        >
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${SQUARE_VISUAL[s].accent} ${
              SQUARE_VISUAL[s].pulse ? 'animate-pulse' : ''
            }`}
          />
          <span className="opacity-70">{labels[s]}</span>
          <span className="tabular-nums">{totals[s]}</span>
        </button>
      ))}
    </div>
  );
}

export function GridHeader({
  totals, showTally, stateFilter, onPickState,
}: {
  totals: Record<SquareState, number>;
  /** False before the first read lands — zeros would be a tally of nothing. */
  showTally: boolean;
  /** The square state the board is narrowed to, or `null` for every state. */
  stateFilter: SquareState | null;
  /** Pick a state; picking the pressed one clears it. */
  onPickState: (state: SquareState) => void;
}) {
  const { t, tx } = useTranslation();
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
        {showTally && (
          <StateTally
            totals={totals}
            labels={labels}
            active={stateFilter}
            onPick={onPickState}
            filterAria={(label) => tx(t.monitor.grid_filter_state_aria, { state: label })}
          />
        )}
      </div>
    </div>
  );
}

export default GridHeader;
