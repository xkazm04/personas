// The chrome both layer variants share: the workspace switcher, the fleet
// tally, and the decision dock.
//
// THE DECISION DOCK IS THE POINT. Baseline and the Annunciator both keep the
// reviews/dispatch/messages list open at the right edge for the whole session,
// which spends a permanent column of the surface on a list you read a few times
// an hour. Here the rail is a STATISTIC at rest — three counts and nothing else
// — and the list is a layer you open over the board when you want to work it.
// The counts stay live while it is shut, so closing it never means losing
// track of what is waiting.

import { useCallback } from 'react';
import { AlertCircle, Inbox, MessagesSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Drawer } from '@/features/shared/components/kit';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { RailList } from '../../rail/RailList';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { RailRowView, railRowHeight } from '../../rail/RailRowView';
import type { RailRow } from '../../rail/railModel';
import type { RailSurface } from '../useRailSurface';
import { SQUARE_STATE_ORDER, SQUARE_VISUAL, type SquareState } from '../../fleetGridModel';
import type { FleetLayers } from './useFleetLayers';

/** The tab-strip id prefixes. A strip and the panel it controls have to agree
 *  on these, and the panel is drawn by the variant rather than here, so the
 *  prefix is shared rather than spelled twice. */
export const WORKSPACE_TABS_PREFIX = 'layers-workspace';
export const DECISION_TABS_PREFIX = 'layers-decision';

/** The workspace switcher: one case per workspace, in the top-left corner of
 *  the surface, with the count of what that workspace owes a human on the tab.
 *  A dropdown would scale further, but the real fleets here hold a handful of
 *  workspaces and a visible row of cases is one click rather than two. */
export function WorkspaceCases({ layers }: { layers: FleetLayers }) {
  const { t } = useTranslation();
  const tabs = [
    { id: '__all__', label: t.monitor.layers_all_workspaces, testId: 'layers-workspace-all' },
    ...layers.workspaces.map((w) => ({
      id: w.workspaceId,
      label: w.needsYou > 0 ? `${w.name} · ${w.needsYou}` : w.name,
      testId: `layers-workspace-${w.workspaceId}`,
    })),
  ];
  return (
    <SegmentedTabs
      size="sm"
      variant="segment"
      fullWidth={false}
      ariaLabel={t.monitor.layers_workspace_aria}
      idPrefix={WORKSPACE_TABS_PREFIX}
      activeTab={layers.workspaceId ?? '__all__'}
      onTabChange={(id) => layers.setWorkspaceId(id === '__all__' ? null : id)}
      tabs={tabs}
    />
  );
}

/** The state key as count pills — the same four states, the same colours and
 *  the same filter behaviour the production header already gives the board, so
 *  a layer variant never invents a second vocabulary for the same facts. */
export function FleetTally({
  totals, active, onPick,
}: {
  totals: Record<SquareState, number>;
  active: SquareState | null;
  onPick: (s: SquareState) => void;
}) {
  const { t, tx } = useTranslation();
  const labels: Record<SquareState, string> = {
    running: t.monitor.grid_state_running,
    attention: t.monitor.grid_state_attention,
    failed: t.monitor.grid_state_failed,
    idle: t.monitor.grid_state_idle,
  };
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5" data-testid="layers-tally">
      {SQUARE_STATE_ORDER.map((s) => (
        <Button
          key={s}
          variant="ghost"
          size="xs"
          onClick={() => onPick(s)}
          aria-pressed={active === s}
          aria-label={tx(t.monitor.grid_filter_state_aria, { state: labels[s] })}
          data-testid={`layers-tally-${s}`}
          className={`rounded-full border px-2 py-0.5 ${
            active === s ? 'border-primary/60 bg-primary/15' : 'border-border bg-secondary/20 hover:border-primary/30'
          }`}
        >
          <span className="flex items-center gap-1.5 typo-caption text-foreground">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${SQUARE_VISUAL[s].accent} ${SQUARE_VISUAL[s].pulse ? 'animate-pulse' : ''}`} />
            <span>{labels[s]}</span>
            <span className="tabular-nums"><Numeric value={totals[s]} /></span>
          </span>
        </Button>
      ))}
    </div>
  );
}

/**
 * The decision dock at rest: three live counts, one button. Pressing it (or
 * `d`) raises the list over the surface; the surface keeps its own scroll and
 * its own selection underneath, which is the whole reason this is a layer and
 * not a route.
 */
export function DecisionDock({
  rail, open, onOpen,
}: {
  rail: RailSurface;
  open: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const total = rail.tabs.reduce((n, s) => n + s.count, 0);
  return (
    <Tooltip content={t.monitor.layers_decisions_aria}>
      <Button
        variant="ghost"
        onClick={onOpen}
        aria-expanded={open}
        data-testid="layers-decision-dock"
        className={`rounded-interactive border px-2.5 py-1 ${
          total > 0 ? 'border-primary/40 bg-primary/10' : 'border-border bg-secondary/20'
        }`}
      >
        <span className="flex items-center gap-2 typo-caption text-foreground">
          <span className="typo-data-lg tabular-nums"><Numeric value={total} /></span>
          <span>{t.monitor.layers_decisions}</span>
          <span className="flex items-center gap-1.5">
            {rail.tabs.map((spec) => {
              const Icon = spec.icon;
              return (
                <span key={spec.id} className="inline-flex items-center gap-0.5">
                  <Icon className="h-3 w-3" aria-hidden />
                  <span className="tabular-nums"><Numeric value={spec.count} /></span>
                </span>
              );
            })}
          </span>
        </span>
      </Button>
    </Tooltip>
  );
}

/** The decision list itself, as a layer over the board. Rows are the
 *  production `RailRowView` — the rail's row is already the repo's answer to
 *  this list and a prototype has no business restyling it. */
export function DecisionLayer({
  rail, open, onClose,
}: {
  rail: RailSurface;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { tab, act, dispatchCtl } = rail;

  const renderRow = useCallback(
    (row: RailRow) => (
      <RailRowView
        row={row}
        selected={row.selectable ? dispatchCtl.selected.has(row.id) : undefined}
        onToggle={row.selectable ? dispatchCtl.toggle : undefined}
        onOpen={row.selectable ? undefined : act.openRow}
        onAccept={row.decidable ? act.acceptRow : undefined}
        onReject={row.decidable ? act.rejectRow : undefined}
      />
    ),
    [dispatchCtl.selected, dispatchCtl.toggle, act.openRow, act.acceptRow, act.rejectRow],
  );

  const EmptyIcon = tab === 'messages' ? MessagesSquare : tab === 'dispatch' ? Inbox : AlertCircle;

  return (
    <Drawer open={open} onClose={onClose} closeLabel={t.common.close} label={t.monitor.layers_decisions}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex-shrink-0 px-1 pb-2">
          <SegmentedTabs
            size="sm"
            variant="segment"
            ariaLabel={t.monitor.grid_rail_tabs_aria}
            idPrefix={DECISION_TABS_PREFIX}
            activeTab={tab}
            onTabChange={rail.setTab}
            tabs={rail.tabs.map((s) => ({ id: s.id, label: `${s.label} ${s.count}`, testId: `layers-decision-tab-${s.id}` }))}
          />
        </div>
        {tab === 'dispatch' && !rail.simulated && <DeckDispatchBar ctl={dispatchCtl} />}
        {tab === 'messages' && (
          <RailThreadFilter showAll={rail.showAllThreads} onChange={rail.setShowAllThreads} hidden={rail.hiddenThreads} />
        )}
        {/* The panel the strip above controls. Spelled out rather than spread
            from `segmentedTabPanelProps` so the relationship is visible in the
            source as well as at runtime. */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          role="tabpanel"
          id={`${DECISION_TABS_PREFIX}-panel-${tab}`}
          aria-labelledby={`${DECISION_TABS_PREFIX}-tab-${tab}`}
        >
        <RailList
          key={rail.listKey}
          rows={rail.active.rows}
          heightOf={railRowHeight}
          renderRow={renderRow}
          hasMore={rail.active.hasMore}
          loading={rail.active.loading}
          onEndReached={rail.active.loadMore}
          testId={`layers-decision-list-${tab}`}
          empty={
            <div className="px-3 py-10">
              <EmptyIllustration icon={EmptyIcon} heading={rail.empty[tab].heading} description={rail.empty[tab].description} />
            </div>
          }
        />
        </div>
      </div>
    </Drawer>
  );
}
