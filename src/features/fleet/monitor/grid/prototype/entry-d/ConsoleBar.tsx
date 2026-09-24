// The console: the room's ONE band of chrome. Left, what the agents are
// doing (four lamps that are also the board filter); centre, the rack gauge,
// which is what the sessions are consuming; right, how the room is laid out
// and who runs it (layout, Autopilot, the orchestration ledger). Every control
// here is 32px tall and flat on the band; nothing floats in a pill of its own.

import { useEffect, type KeyboardEvent } from 'react';
import { Bot, Columns3, Kanban, ListOrdered, Server, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { SimulationToggle } from '../../simulation';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { BOARD_VARIANTS, type BoardVariant } from '../../board/queue/boardVariant';
import type { ActivitySurface } from '../useActivitySurface';
import type { useCapSetting } from '../shared';
import { RackGauge } from './RackGauge';
import { AutopilotLamp } from './AutopilotLamp';

const LAYOUT_ICON = { classic: Columns3, runway: Server, lanes: Kanban } as const;

function typingInto(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function StateLamps({ surface }: { surface: ActivitySurface }) {
  const { t, tx } = useTranslation();
  const labels: Record<SquareState, string> = {
    running: t.monitor.grid_state_running,
    attention: t.monitor.grid_state_attention,
    failed: t.monitor.grid_state_failed,
    idle: t.monitor.grid_state_idle,
  };
  if (surface.cold) return <span className="ed-ghost h-4 w-64 rounded-full" aria-hidden />;
  return (
    <div className="flex flex-shrink-0 items-center" data-testid="fleet-grid-tally" role="group" aria-label={t.monitor.grid_board_aria}>
      <Users className="mr-2 h-3.5 w-3.5 text-foreground" aria-hidden />
      {SQUARE_STATE_ORDER.map((st) => {
        const on = surface.filter.state === st;
        return (
          <Tooltip key={st} content={tx(t.monitor.grid_filter_state_aria, { state: labels[st] })} delay={400}>
            <button
              type="button"
              onClick={() => surface.pickState(st)}
              aria-pressed={on}
              aria-label={tx(t.monitor.grid_filter_state_aria, { state: labels[st] })}
              data-testid={`fleet-grid-tally-${st}`}
              className={`focus-ring flex h-8 items-center gap-2 rounded-interactive px-2.5 transition-colors ${
                on ? 'bg-primary/15 text-primary' : 'hover:bg-foreground/[0.05]'
              }`}
            >
              <span aria-hidden data-lamp={st} className={`ed-lamp ${st === 'running' ? 'animate-pulse' : ''}`} />
              <span className="ed-hide-md typo-caption">{labels[st]}</span>
              <span className={`typo-data tabular-nums ${on ? 'text-primary' : 'text-foreground'}`}>{surface.model.totals[st]}</span>
            </button>
          </Tooltip>
        );
      })}
      <Tooltip content={t.monitor.grid_state_attention}>
        <span className="ed-hide-md ml-1 flex items-center gap-0.5" data-testid="entry-d-attention-keys">
          <kbd className="ed-kbd rounded-input typo-caption text-foreground">N</kbd>
          <kbd className="ed-kbd rounded-input typo-caption text-foreground">K</kbd>
        </span>
      </Tooltip>
    </div>
  );
}

function LayoutTabs({ layout, onChange }: { layout: BoardVariant; onChange: (v: BoardVariant) => void }) {
  const { t } = useTranslation();
  const label: Record<BoardVariant, string> = {
    classic: t.monitor.board_variant_classic,
    runway: t.monitor.board_variant_runway,
    lanes: t.monitor.board_variant_lanes,
  };
  // 1 / 2 / 3 switch the layout from anywhere on the surface.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingInto(e.target)) return;
      const v = BOARD_VARIANTS[Number(e.key) - 1];
      if (v) onChange(v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChange]);
  const onArrow = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = BOARD_VARIANTS.indexOf(layout);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = BOARD_VARIANTS[(i + step + BOARD_VARIANTS.length) % BOARD_VARIANTS.length]!;
    onChange(next);
    document.getElementById(`${BOARD_TABS_PREFIX}-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={t.monitor.board_variant_aria} onKeyDown={onArrow}
      className="flex flex-shrink-0 items-center rounded-interactive bg-foreground/[0.04] p-0.5">
      {BOARD_VARIANTS.map((id, i) => {
        const Icon = LAYOUT_ICON[id];
        const on = layout === id;
        return (
          <Tooltip key={id} content={<span>{label[id]} <kbd className="ed-kbd rounded-input typo-caption">{i + 1}</kbd></span>} delay={400}>
            <button
              type="button"
              role="tab"
              id={`${BOARD_TABS_PREFIX}-tab-${id}`}
              aria-controls={`${BOARD_TABS_PREFIX}-panel-${id}`}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(id)}
              data-testid={`fleet-board-variant-${id}`}
              className={`focus-ring flex h-7 items-center gap-1.5 rounded-interactive px-2.5 typo-caption transition-colors ${
                on ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-foreground/[0.05]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="ed-hide-sm">{label[id]}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function ConsoleBar({ surface, cap }: { surface: ActivitySurface; cap: ReturnType<typeof useCapSetting> }) {
  const { t } = useTranslation();
  return (
    <header className="ed-console relative z-10 flex h-14 flex-shrink-0 items-center gap-3 border-b border-border bg-background/40 px-4">
      <div className="flex flex-shrink-0 items-center gap-2">
        <Bot className="h-4 w-4 text-primary" aria-hidden />
        <span className="ed-hide-sm typo-heading text-foreground">{t.monitor.activity_mode}</span>
      </div>
      <span className="h-6 w-px flex-shrink-0 bg-border" aria-hidden />
      <StateLamps surface={surface} />
      <span className="h-6 w-px flex-shrink-0 bg-border" aria-hidden />
      <RackGauge surface={surface} cap={cap} />
      <span className="h-6 w-px flex-shrink-0 bg-border" aria-hidden />
      <LayoutTabs layout={surface.layout} onChange={surface.setLayout} />
      <AutopilotLamp />
      <Tooltip content={t.monitor.queue_open_orchestration}>
        <Button variant="ghost" size="icon-sm" onClick={surface.openOrchestration} aria-label={t.monitor.queue_open_orchestration}
          data-testid="fleet-grid-orchestration" icon={<ListOrdered className="h-4 w-4" aria-hidden />} />
      </Tooltip>
      <SimulationToggle />
    </header>
  );
}
