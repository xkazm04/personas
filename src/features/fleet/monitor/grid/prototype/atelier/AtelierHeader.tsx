// Atelier header — one quiet row. On the left the fleet reads as a sentence
// ("4 working · 2 need you · 1 failed · 15 idle"), each phrase a soft pill that
// narrows the board to that state and clears on a second press. On the right:
// Capacity, Autopilot, the board layout, the orchestration view and the
// simulation toggle (test builds only).

import { ListOrdered } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { SimulationToggle } from '../../simulation';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { BOARD_VARIANTS, type BoardVariant } from '../../board/queue/boardVariant';
import type { ActivitySurface } from '../useActivitySurface';
import { AutopilotPill, CapacityChip } from './AtelierControls';
import { STATE_DOT } from './parts';

function StatePhrase({
  state, count, label, active, onPick, reducedMotion,
}: {
  state: SquareState; count: number; label: string; active: boolean; onPick: (s: SquareState) => void; reducedMotion: boolean;
}) {
  const { t, tx } = useTranslation();
  const quiet = count === 0 || state === 'idle';
  return (
    <button
      type="button"
      onClick={() => onPick(state)}
      aria-pressed={active}
      aria-label={tx(t.monitor.grid_filter_state_aria, { state: label })}
      data-testid={`fleet-grid-tally-${state}`}
      className={`focus-ring inline-flex h-8 items-center gap-2 rounded-pill px-3 typo-body transition-colors ${
        active ? 'bg-primary/15 text-foreground ring-1 ring-primary/50' : 'text-foreground hover:bg-secondary/40'
      } ${quiet && !active ? 'opacity-55' : ''}`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${STATE_DOT[state]} ${state === 'running' && count > 0 && !reducedMotion ? 'animate-pulse' : ''}`}
      />
      <span className="typo-data tabular-nums">{count}</span>
      <span className="lowercase">{label}</span>
    </button>
  );
}

export function AtelierHeader({ surface }: { surface: ActivitySurface }) {
  const { t } = useTranslation();
  const s = t.monitor;
  const labels: Record<SquareState, string> = {
    running: s.grid_state_running,
    attention: s.grid_state_attention,
    failed: s.grid_state_failed,
    idle: s.grid_state_idle,
  };
  const layoutLabel: Record<BoardVariant, string> = {
    classic: s.board_variant_classic,
    runway: s.board_variant_runway,
    lanes: s.board_variant_lanes,
  };

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-2 pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1" data-testid="fleet-grid-tally">
        {!surface.cold && SQUARE_STATE_ORDER.map((st, i) => (
          <span key={st} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden className="text-foreground opacity-30">·</span>}
            <StatePhrase
              state={st}
              count={surface.model.totals[st]}
              label={labels[st]}
              active={surface.filter.state === st}
              onPick={surface.pickState}
              reducedMotion={surface.reducedMotion}
            />
          </span>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <CapacityChip inFlight={surface.sessionsInFlight} overAdmitted={surface.overAdmitted} simulated={surface.simulating} />
        <AutopilotPill />
        <SegmentedTabs
          size="sm"
          variant="pill"
          fullWidth={false}
          ariaLabel={s.board_variant_aria}
          idPrefix={BOARD_TABS_PREFIX}
          activeTab={surface.layout}
          onTabChange={surface.setLayout}
          tabs={BOARD_VARIANTS.map((id) => ({ id, label: layoutLabel[id], testId: `fleet-board-variant-${id}` }))}
        />
        <Tooltip content={s.queue_open_orchestration}>
          <button
            type="button"
            onClick={surface.openOrchestration}
            aria-label={s.queue_open_orchestration}
            data-testid="fleet-grid-orchestration"
            className="focus-ring inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-pill bg-secondary/35 text-foreground transition-colors hover:bg-secondary/55"
          >
            <ListOrdered className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
        <SimulationToggle />
      </div>
    </div>
  );
}
