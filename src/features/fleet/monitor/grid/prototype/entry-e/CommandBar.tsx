// The ONE band of chrome above the panel. Left, the census: every agent in the
// fleet counted by lamp, and each lamp is the filter for its own number.
// Right, the layout switch and the keyboard walk printed as keycaps, so the
// shortcut that exists is one the operator can see.
//
// ALL IS A STATE, NOT A VERB (2026-10-04). The band used to print "N agents ·
// M sessions" as a label and grow a Clear button once a tag was pressed — two
// different grammars for one fact, and the undo appeared only after the
// mistake. `All` is now simply the first tag: same window, same lamp, same
// count (every agent and session the layout can show), and it is the one that
// is lit while nothing is filtered. Letting go is pressing a tag, exactly like
// choosing one.

import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SimulationToggle } from '../../simulation';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { BOARD_VARIANTS, type BoardVariant } from '../../board/queue/boardVariant';
import { PERSONA_LAMP } from './tone';
import { Kbd, Lamp } from './parts';
import type { PanelFilter } from './boardFilter';

export function CommandBar({
  filter, showTally, active, onPick, onClear, layout, onLayout,
}: {
  /** Counts per state over what the current layout can show (agents + sessions). */
  filter: PanelFilter;
  showTally: boolean;
  active: SquareState | null;
  onPick: (s: SquareState) => void;
  onClear: () => void;
  layout: BoardVariant;
  onLayout: (v: BoardVariant) => void;
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
    lanes: m.board_variant_lanes,
  };

  return (
    <div className="flex min-h-[52px] flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2" data-testid="entry-e-command">
      <Tooltip content={m.activity_mode}>
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10" role="img" aria-label={m.activity_mode}>
          <Activity className="h-4 w-4 text-primary" aria-hidden />
        </span>
      </Tooltip>

      {showTally && (
        <div className="flex items-center gap-1" role="group" aria-label={t.sidebar.agents} data-testid="fleet-grid-tally">
          <Tooltip content={`${t.common.all}: ${tx(t.common.agent_count_other, { count: filter.agentTotal })} · ${filter.sessionTotal} ${filter.sessionTotal === 1 ? 'session' : 'sessions'}`}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              aria-pressed={active === null}
              data-testid="fleet-grid-tally-all"
              className={`ae-win ae-focus rounded-input px-2.5 py-1 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-2 ${
                active === null ? 'is-selected is-lit ae-t-run' : 'ae-t-off'}`}
            >
              <Lamp lamp={{ tone: 'run', lit: active === null }} />
              <span className="typo-caption text-foreground">{t.common.all}</span>
              <span className="typo-data tabular-nums text-foreground">{filter.agentTotal + filter.sessionTotal}</span>
            </Button>
          </Tooltip>
          {SQUARE_STATE_ORDER.map((s) => {
            const on = active === s;
            const lamp = PERSONA_LAMP[s];
            const c = filter.counts[s];
            const total = c.agents + c.sessions;
            return (
              <Tooltip key={s} content={`${labels[s]}: ${tx(t.common.agent_count_other, { count: c.agents })} · ${c.sessions} ${c.sessions === 1 ? 'session' : 'sessions'}`}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPick(s)}
                aria-pressed={on}
                aria-label={tx(m.grid_filter_state_aria, { state: labels[s] })}
                data-testid={`fleet-grid-tally-${s}`}
                className={`ae-win ae-focus rounded-input px-2.5 py-1 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-2 ${
                  on ? 'is-selected' : ''} ${lamp.lit && total > 0 ? `is-lit ae-t-${lamp.tone}` : ''}`}
              >
                <Lamp lamp={{ tone: lamp.tone, lit: lamp.lit && total > 0 }} />
                <span className="typo-caption text-foreground">{labels[s]}</span>
                <span className="typo-data tabular-nums text-foreground">{total}</span>
              </Button>
              </Tooltip>
            );
          })}
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

/* THE FILTER BANNER IS GONE (2026-10-04). It restated the active tag in a
   strip of its own and carried a second Clear — a whole row of the panel for
   a fact the tag above already shows lit and pressed, with `All` beside it as
   the undo. The row went to the workspace notepad. */

/**
 * The floor: the panel the layout switch above controls. It is declared here,
 * beside the strip, so the ids the tabs point at and the region carrying them
 * are built in one file; the entry only places it.
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
