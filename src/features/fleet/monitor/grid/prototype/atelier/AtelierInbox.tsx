// Atelier inbox — the rail as a calm side surface. Pill tabs with counts on
// top, a soft scope chip when a project card narrowed it, then roomy rows in
// the shared virtualised list. Dispatch keeps its selection bar; Messages
// keeps its unread / all filter. The modals mount here, once.

import { useCallback } from 'react';
import { AlertCircle, Inbox, MessagesSquare, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { RailList } from '../../rail/RailList';
import type { RailRow } from '../../rail/railModel';
import type { RailProjectFilter } from '../../rail/railFilter';
import { RailResizeHandle } from '../../rail/RailChrome';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { useRailWidth } from '../../rail/useRailWidth';
import type { RailSurface } from '../useRailSurface';
import { InboxRow, inboxRowHeight } from './InboxRow';

export function AtelierInbox({
  rail, scope, onClearScope,
}: {
  rail: RailSurface;
  scope: RailProjectFilter | null;
  onClearScope: () => void;
}) {
  const { t, tx } = useTranslation();
  const width = useRailWidth();
  const { tab, act, dispatchCtl } = rail;

  const renderRow = useCallback((row: RailRow) => (
    <div className="px-1.5 py-0.5">
      <InboxRow
        row={row}
        selected={row.selectable ? dispatchCtl.selected.has(row.id) : undefined}
        onToggle={row.selectable ? dispatchCtl.toggle : undefined}
        onOpen={row.selectable ? undefined : act.openRow}
        onAccept={row.decidable ? act.acceptRow : undefined}
        onReject={row.decidable ? act.rejectRow : undefined}
      />
    </div>
  ), [dispatchCtl.selected, dispatchCtl.toggle, act.openRow, act.acceptRow, act.rejectRow]);

  return (
    <div className="flex min-h-0 flex-shrink-0" style={{ width: width.width }}>
      <RailResizeHandle rail={width} />
      <aside className="my-2 mr-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card bg-secondary/20 shadow-elevation-1" data-testid="activity-rail" data-simulated={rail.simulated || undefined}>
        <div className="flex flex-shrink-0 items-center gap-1 p-2" role="group" aria-label={t.monitor.grid_rail_tabs_aria}>
          {rail.tabs.map((v) => {
            const Icon = v.icon;
            const on = tab === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => rail.setTab(v.id)}
                aria-pressed={on}
                data-testid={`activity-rail-tab-${v.id}`}
                className={`focus-ring inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-pill px-2 typo-caption transition-colors ${
                  on ? 'bg-background/80 text-foreground shadow-elevation-1' : 'text-foreground opacity-60 hover:opacity-100'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                <span className="truncate">{v.label}</span>
                {v.count > 0 && (
                  <span className={`rounded-pill px-1.5 typo-label tabular-nums ${on ? 'bg-primary/15 text-primary' : 'bg-secondary/50'}`}>{v.count}</span>
                )}
              </button>
            );
          })}
        </div>

        {scope && (
          <div className="mx-2 mb-1 flex flex-shrink-0 items-center gap-2 rounded-pill bg-primary/10 py-1 pl-3 pr-1 typo-caption text-foreground">
            <span className="min-w-0 flex-1 truncate">{tx(t.monitor.grid_rail_scoped_to, { project: scope.label })}</span>
            <Tooltip content={t.monitor.grid_rail_scope_clear}>
              <button
                type="button"
                onClick={onClearScope}
                aria-label={t.monitor.grid_rail_scope_clear}
                data-testid="activity-rail-scope-clear"
                className="focus-ring inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-pill text-foreground opacity-70 hover:bg-secondary/50 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
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
          heightOf={inboxRowHeight}
          renderRow={renderRow}
          hasMore={rail.active.hasMore}
          loading={rail.active.loading}
          onEndReached={rail.active.loadMore}
          testId={`activity-rail-list-${tab}`}
          empty={
            <div className="px-4 py-10">
              <EmptyIllustration
                icon={tab === 'messages' ? MessagesSquare : tab === 'dispatch' ? Inbox : AlertCircle}
                heading={rail.empty[tab].heading}
                description={rail.empty[tab].description}
              />
            </div>
          }
        />
      </aside>
      {rail.modals}
    </div>
  );
}
