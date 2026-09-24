// The side wall of the room: what feeds it (Supply) over what it asks of the
// operator (Intake). The intake's three feeds are tabs whose counts are drawn
// at data size, so the backlog's weight reads before its titles do; the list
// is the shared virtualised RailList with this entry's own row.

import { useCallback } from 'react';
import { AlertCircle, Inbox, MessagesSquare, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { Button } from '@/features/shared/components/buttons';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { RailList } from '../../rail/RailList';
import type { RailRow } from '../../rail/railModel';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { RailResizeHandle } from '../../rail/RailChrome';
import { useRailWidth } from '../../rail/useRailWidth';
import type { RailProjectFilter } from '../../rail/railFilter';
import type { RailSurface } from '../useRailSurface';
import type { UsageFeed } from '../useUsageFeed';
import { SupplyPanel } from './SupplyPanel';
import { IntakeRow, intakeHeight } from './IntakeRow';

const EMPTY_ICON = { reviews: AlertCircle, dispatch: Inbox, messages: MessagesSquare } as const;

function KeyHints() {
  const { t, tx } = useTranslation();
  const k = (key: string) => <kbd className="ed-kbd rounded-input typo-caption text-foreground">{key}</kbd>;
  return (
    <div className="flex h-9 flex-shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-border px-3 typo-caption" data-testid="entry-d-keys">
      <span className="flex items-center gap-1">{k('A')} {tx(t.monitor.grid_rail_accept_aria, { title: '' }).trim()}</span>
      <span className="flex items-center gap-1">{k('R')} {t.common.reject}</span>
      <span className="flex items-center gap-1">{k('↵')} {t.monitor.grid_menu_open}</span>
      <span className="flex items-center gap-1">{k('↑')}{k('↓')}</span>
    </div>
  );
}

export function SidePanel({ rail, usage, scope, onClearScope }: {
  rail: RailSurface;
  usage: UsageFeed;
  scope: RailProjectFilter | null;
  onClearScope: () => void;
}) {
  const { t, tx } = useTranslation();
  const width = useRailWidth({ storageKey: 'personas.entry-d.side-width', defaultWidth: 420 });
  const { act, dispatchCtl, tab } = rail;

  const renderRow = useCallback((row: RailRow) => (
    <IntakeRow
      row={row}
      selected={row.selectable ? dispatchCtl.selected.has(row.id) : undefined}
      onToggle={row.selectable ? dispatchCtl.toggle : undefined}
      onOpen={row.selectable ? undefined : act.openRow}
      onAccept={row.decidable ? act.acceptRow : undefined}
      onReject={row.decidable ? act.rejectRow : undefined}
    />
  ), [dispatchCtl.selected, dispatchCtl.toggle, act.openRow, act.acceptRow, act.rejectRow]);

  return (
    <div className="relative z-10 flex min-h-0 flex-shrink-0" style={{ width: width.width }}>
      <RailResizeHandle rail={width} />
      <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-background/40" data-testid="activity-rail" data-simulated={rail.simulated || undefined}>
        <SupplyPanel usage={usage} />
        <div className="flex h-14 flex-shrink-0 items-stretch border-b border-border" role="group" aria-label={t.monitor.grid_rail_tabs_aria}>
          {rail.tabs.map((v) => {
            const on = tab === v.id;
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => rail.setTab(v.id)}
                aria-pressed={on}
                data-testid={`activity-rail-tab-${v.id}`}
                className={`focus-ring relative flex min-w-0 flex-1 flex-col items-start justify-center px-3 transition-colors ${
                  on ? 'bg-primary/10' : 'hover:bg-foreground/[0.04]'
                }`}
              >
                <span className={`typo-data-lg tabular-nums ${on ? 'text-primary' : 'text-foreground'}`}>{v.count}</span>
                <span className="flex items-center gap-1 typo-caption"><Icon className="h-3 w-3" aria-hidden />{v.label}</span>
                {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
              </button>
            );
          })}
        </div>
        {scope && (
          <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border bg-primary/[0.07] px-3">
            <span aria-hidden className="ed-lamp" data-lamp="live" />
            <span className="min-w-0 flex-1 truncate typo-caption text-foreground">{tx(t.monitor.grid_rail_scoped_to, { project: scope.label })}</span>
            <Tooltip content={t.monitor.grid_rail_scope_clear}>
              <Button variant="ghost" size="icon-sm" onClick={onClearScope} aria-label={t.monitor.grid_rail_scope_clear}
                data-testid="activity-rail-scope-clear" icon={<X className="h-3.5 w-3.5" aria-hidden />} />
            </Tooltip>
          </div>
        )}
        {tab === 'dispatch' && !rail.simulated && <DeckDispatchBar ctl={dispatchCtl} />}
        {tab === 'messages' && (
          <RailThreadFilter showAll={rail.showAllThreads} onChange={rail.setShowAllThreads} hidden={rail.hiddenThreads} />
        )}
        <RailList
          key={rail.listKey}
          rows={rail.active.rows}
          heightOf={intakeHeight}
          renderRow={renderRow}
          hasMore={rail.active.hasMore}
          loading={rail.active.loading}
          onEndReached={rail.active.loadMore}
          testId={`activity-rail-list-${tab}`}
          empty={
            <div className="px-4 py-10">
              <EmptyIllustration icon={EMPTY_ICON[tab]} heading={rail.empty[tab].heading} description={rail.empty[tab].description} />
            </div>
          }
        />
        <KeyHints />
      </aside>
    </div>
  );
}
