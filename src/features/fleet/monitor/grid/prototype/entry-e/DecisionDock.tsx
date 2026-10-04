// THE DESK, DOCKED — everything waiting on a human, at the right edge.
//
// Fused at consolidation from the Annunciator's desk (its windows, lamps, rows
// and printed keycaps) and the Plate variant's ONE structural idea: the rail
// rests as three FIGURES and widens in place into the full list, instead of
// spending a permanent column on a list the operator works a few times an hour.
//
// A WIDTH, not an overlay — the board reflows around it, so opening the
// decisions never covers the thing you opened them about. Each resting figure
// is its own door: pressing one opens the desk already on that tab.
//
// "Render the items only when accessed" is real here, not cosmetic: while the
// desk is shut `rowsEnabled` is false and `useRailSurface` adapts NO rows for
// any tab. The counts stay honest regardless — the three feeds never gate the
// queue, subscription or badge they are counted from, only the projection into
// rows (see `useRailFeeds`).

import { useCallback } from 'react';
import { AlertCircle, Inbox, MessagesSquare, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { RailList } from '../../rail/RailList';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { RailResizeHandle, type RailTab } from '../../rail/RailChrome';
import type { RailRow } from '../../rail/railModel';
import type { RailProjectFilter } from '../../rail/railFilter';
import type { useRailWidth } from '../../rail/useRailWidth';
import type { RailSurface } from '../useRailSurface';
import { InboxRow, inboxRowHeight } from './InboxRow';
import { ReviewRow, reviewRowHeight } from './ReviewRow';
import { Kbd, Lamp } from './parts';
import type { Tone } from './tone';

/** The desk's tab, named for its consumers so they need not reach into the
 *  rail's own chrome module for the type. */
export type DockTab = RailTab;

/** Shut, the desk is exactly as wide as three figures need. */
const REST_WIDTH = 108;

/** Each feed's lamp: a decision waiting is amber, a dispatch is the theme
 *  colour, an unread report is information. Dark when the feed is empty. */
const TAB_TONE: Record<RailTab, Tone> = { reviews: 'warn', dispatch: 'run', messages: 'info' };

export function DecisionDock({
  rail, width, open, onToggle, onOpenTab, scope, onClearScope, ready, reducedMotion,
}: {
  rail: RailSurface;
  width: ReturnType<typeof useRailWidth>;
  open: boolean;
  onToggle: () => void;
  onOpenTab: (tab: RailTab) => void;
  scope: RailProjectFilter | null;
  onClearScope: () => void;
  ready: boolean;
  reducedMotion: boolean;
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
    <div className="flex min-h-0 flex-shrink-0">
      {open && <RailResizeHandle rail={width} />}
      <motion.div
        animate={{ width: open ? width.width : REST_WIDTH }}
        initial={false}
        transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
        className={`flex min-h-0 min-w-0 flex-col ${open ? '' : 'border-l border-border'}`}
        data-testid="activity-rail"
        data-open={open || undefined}
        data-simulated={rail.simulated || undefined}
      >
        <div className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-border px-2">
          {open && <span className="ae-engrave typo-label min-w-0 flex-1 truncate">{m.layers_decisions}</span>}
          <Tooltip content={open ? t.common.close : m.layers_decisions_aria}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={open ? '' : 'mx-auto'}
              onClick={onToggle}
              aria-expanded={open}
              aria-label={open ? t.common.close : m.layers_decisions_aria}
              data-testid="activity-dock-toggle"
              icon={open ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            />
          </Tooltip>
        </div>

        {open ? (
          <>
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
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5" role="group" aria-label={m.grid_rail_tabs_aria}>
            {rail.tabs.map((spec) => {
              const Icon = spec.icon;
              const tone = TAB_TONE[spec.id];
              return (
                <Tooltip key={spec.id} content={`${spec.label}: ${spec.count}`} placement="left">
                  <Button
                    variant="ghost"
                    onClick={() => onOpenTab(spec.id)}
                    aria-label={`${spec.label}: ${spec.count}`}
                    data-testid={`activity-rail-stat-${spec.id}`}
                    className={`ae-win ae-focus w-full rounded-input px-1.5 py-2 ${spec.count > 0 ? `is-lit ae-t-${tone}` : 'ae-t-off'}`}
                  >
                    <span className="flex w-full flex-col items-center gap-1">
                      <span className="flex items-center gap-1.5">
                        <Lamp lamp={{ tone, lit: spec.count > 0 }} />
                        <Icon className="h-3.5 w-3.5 text-foreground" aria-hidden />
                      </span>
                      <span className="typo-data-lg tabular-nums text-foreground"><Numeric value={spec.count} /></span>
                    </span>
                  </Button>
                </Tooltip>
              );
            })}
            {scope && (
              <Tooltip content={tx(m.grid_rail_scoped_to, { project: scope.label })} placement="left">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClearScope}
                  aria-label={m.grid_rail_scope_clear}
                  data-testid="activity-rail-scope-clear"
                  className="mx-auto"
                  icon={<X className="h-3.5 w-3.5 text-primary" />}
                />
              </Tooltip>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
