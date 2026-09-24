// InstrumentRail — the "signal log". Three annunciator tabs (reviews,
// dispatch, messages) with mono counts, the project scope as a mono chip, and
// the virtualised list of log lines. Same feeds, verbs and modals as the
// baseline rail (`useRailSurface`); only the pixels are new.

import { useCallback, useMemo } from 'react';
import { AlertCircle, Inbox, MessagesSquare, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
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
        <div role="tablist" className="flex flex-shrink-0 border-b border-primary/10">
          {rail.tabs.map((spec) => {
            const on = spec.id === tab;
            const Icon = spec.icon;
            return (
              <button
                key={spec.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => rail.setTab(spec.id)}
                data-testid={`activity-rail-tab-${spec.id}`}
                className={`focus-ring relative flex flex-1 items-center justify-center gap-1.5 px-2 pb-2 pt-2.5 transition-colors ${
                  on ? 'bg-primary/[0.07] text-primary' : 'text-foreground hover:bg-foreground/[0.04]'
                }`}
              >
                {on && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-primary" style={glow('running', 6)} />}
                <Icon className="h-4 w-4" aria-hidden />
                <span className="typo-label uppercase tracking-wider">{spec.label}</span>
                <span className={`typo-code tabular-nums ${on ? '' : 'opacity-60'}`}>{spec.count}</span>
              </button>
            );
          })}
        </div>

        {scope && (
          <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-primary/10 bg-primary/[0.05] px-3">
            <span className="min-w-0 flex-1 truncate typo-code text-primary">
              {tx(t.monitor.grid_rail_scoped_to, { project: scope.label })}
            </span>
            <Tooltip content={t.monitor.grid_rail_scope_clear}>
              <button type="button" onClick={onClearScope} aria-label={t.monitor.grid_rail_scope_clear} className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-interactive text-foreground hover:bg-secondary/40">
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
      {rail.modals}
    </div>
  );
}
