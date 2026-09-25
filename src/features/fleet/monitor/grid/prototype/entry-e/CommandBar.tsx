// The ONE band of chrome above the panel. Left, the census: every agent in the
// fleet counted by lamp, and each lamp is the filter for its own number
// (pressing it again, or Clear, lets go). Right, the layout switch and the
// keyboard walk printed as keycaps, so the shortcut that exists is one the
// operator can see. Sessions are counted in the supply column, never here:
// this band counts AGENTS, and says so.
//
// The layout switch's panel is the floor below. It is declared HERE
// (`CommandFloor`), beside the strip, so the ids the tabs point at and the
// region carrying them are built in one file; the entry only places it.

import type { ReactNode } from 'react';
import { Activity, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { Button } from '@/features/shared/components/buttons';
import { SimulationToggle } from '../../simulation';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { BOARD_VARIANTS, type BoardVariant } from '../../board/queue/boardVariant';
import { PERSONA_LAMP } from './tone';
import { Kbd, Lamp } from './parts';

export function CommandBar({
  totals, showTally, active, onPick, onClear, layout, onLayout, agentCount,
}: {
  totals: Record<SquareState, number>;
  showTally: boolean;
  active: SquareState | null;
  onPick: (s: SquareState) => void;
  onClear: () => void;
  layout: BoardVariant;
  onLayout: (v: BoardVariant) => void;
  agentCount: number;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const labels: Record<SquareState, string> = {
    running: m.grid_state_running,
    attention: m.grid_state_attention,
    failed: m.grid_state_failed,
    idle: m.grid_state_idle,
  };
  const layoutLabel: Record<BoardVariant, string> = {
    classic: m.board_variant_classic,
    runway: m.board_variant_runway,
    lanes: m.board_variant_lanes,
  };

  return (
    <div className="flex min-h-[52px] flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2" data-testid="entry-e-command">
      <span className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
          <Activity className="h-4 w-4 text-primary" aria-hidden />
        </span>
        <span className="typo-heading text-foreground">{m.activity_mode}</span>
      </span>

      {showTally && (
        <div className="flex items-center gap-1" role="group" aria-label={t.sidebar.agents} data-testid="fleet-grid-tally">
          <span className="mr-1 typo-caption tabular-nums">{tx(t.common.agent_count_other, { count: agentCount })}</span>
          {SQUARE_STATE_ORDER.map((s) => {
            const on = active === s;
            const lamp = PERSONA_LAMP[s];
            return (
              <Button
                key={s}
                variant="ghost"
                size="sm"
                onClick={() => onPick(s)}
                aria-pressed={on}
                aria-label={tx(m.grid_filter_state_aria, { state: labels[s] })}
                data-testid={`fleet-grid-tally-${s}`}
                className={`ae-win ae-focus rounded-input px-2.5 py-1 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-2 ${
                  on ? 'is-selected' : ''} ${lamp.lit && totals[s] > 0 ? `is-lit ae-t-${lamp.tone}` : ''}`}
              >
                <Lamp lamp={{ tone: lamp.tone, lit: lamp.lit && totals[s] > 0 }} />
                <span className="typo-caption text-foreground">{labels[s]}</span>
                <span className="typo-data tabular-nums text-foreground">{totals[s]}</span>
              </Button>
            );
          })}
          {active && (
            <Button variant="ghost" size="sm" onClick={onClear} icon={<X className="h-3.5 w-3.5" />} data-testid="entry-e-filter-clear">
              {t.common.clear}
            </Button>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden items-center gap-1.5 typo-caption xl:flex" aria-hidden>
          <Kbd>n</Kbd><Kbd>k</Kbd>
          <span>{t.common.command_palette_navigate}</span>
          <Kbd>↵</Kbd>
          <span>{t.common.command_palette_select}</span>
        </span>
        <SegmentedTabs
          size="sm"
          variant="segment"
          fullWidth={false}
          ariaLabel={m.board_variant_aria}
          idPrefix={BOARD_TABS_PREFIX}
          activeTab={layout}
          onTabChange={onLayout}
          tabs={BOARD_VARIANTS.map((id) => ({ id, label: layoutLabel[id], testId: `fleet-board-variant-${id}` }))}
        />
        <SimulationToggle />
      </div>
    </div>
  );
}

/**
 * The floor: the panel the layout switch above controls. The id and
 * `aria-labelledby` come from `segmentedTabPanelProps` on the prefix the
 * strip was given; `role="tabpanel"` is written out as well, where a reader
 * can see it, although the spread already carries it.
 */
export function CommandFloor({ layout, className, children }: {
  layout: BoardVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main {...segmentedTabPanelProps(BOARD_TABS_PREFIX, layout)} role="tabpanel" className={className}>
      {children}
    </main>
  );
}
