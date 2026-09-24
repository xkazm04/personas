// InstrumentCommandBand — the ONE band above the board, read like a flight-deck
// annunciator panel. Left: four state annunciators (each is its own filter).
// Middle: sessions in flight against the cap, as a row of cap cells with a
// bracketed stepper. Right: layout, autopilot, orchestration, simulation.
//
// Two nouns, two readouts, on purpose: the annunciators count PERSONAS, the
// cap readout counts Claude SESSIONS. The baseline printed "Running 0" beside
// seven running sessions because both were called "running".

import { ListOrdered, Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { BOARD_VARIANTS } from '../../board/queue/boardVariant';
import { SimulationToggle } from '../../simulation';
import { useCapSetting } from '../shared';
import type { ActivitySurface } from '../useActivitySurface';
import { InstrumentAutopilot } from './InstrumentAutopilot';
import { STATE_FILL, glow } from './parts';

const STEP = 'focus-ring inline-flex h-6 w-6 items-center justify-center rounded-interactive border border-primary/15 text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 disabled:opacity-25 disabled:hover:bg-transparent';

function CapCells({ running, cap }: { running: number; cap: number }) {
  const cells = Math.max(cap, running);
  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          className={`h-2.5 w-1.5 rounded-interactive ${
            i >= cap ? 'bg-status-warning' : i < running ? 'bg-primary' : 'bg-foreground/10'
          }`}
          style={i < running && i < cap ? glow('running', 4) : undefined}
        />
      ))}
    </span>
  );
}

export function InstrumentCommandBand({ surface }: { surface: ActivitySurface }) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const cap = useCapSetting(surface.simulating);
  const running = surface.sessionsInFlight;
  const over = surface.overAdmitted > 0;
  const labels: Record<SquareState, string> = {
    running: s.grid_state_running, attention: s.grid_state_attention, failed: s.grid_state_failed, idle: s.grid_state_idle,
  };
  const layoutLabel = { classic: s.board_variant_classic, runway: s.board_variant_runway, lanes: s.board_variant_lanes };
  const capHint = over
    ? tx(s.queue_cap_over_hint, { running, cap: cap.cap, over: surface.overAdmitted })
    : tx(s.queue_cap_hint, { running, cap: cap.cap });

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-primary/10 bg-background/40 px-4 py-2.5">
      {!surface.cold && (
        <div className="flex overflow-hidden rounded-interactive border border-primary/10" data-testid="fleet-grid-tally" role="group">
          {SQUARE_STATE_ORDER.map((st, i) => {
            const count = surface.model.totals[st];
            const on = surface.filter.state === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => surface.pickState(st)}
                aria-pressed={on}
                aria-label={tx(s.grid_filter_state_aria, { state: labels[st] })}
                data-testid={`fleet-grid-tally-${st}`}
                className={`focus-ring relative flex min-w-[6.5rem] flex-col items-start px-3 pb-1.5 pt-2 text-left transition-colors ${
                  i > 0 ? 'border-l border-primary/10' : ''
                } ${on ? 'bg-primary/10' : 'bg-foreground/[0.02] hover:bg-foreground/[0.05]'}`}
              >
                <span
                  aria-hidden
                  className={`absolute inset-x-0 top-0 h-0.5 ${STATE_FILL[st]} ${count === 0 ? 'opacity-25' : ''}`}
                  style={count > 0 ? glow(st, 6) : undefined}
                />
                <span className="typo-label uppercase tracking-wider text-foreground opacity-70">{labels[st]}</span>
                <span className="typo-data tabular-nums text-foreground">{String(count).padStart(2, '0')}</span>
              </button>
            );
          })}
        </div>
      )}

      <Tooltip content={capHint}>
        <div className="flex items-center gap-3" role="group" aria-label={s.queue_cap_aria} data-testid="fleet-max-parallel" data-over={over || undefined}>
          <span className="flex flex-col">
            <span className="typo-label uppercase tracking-wider text-foreground opacity-70">{s.queue_band_running}</span>
            <span className={`typo-data tabular-nums ${over ? 'text-status-warning' : 'text-foreground'}`} data-testid="fleet-max-parallel-readout">
              {running} / {cap.cap}
            </span>
          </span>
          <CapCells running={running} cap={cap.cap} />
          <span className="flex items-center gap-1">
            <button type="button" className={STEP} onClick={cap.decrease} disabled={!cap.canDecrease} aria-label={s.queue_cap_decrease}>
              <Minus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" className={STEP} onClick={cap.increase} disabled={!cap.canIncrease} aria-label={s.queue_cap_increase}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        </div>
      </Tooltip>

      <div className="ml-auto flex items-center gap-2">
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
        <InstrumentAutopilot />
        <Tooltip content={s.queue_open_orchestration}>
          <button
            type="button"
            onClick={surface.openOrchestration}
            aria-label={s.queue_open_orchestration}
            data-testid="fleet-grid-orchestration"
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-interactive border border-primary/10 bg-foreground/[0.02] text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <ListOrdered className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
        <SimulationToggle />
      </div>
    </div>
  );
}
