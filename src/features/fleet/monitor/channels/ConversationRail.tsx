import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import '@/features/decision-center/deck/aurora.css';
import { Lamp } from '../grid/prototype/entry-e/parts';
import { useMonitorVisible } from '../monitorVisibility';
import { DeliberationRail } from './DeliberationRail';
import { NeedsYouRail } from './NeedsYouRail';
import type { Ask } from './needsYouModel';
import { useNeedsYou } from './useNeedsYou';
import { useNeedsYouKeys } from './useNeedsYouKeys';
import type { PendingAsks } from './usePendingAsks';

/* ----------------------------------------------------------------------------
 * THE CONVERSATION RAIL - decision surfaces, not messages (WP12: V1).
 *
 * Two tabs. NEEDS YOU is the one queue of what this project (or this persona)
 * holds for the operator, reviews and held questions together, decided in the
 * deck's anatomy. It carries the rail's one LAMP: lit amber with the count
 * while anything waits, dark when nothing does, and dark (never "0") while the
 * queue is unread or unreadable. DELIBERATION holds the driven deliberation's
 * controls; Drive on a band switches the rail to it.
 * -------------------------------------------------------------------------- */

export type RailTab = 'asks' | 'focus';

/** Shared by the strip and its panel, so each tab's `aria-controls` resolves to a `role="tabpanel"`. */
const RAIL_TABS_ID = 'conversation-rail';

export function ConversationRail({
  tab, onTab, asks, pending, personaScoped, teamId, focusDelib,
}: {
  tab: RailTab;
  onTab: (tab: RailTab) => void;
  /** The scope's asks (one persona, or the open team's members). */
  asks: readonly Ask[];
  pending: PendingAsks;
  personaScoped: boolean;
  teamId: string | null;
  focusDelib: string | null;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const visible = useMonitorVisible();
  const ny = useNeedsYou(asks, pending);
  useNeedsYouKeys(ny, visible && tab === 'asks');
  const waiting = pending.readable && asks.length > 0;

  const railTabs = useMemo(() => [
    {
      id: 'asks' as const,
      label: (
        <>
          <Lamp lamp={{ tone: 'warn', lit: waiting }} />
          {m.cv_needs_you}
          {waiting && <span className="typo-data tabular-nums"><Numeric value={asks.length} /></span>}
        </>
      ),
    },
    { id: 'focus' as const, label: m.conv_tab_deliberation, disabled: !focusDelib || personaScoped },
  ], [m, waiting, asks.length, focusDelib, personaScoped]);

  return (
    <section className="au-scope ae-plate flex h-full min-h-0 flex-col overflow-hidden rounded-card" data-testid="conversation-rail">
      <div className="flex h-11 flex-shrink-0 items-center border-b border-border px-2">
        <SegmentedTabs
          tabs={railTabs}
          activeTab={tab}
          onTabChange={onTab}
          variant="pill"
          size="sm"
          fullWidth={false}
          ariaLabel={m.conv_title}
          idPrefix={RAIL_TABS_ID}
          className="border-0 bg-transparent"
        />
      </div>
      {/* Keyed on the tab so the incoming pane fades (opacity only, 150ms, nothing held). */}
      <div
        key={tab}
        role="tabpanel"
        id={`${RAIL_TABS_ID}-panel-${tab}`}
        aria-labelledby={`${RAIL_TABS_ID}-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col animate-fade-in"
      >
        {tab === 'asks' && <NeedsYouRail asks={asks} ny={ny} loading={pending.loading} error={pending.error} onRetry={pending.refresh} />}
        {tab === 'focus' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!personaScoped && teamId && focusDelib
              ? <DeliberationRail teamId={teamId} deliberationId={focusDelib} keys={visible} />
              : <p className="typo-body">{m.conv_focus_hint}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
