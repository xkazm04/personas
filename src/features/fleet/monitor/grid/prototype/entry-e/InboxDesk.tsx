// The DESK: everything waiting on a human, at the right edge of the panel.
// Its three tabs are counters - the number is the tab's headline, drawn large -
// and the one lit counter is the tab you are on. A scope set from a bay's
// nameplate shows here as a chip that clears it. The footer prints the keys
// the rows answer to.

import { useCallback } from 'react';
import { AlertCircle, Inbox, MessagesSquare, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { RailList } from '../../rail/RailList';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { RailResizeHandle } from '../../rail/RailChrome';
import type { RailRow } from '../../rail/railModel';
import type { RailProjectFilter } from '../../rail/railFilter';
import type { useRailWidth } from '../../rail/useRailWidth';
import type { RailSurface } from '../useRailSurface';
import { InboxRow, inboxRowHeight } from './InboxRow';
import { ReviewRow, reviewRowHeight } from './ReviewRow';
import { Kbd } from './parts';

export function InboxDesk({
  rail, width, scope, onClearScope, ready,
}: {
  rail: RailSurface;
  width: ReturnType<typeof useRailWidth>;
  scope: RailProjectFilter | null;
  onClearScope: () => void;
  ready: boolean;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { tab, act, dispatchCtl } = rail;

  const renderRow = useCallback((row: RailRow) => tab === 'reviews' ? (
    <ReviewRow row={row} onOpen={act.openRow} onAccept={act.acceptRow} onReject={act.rejectRow} />
  ) : (
    <InboxRow
      row={row}
      selected={row.selectable ? dispatchCtl.selected.has(row.id) : undefined}
      onToggle={row.selectable ? dispatchCtl.toggle : undefined}
      onOpen={row.selectable ? undefined : act.openRow}
      onAccept={row.decidable ? act.acceptRow : undefined}
      onReject={row.decidable ? act.rejectRow : undefined}
    />
  ), [tab, dispatchCtl.selected, dispatchCtl.toggle, act.openRow, act.acceptRow, act.rejectRow]);

  const EmptyIcon = tab === 'messages' ? MessagesSquare : tab === 'dispatch' ? Inbox : AlertCircle;

  return (
    <div className="flex min-h-0 flex-shrink-0" style={{ width: width.width }}>
      <RailResizeHandle rail={width} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="activity-rail" data-simulated={rail.simulated || undefined}>
        <div className="grid flex-shrink-0 grid-cols-3 gap-1.5 border-b border-border p-2" role="group" aria-label={m.grid_rail_tabs_aria}>
          {rail.tabs.map((spec) => {
            const on = tab === spec.id;
            const Icon = spec.icon;
            return (
              <Button
                key={spec.id}
                variant="ghost"
                onClick={() => rail.setTab(spec.id)}
                aria-pressed={on}
                data-testid={`activity-rail-tab-${spec.id}`}
                className={`ae-win ae-focus min-w-0 rounded-input px-2.5 py-1.5 text-left [&>span]:flex [&>span]:min-w-0 [&>span]:flex-col [&>span]:items-start [&>span]:gap-0.5 ${on ? 'is-lit ae-t-run' : ''}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground">
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                  <span className="truncate">{spec.label}</span>
                </span>
                <span className="typo-data-lg tabular-nums text-foreground"><Numeric value={spec.count} /></span>
              </Button>
            );
          })}
        </div>

        {scope && (
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-primary/30 bg-primary/[0.08] px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate typo-caption text-foreground">{tx(m.grid_rail_scoped_to, { project: scope.label })}</span>
            <Tooltip content={m.grid_rail_scope_clear}>
              <Button variant="ghost" size="icon-sm" onClick={onClearScope} aria-label={m.grid_rail_scope_clear} data-testid="activity-rail-scope-clear" icon={<X className="h-3.5 w-3.5" />} />
            </Tooltip>
          </div>
        )}

        {tab === 'dispatch' && !rail.simulated && <DeckDispatchBar ctl={dispatchCtl} />}
        {tab === 'messages' && (
          <RailThreadFilter showAll={rail.showAllThreads} onChange={rail.setShowAllThreads} hidden={rail.hiddenThreads} />
        )}

        {ready ? (
          <RailList
            key={rail.listKey}
            rows={rail.active.rows}
            heightOf={tab === 'reviews' ? reviewRowHeight : inboxRowHeight}
            renderRow={renderRow}
            hasMore={rail.active.hasMore}
            loading={rail.active.loading}
            onEndReached={rail.active.loadMore}
            testId={`activity-rail-list-${tab}`}
            empty={
              <div className="px-3 py-10">
                <EmptyIllustration icon={EmptyIcon} heading={rail.empty[tab].heading} description={rail.empty[tab].description} />
              </div>
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="ae-ghost h-[76px] rounded-input" />)}
          </div>
        )}

        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 typo-caption" aria-hidden>
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd>{t.common.command_palette_select}</span>
          {tab === 'reviews' && (
            <>
              <span className="flex items-center gap-1"><Kbd>A</Kbd>{m.approve}</span>
              <span className="flex items-center gap-1"><Kbd>R</Kbd>{t.common.reject}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
