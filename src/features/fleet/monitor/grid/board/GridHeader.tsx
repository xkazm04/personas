// GridHeader — the Activity card's 44px title strip.
//
// It carries the state key. That key used to be a `pointer-events-none
// absolute` box in the board's bottom-right corner — out of the way of the
// squares, and out of the way of being read. At header width it is a row of
// count pills, which is the same information without a floating overlay on top
// of the board, and it is where a key belongs when it also carries numbers.
//
// Three controls now, left of the key, in the order a control outranks a
// legend: the `AutopilotSwitch` (the attention loop's on/off with its pacing
// verdict), the `MaxParallelStepper` (the fleet's cap, with `running / cap`
// beside it — over-admission reads `11 / 10` in the warning tone), and the
// board LAYOUT — three variants on a `SegmentedTabs` (classic team columns,
// runway, lanes), whose panel is the board body (`FleetGridView` spreads
// `segmentedTabPanelProps('fleet-board', …)` on it, so `aria-controls`
// resolves) — and the NODE style beside it (ledger, badge, meter: three
// prototype reads of the same two-row node, `board/node/nodeVariant.ts`).
// The node style is a `PillGroup` RADIOGROUP, not a second tab strip: it
// selects no panel — every style paints into the same board — and a tablist
// that controls nothing is the broken promise the tab-strip golden path
// gates (census `tabstrip-with-no-declared-panel`). Both are per-viewer
// preferences kept in localStorage. The ordered-list button opens the
// Orchestration panel: what the next Autopilot tick would do, read-only,
// beside the switch that paces it.
//
// The `SimulationToggle` (icon-only) renders itself away outside a test build,
// so this header is byte-identical in a shipped installer. (The usage strip's
// auto-rotate controls used to be portaled in here; they live in the strip's
// own header row now.)

import { LayoutGrid, ListOrdered } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { PillGroup } from '@/features/shared/components/forms/PillGroup';
import { SimulationToggle } from '../simulation';
import { SQUARE_STATE_ORDER, SQUARE_VISUAL, type SquareState } from '../fleetGridModel';
import { AutopilotSwitch } from './AutopilotSwitch';
import { MaxParallelStepper } from './MaxParallelStepper';
import { BOARD_VARIANTS, type BoardVariant } from './queue/boardVariant';
import { NODE_VARIANTS, type NodeVariant } from './node/nodeVariant';

/** The layout strip's id prefix; the board body declares itself its panel. */
export const BOARD_TABS_PREFIX = 'fleet-board';

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
  totals, showTally, stateFilter, onPickState, variant, onVariantChange, nodeVariant, onNodeVariantChange,
  queueRunning, queueOverAdmitted, simulated, onOpenOrchestration,
}: {
  totals: Record<SquareState, number>;
  /** False before the first read lands — zeros would be a tally of nothing. */
  showTally: boolean;
  /** The square state the board is narrowed to, or `null` for every state. */
  stateFilter: SquareState | null;
  /** Pick a state; picking the pressed one clears it. */
  onPickState: (state: SquareState) => void;
  variant: BoardVariant;
  onVariantChange: (v: BoardVariant) => void;
  nodeVariant: NodeVariant;
  onNodeVariantChange: (v: NodeVariant) => void;
  /** Live sessions as the door counts them (`FleetQueueSnapshot.running`). */
  queueRunning: number;
  queueOverAdmitted: number;
  /** A simulated board writes no setting. */
  simulated: boolean;
  onOpenOrchestration: () => void;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const labels: Record<SquareState, string> = {
    running: s.grid_state_running,
    attention: s.grid_state_attention,
    failed: s.grid_state_failed,
    idle: s.grid_state_idle,
  };
  const variantLabel: Record<BoardVariant, string> = {
    classic: s.board_variant_classic,
    runway: s.board_variant_runway,
    lanes: s.board_variant_lanes,
  };
  const nodeLabel: Record<NodeVariant, string> = {
    ledger: s.node_variant_ledger,
    badge: s.node_variant_badge,
    meter: s.node_variant_meter,
  };

  return (
    <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border bg-foreground/[0.015] px-3">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15">
        <LayoutGrid className="h-3.5 w-3.5 text-foreground" />
      </div>
      <span className="typo-title">{s.activity_mode}</span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <AutopilotSwitch />
        <MaxParallelStepper running={queueRunning} overAdmitted={queueOverAdmitted} disabled={simulated} />
        <Tooltip content={s.queue_open_orchestration}>
          <button
            type="button"
            onClick={onOpenOrchestration}
            aria-label={s.queue_open_orchestration}
            data-testid="fleet-grid-orchestration"
            className="focus-ring inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-interactive border border-border bg-secondary/20 text-foreground transition-colors hover:bg-secondary/40"
          >
            <ListOrdered className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
        <SegmentedTabs
          size="sm"
          variant="segment"
          fullWidth={false}
          ariaLabel={s.board_variant_aria}
          idPrefix={BOARD_TABS_PREFIX}
          activeTab={variant}
          onTabChange={onVariantChange}
          tabs={BOARD_VARIANTS.map((id) => ({ id, label: variantLabel[id], testId: `fleet-board-variant-${id}` }))}
        />
        <PillGroup
          aria-label={s.node_variant_aria}
          data-testid="fleet-node-variant"
          labelClass="typo-caption"
          options={NODE_VARIANTS.map((id) => ({ value: id, label: nodeLabel[id] }))}
          value={nodeVariant}
          onChange={onNodeVariantChange}
        />
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
