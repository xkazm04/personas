// THE DOCK — the decision rail as a column that grows, not a panel that is
// always open.
//
// Baseline keeps the reviews/dispatch/messages list expanded at the right edge
// for the whole session, which spends a permanent column on a list you work a
// few times an hour. Here the rail rests as THREE FIGURES and widens in place
// into the full list. A width rather than an overlay, deliberately: the board
// reflows around it, so opening the decisions never covers the thing you opened
// them about. Each resting figure is also its own door — pressing one opens the
// list already on that tab.
//
// Both the tab strip and the panel it controls live in this file, which is what
// lets the pair be read (and gated) as one thing.

import { useCallback } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { RailList } from '../../rail/RailList';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { RailRowView, railRowHeight } from '../../rail/RailRowView';
import type { RailRow } from '../../rail/railModel';
import type { RailSurface } from '../useRailSurface';

const DOCK_TABS_PREFIX = 'cases-dock';
/** At rest the dock is three figures; opened it is the list. */
const REST = '13rem';
const OPEN = '24rem';

export function CasesDock({
  rail, open, onToggle, onOpenTab, reducedMotion,
}: {
  rail: RailSurface;
  open: boolean;
  onToggle: () => void;
  onOpenTab: (tab: RailSurface['tab']) => void;
  reducedMotion: boolean;
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

  return (
    <motion.aside
      animate={{ width: open ? OPEN : REST }}
      initial={false}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
      className="flex min-h-0 flex-shrink-0 flex-col border-l border-border bg-foreground/[0.015]"
      aria-label={t.monitor.layers_decisions}
      data-testid="cases-dock"
      data-open={open || undefined}
    >
      <div className="flex h-9 flex-shrink-0 items-center gap-1.5 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate typo-label text-foreground">{t.monitor.layers_decisions}</span>
        <Tooltip content={open ? t.common.close : t.monitor.layers_decisions_aria}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? t.common.close : t.monitor.layers_decisions_aria}
            data-testid="cases-dock-toggle"
            icon={open ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
          />
        </Tooltip>
      </div>

      {open ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-shrink-0 p-2">
            <SegmentedTabs
              size="sm"
              variant="segment"
              ariaLabel={t.monitor.grid_rail_tabs_aria}
              idPrefix={DOCK_TABS_PREFIX}
              activeTab={tab}
              onTabChange={rail.setTab}
              tabs={rail.tabs.map((s) => ({ id: s.id, label: `${s.label} ${s.count}`, testId: `cases-dock-tab-${s.id}` }))}
            />
          </div>
          {tab === 'dispatch' && !rail.simulated && <DeckDispatchBar ctl={dispatchCtl} />}
          {tab === 'messages' && (
            <RailThreadFilter showAll={rail.showAllThreads} onChange={rail.setShowAllThreads} hidden={rail.hiddenThreads} />
          )}
          {/* The panel the strip above controls, spelled out so the pair is
              visible in the source as well as at runtime. */}
          <div
            className="flex min-h-0 flex-1 flex-col"
            role="tabpanel"
            id={`${DOCK_TABS_PREFIX}-panel-${tab}`}
            aria-labelledby={`${DOCK_TABS_PREFIX}-tab-${tab}`}
          >
            <RailList
              key={rail.listKey}
              rows={rail.active.rows}
              heightOf={railRowHeight}
              renderRow={renderRow}
              hasMore={rail.active.hasMore}
              loading={rail.active.loading}
              onEndReached={rail.active.loadMore}
              testId={`cases-dock-list-${tab}`}
              empty={
                <div className="px-3 py-10">
                  <EmptyIllustration
                    icon={PanelRightOpen}
                    heading={rail.empty[tab].heading}
                    description={rail.empty[tab].description}
                  />
                </div>
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
          {rail.tabs.map((spec) => {
            const Icon = spec.icon;
            return (
              <Button
                key={spec.id}
                variant="ghost"
                onClick={() => onOpenTab(spec.id)}
                data-testid={`cases-dock-stat-${spec.id}`}
                className="rounded-input border border-border px-2 py-1.5 text-left"
              >
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="flex items-center gap-1.5 typo-caption text-foreground">
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                    <span className="truncate">{spec.label}</span>
                  </span>
                  <span className="typo-data-lg tabular-nums text-foreground"><Numeric value={spec.count} /></span>
                </span>
              </Button>
            );
          })}
        </div>
      )}
    </motion.aside>
  );
}
