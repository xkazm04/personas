// InstrumentRail — the "signal log". Three annunciator tabs (reviews,
// dispatch, messages) with mono counts, the project scope as a mono chip, and
// the virtualised list of log lines. Same feeds, verbs and modals as the
// baseline rail (`useRailSurface`); only the pixels are new.
//
// The tabs are a real tablist: each tab names the region below it, which is
// declared as their tabpanel (scope chip, the tab's own bar, and the list).

import { useCallback, useMemo } from 'react';
import { AlertCircle, Inbox, MessagesSquare, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { RailList } from '../../rail/RailList';
import { RailResizeHandle } from '../../rail/RailChrome';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { useRailWidth } from '../../rail/useRailWidth';
import type { RailRow } from '../../rail/railModel';
import type { RailProjectFilter } from '../../rail/railFilter';
import type { RailSurface } from '../useRailSurface';
import { InstrumentRailRow, railRowHeightFor } from './InstrumentRailRow';
import { glow } from './parts';

const RAIL_TABS_PREFIX = 'instrument-rail';

export function InstrumentRail({ rail, scope, onClearScope }: {
  rail: RailSurface;
  scope: RailProjectFilter | null;
  onClearScope: () => void;
}) {
  const { t, tx } = useTranslation();
  const width = useRailWidth();
  const heightOf = useMemo(() => railRowHeightFor(width.width), [width.width]);
  const { tab, act, dispatchCtl } = rail;

  const renderRow = useCallback((row: RailRow) => (
    <InstrumentRailRow
      row={row}
      height={heightOf(row)}
      selected={row.selectable ? dispatchCtl.selected.has(row.id) : undefined}
      onToggle={row.selectable ? dispatchCtl.toggle : undefined}
      onOpen={row.selectable ? undefined : act.openRow}
      onAccept={row.decidable ? act.acceptRow : undefined}
      onReject={row.decidable ? act.rejectRow : undefined}
    />
  ), [heightOf, dispatchCtl.selected, dispatchCtl.toggle, act.openRow, act.acceptRow, act.rejectRow]);

  return (
    <div className="flex min-h-0 flex-shrink-0" style={{ width: width.width }}>
      <RailResizeHandle rail={width} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background/40" data-testid="activity-rail" data-simulated={rail.simulated || undefined}>
        <div role="tablist" aria-label={t.monitor.grid_rail_tabs_aria} className="flex flex-shrink-0 border-b border-primary/10">
          {rail.tabs.map((spec) => {
            const on = spec.id === tab;
            const Icon = spec.icon;
            return (
              <Button
                key={spec.id}
                variant="ghost"
                role="tab"
                id={`${RAIL_TABS_PREFIX}-tab-${spec.id}`}
                aria-controls={`${RAIL_TABS_PREFIX}-panel-${spec.id}`}
                aria-selected={on}
                onClick={() => rail.setTab(spec.id)}
                data-testid={`activity-rail-tab-${spec.id}`}
                className={`relative flex-1 justify-center rounded-none px-2 pb-2 pt-2.5 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 ${
                  on ? 'bg-primary/[0.07] text-primary' : ''
                }`}
              >
                {on && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-primary" style={glow('running', 6)} />}
                <Icon className="h-4 w-4" aria-hidden />
                <span className="typo-label uppercase tracking-wider">{spec.label}</span>
                <span className={`typo-code tabular-nums ${on ? '' : 'opacity-60'}`}>{spec.count}</span>
              </Button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`${RAIL_TABS_PREFIX}-panel-${tab}`}
          aria-labelledby={`${RAIL_TABS_PREFIX}-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {scope && (
            <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-primary/10 bg-primary/[0.05] px-3">
              <span className="min-w-0 flex-1 truncate typo-code text-primary">
                {tx(t.monitor.grid_rail_scoped_to, { project: scope.label })}
              </span>
              <Tooltip content={t.monitor.grid_rail_scope_clear}>
                <Button variant="ghost" size="icon-sm" onClick={onClearScope} aria-label={t.monitor.grid_rail_scope_clear}
                  icon={<X className="h-3.5 w-3.5" aria-hidden />} />
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
      {rail.modals}
    </div>
  );
}
