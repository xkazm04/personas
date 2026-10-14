import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { QuickAnswerBody } from '@/features/agents/quick-answer/QuickAnswerBody';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import { Lamp } from '../grid/prototype/entry-e/parts';
import { DeliberationRail } from './DeliberationRail';
import { ReviewsRail } from './ReviewsRail';

/* ----------------------------------------------------------------------------
 * THE CONVERSATION RAIL — decision surfaces, not messages, so not in the
 * timeline. One plate of the panel, the way Activity's supply deck is.
 *
 * The Reviews tab carries the rail's one LAMP: a held step stops work until a
 * person answers, so it is the one thing on this rail that needs the operator.
 * Lit amber with the count while anything waits; dark when nothing does, and
 * dark (not "0") while the queue is unread or unreadable. The count is the
 * last one ReviewsRail read, kept while another tab is open.
 * -------------------------------------------------------------------------- */

export type RailTab = 'focus' | 'reviews' | 'quick';

/** Shared by the strip and the pane it selects, so each tab's `aria-controls`
 *  actually resolves to a `role="tabpanel"` (census:
 *  `tabstrip-with-no-declared-panel`). Written out rather than taken from
 *  `segmentedTabPanelProps`: the ids are the helper's own format, and a
 *  spread object is invisible both to a reader and to the ratchet. */
const RAIL_TABS_ID = 'conversation-rail';

export function ConversationRail({
  tab, onTab, scopeKey, members, personaScoped, teamId, focusDelib, railPersonaIds,
}: {
  tab: RailTab;
  onTab: (tab: RailTab) => void;
  /** The open team or persona: a new scope forgets the last count. */
  scopeKey: string | null;
  /** Whose held steps the Reviews tab lists (one persona, or the team). */
  members: ChannelMember[] | null;
  personaScoped: boolean;
  teamId: string | null;
  focusDelib: string | null;
  /** The predicate every tab shares (see ConversationBriefing). */
  railPersonaIds: ReadonlySet<string> | null;
}) {
  const { t } = useTranslation();
  // Keyed by the scope it was read for, so a new team or persona starts dark
  // without a reset effect (which, running after the child's, would wipe the
  // first read).
  const [read, setRead] = useState<{ scope: string | null; count: number | null }>({ scope: null, count: null });
  const onCount = useCallback((count: number | null) => setRead({ scope: scopeKey, count }), [scopeKey]);
  const reviewCount = read.scope === scopeKey ? read.count : null;
  const waiting = reviewCount !== null && reviewCount > 0;

  const railTabs = useMemo(
    () => [
      {
        id: 'reviews' as const,
        label: (
          <>
            <Lamp lamp={{ tone: 'warn', lit: waiting }} />
            {t.monitor.conv_tab_reviews}
            {waiting && <span className="typo-data tabular-nums"><Numeric value={reviewCount} /></span>}
          </>
        ),
      },
      // Text-only from here: the lamp is the strip's one glyph, and three
      // labels plus a count must fit the 320px default rail.
      {
        id: 'focus' as const,
        label: t.monitor.conv_tab_deliberation,
        disabled: !focusDelib || personaScoped,
      },
      {
        id: 'quick' as const,
        label: t.monitor.conv_tab_quick,
      },
    ],
    [t, focusDelib, personaScoped, waiting, reviewCount],
  );

  return (
    <section className="ae-plate h-full min-h-0 flex flex-col overflow-hidden rounded-card">
      {/* The shared strip, not three hand-rolled buttons: it owns the
          disabled appearance, the roving tabindex and the arrow-key tablist
          nav, and its sliding indicator makes the switch read as a MOVE. */}
      <div className="flex-shrink-0 h-11 px-2 flex items-center border-b border-border">
        <SegmentedTabs
          tabs={railTabs}
          activeTab={tab}
          onTabChange={onTab}
          variant="pill"
          size="sm"
          fullWidth={false}
          ariaLabel={t.monitor.conv_title}
          idPrefix={RAIL_TABS_ID}
          className="border-0 bg-transparent"
        />
      </div>

      {/* Keyed on the tab so the incoming pane fades rather than hard-cutting.
          Opacity-only and 150ms, so nothing is HELD (law 2). */}
      <div
        key={tab}
        role="tabpanel"
        id={`${RAIL_TABS_ID}-panel-${tab}`}
        aria-labelledby={`${RAIL_TABS_ID}-tab-${tab}`}
        className="flex-1 min-h-0 overflow-y-auto p-2 animate-fade-in"
      >
        {/* The Quick tab shares the Reviews tab's predicate: one team's
            channel lists that team's held questions, not the fleet's. */}
        {tab === 'quick' && <QuickAnswerBody personaIds={railPersonaIds} />}
        {tab === 'reviews' && members && <ReviewsRail members={members} onCount={onCount} />}
        {tab === 'focus' && !personaScoped && teamId && focusDelib && (
          <DeliberationRail teamId={teamId} deliberationId={focusDelib} />
        )}
        {tab === 'focus' && !personaScoped && !focusDelib && (
          <p className="typo-body p-2">{t.monitor.conv_focus_hint}</p>
        )}
      </div>
    </section>
  );
}
