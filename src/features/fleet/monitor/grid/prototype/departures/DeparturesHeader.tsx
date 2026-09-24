// Departures · DeparturesHeader — the board's masthead: one ruled strip.
// PROTOTYPE (variant C).
//
//   ■ 0 RUNNING  ■ 0 NEEDS YOU  ■ 1 FAILED  ■ 15 IDLE │ IN FLIGHT − 7 / 10 + │ [Classic|Runway|Lanes]  AUTOPILOT · OFF  ≡  ⚗
//
// The status line counts AGENTS (personas); "In flight" counts Claude SESSIONS
// holding a slot. Two nouns, two labels — the baseline printed "Running 0"
// beside seven running sessions because both were called "running".

import { ListOrdered, Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { SimulationToggle } from '../../simulation';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { BOARD_VARIANTS, type BoardVariant } from '../../board/queue/boardVariant';
import type { ActivitySurface } from '../useActivitySurface';
import { useCapSetting } from '../shared';
import { DeparturesAutopilot } from './DeparturesAutopilot';
import { Marker, STATE_FILL, STATE_UNDERLINE } from './parts';

const STEP = 'focus-ring inline-flex h-5 w-5 items-center justify-center rounded-interactive text-foreground opacity-60 transition-colors hover:bg-secondary/40 hover:opacity-100 disabled:opacity-20';
const SEP = <span aria-hidden className="h-4 w-px flex-shrink-0 bg-border" />;

export function DeparturesHeader({ surface }: { surface: ActivitySurface }) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const cap = useCapSetting(surface.simulating);
  const labels: Record<SquareState, string> = {
    running: s.grid_state_running, attention: s.grid_state_attention, failed: s.grid_state_failed, idle: s.grid_state_idle,
  };
  const layoutLabel: Record<BoardVariant, string> = {
    classic: s.board_variant_classic, runway: s.board_variant_runway, lanes: s.board_variant_lanes,
  };
  const inFlight = surface.sessionsInFlight;
  const over = surface.overAdmitted > 0;
  const capHint = over
    ? tx(s.queue_cap_over_hint, { running: inFlight, cap: cap.cap, over: surface.overAdmitted })
    : tx(s.queue_cap_hint, { running: inFlight, cap: cap.cap });

  return (
    <div className="flex min-h-11 flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-1.5">
      {!surface.cold && (
        <div className="flex items-center gap-4" data-testid="fleet-grid-tally" role="group" aria-label={s.grid_board_aria}>
          {SQUARE_STATE_ORDER.map((st) => {
            const on = surface.filter.state === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => surface.pickState(st)}
                aria-pressed={on}
                aria-label={tx(s.grid_filter_state_aria, { state: labels[st] })}
                data-testid={`fleet-grid-tally-${st}`}
                className={`focus-ring inline-flex items-baseline gap-1.5 border-b-2 pb-0.5 transition-colors ${
                  on ? STATE_UNDERLINE[st] : 'border-transparent opacity-80 hover:opacity-100'
                }`}
              >
                <Marker className={`${STATE_FILL[st]} self-center`} />
                <span className="typo-data tabular-nums text-foreground">{surface.model.totals[st]}</span>
                <span className="typo-label uppercase tracking-wide text-foreground">{labels[st]}</span>
              </button>
            );
          })}
        </div>
      )}
      {SEP}
      <Tooltip content={capHint}>
        <div className="inline-flex items-center gap-1" role="group" aria-label={s.queue_cap_aria} data-testid="fleet-max-parallel" data-over={over || undefined}>
          <span className="mr-1 typo-label uppercase tracking-wide text-foreground">In flight</span>
          <button type="button" className={STEP} onClick={cap.decrease} disabled={!cap.canDecrease} aria-label={s.queue_cap_decrease}>
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className={`typo-data tabular-nums ${over ? 'text-status-warning' : 'text-foreground'}`} data-testid="fleet-max-parallel-readout">
            {inFlight} / {cap.cap}
          </span>
          <button type="button" className={STEP} onClick={cap.increase} disabled={!cap.canIncrease} aria-label={s.queue_cap_increase}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </Tooltip>

      <div className="ml-auto flex items-center gap-3">
        <SegmentedTabs
          size="sm"
          variant="segment"
          fullWidth={false}
          ariaLabel={s.board_variant_aria}
          idPrefix={BOARD_TABS_PREFIX}
          activeTab={surface.layout}
          onTabChange={surface.setLayout}
          tabs={BOARD_VARIANTS.map((id) => ({ id, label: layoutLabel[id], testId: `fleet-board-variant-${id}` }))}
        />
        {SEP}
        <DeparturesAutopilot />
        <Tooltip content={s.queue_open_orchestration}>
          <button
            type="button"
            onClick={surface.openOrchestration}
            aria-label={s.queue_open_orchestration}
            data-testid="fleet-grid-orchestration"
            className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-interactive text-foreground opacity-70 transition-colors hover:bg-secondary/40 hover:opacity-100"
          >
            <ListOrdered className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
        <SimulationToggle />
      </div>
    </div>
  );
}
