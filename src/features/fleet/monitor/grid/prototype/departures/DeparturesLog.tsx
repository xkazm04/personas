// Departures · DeparturesLog — the rail as a Log. PROTOTYPE (variant C).
//
// Text tabs with an underline, counts in tabular numerals; a scope line when a
// project section has narrowed it; the same three feeds, virtualised, with the
// variant's own two-line ledger entry.

import { useCallback } from 'react';
import { AlertCircle, Inbox, MessagesSquare, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { RailList } from '../../rail/RailList';
import type { RailRow } from '../../rail/railModel';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { RailResizeHandle } from '../../rail/RailChrome';
import { useRailWidth } from '../../rail/useRailWidth';
import type { RailProjectFilter } from '../../rail/railFilter';
import type { RailSurface } from '../useRailSurface';
import { LogRow, logRowHeight } from './LogRow';

export function DeparturesLog({
  rail, scope, onClearScope,
}: {
  rail: RailSurface;
  scope: RailProjectFilter | null;
  onClearScope: () => void;
}) {
  const { t, tx } = useTranslation();
  const width = useRailWidth();
  const w = width.width;
  const { tab, act, dispatchCtl } = rail;

  const heightOf = useCallback((row: RailRow) => logRowHeight(row, w), [w]);
  const renderRow = useCallback((row: RailRow) => (
    <LogRow
      row={row}
      height={logRowHeight(row, w)}
      selected={row.selectable ? dispatchCtl.selected.has(row.id) : undefined}
      onToggle={row.selectable ? dispatchCtl.toggle : undefined}
      onOpen={row.selectable ? undefined : act.openRow}
      onAccept={row.decidable ? act.acceptRow : undefined}
      onReject={row.decidable ? act.rejectRow : undefined}
    />
  ), [w, dispatchCtl.selected, dispatchCtl.toggle, act.openRow, act.acceptRow, act.rejectRow]);

  return (
    <div className="flex min-h-0 flex-shrink-0" style={{ width: w }}>
      <RailResizeHandle rail={width} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="activity-rail" data-simulated={rail.simulated || undefined}>
        <div className="flex h-10 flex-shrink-0 items-end gap-4 border-b border-border px-3" role="group" aria-label={t.monitor.grid_rail_tabs_aria}>
          {rail.tabs.map((v) => {
            const on = tab === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => rail.setTab(v.id)}
                aria-pressed={on}
                data-testid={`activity-rail-tab-${v.id}`}
                className={`focus-ring -mb-px inline-flex items-baseline gap-1.5 border-b-2 pb-1.5 transition-colors ${
                  on ? 'border-primary text-foreground' : 'border-transparent text-foreground opacity-55 hover:opacity-90'
                }`}
              >
                <span className="typo-label uppercase tracking-wide">{v.label}</span>
                <span className={`typo-data tabular-nums ${on ? 'text-primary' : ''}`}>{v.count}</span>
              </button>
            );
          })}
        </div>
        {scope && (
          <div className="flex h-7 flex-shrink-0 items-center gap-2 border-b border-border/60 px-3">
            <span aria-hidden className="h-1.5 w-1.5 rounded-none bg-primary" />
            <span className="min-w-0 flex-1 truncate typo-caption text-foreground">
              {tx(t.monitor.grid_rail_scoped_to, { project: scope.label })}
            </span>
            <Tooltip content={t.monitor.grid_rail_scope_clear}>
              <button
                type="button"
                onClick={onClearScope}
                aria-label={t.monitor.grid_rail_scope_clear}
                data-testid="activity-rail-scope-clear"
                className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded-interactive text-foreground opacity-60 hover:opacity-100"
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
          heightOf={heightOf}
          renderRow={renderRow}
          hasMore={rail.active.hasMore}
          loading={rail.active.loading}
          onEndReached={rail.active.loadMore}
          testId={`activity-rail-list-${tab}`}
          empty={
            <div className="px-3 py-8">
              <EmptyIllustration
                icon={tab === 'messages' ? MessagesSquare : tab === 'dispatch' ? Inbox : AlertCircle}
                heading={rail.empty[tab].heading}
                description={rail.empty[tab].description}
              />
            </div>
          }
        />
      </div>
    </div>
  );
}
