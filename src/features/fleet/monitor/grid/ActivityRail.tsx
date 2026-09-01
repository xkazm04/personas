// ActivityRail — the Activity board's decision surface.
//
// A direct lift of the Conversations rail (`ConversationBriefing`'s right-hand
// column): same width, same border, same tint, same tab styling. That is the
// point — Activity and Conversations are the same room seen from two angles, and
// a rail that looked different in each would say they are different apps.
//
// THE RULE THE RAIL ENFORCES, inherited from Conversations: a decision surface
// is not a message and not a tile. The board answers "what is every persona
// doing"; nothing on it is decidable. Anything the operator must ACT on lives
// here, one glance from the board that raised it.
//
// Three tabs, in the order the operator's day runs:
//   • Reviews  — the UNIFIED TRIAGE QUEUE, the same queue the deck's rail reads.
//                It used to be `ReviewsRail`, which read `list_manual_reviews`
//                alone and so reported "Nothing is waiting on you" while sixty
//                ideas, practices, policy diffs, build questions and finished
//                goals sat undecided. Badge = items in hand.
//   • Dispatch — accepted work nobody has sent to a runner. Badge = rows.
//   • Messages — the peripheral channel read. Badge = UNREAD, not total: the
//                other two badge a backlog you must work off, and this one
//                badges what changed since you last looked, which is the only
//                number a message tab has ever meant.
//
// All three now render through ONE row model (`rail/railModel`) and ONE scroller
// (`rail/RailList`, virtualized + infinite-load). What differs between them is
// data, not layout — which is what "unify the three tabs" actually required.
//
import { useCallback, useState } from 'react';
import { AlertCircle, Inbox, MessagesSquare, Rocket } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import type { FeedTeam } from '../channels/types';
import { RailList } from './rail/RailList';
import type { RailRow } from './rail/railModel';
import { useDispatchFeed, useMessageFeed, useReviewFeed } from './rail/useRailFeeds';
import { RAIL_ROW_HEIGHT, RailRowView } from './rail/RailRowView';

type RailTab = 'reviews' | 'dispatch' | 'messages';

export function ActivityRail({
  feedTeams, onOpenSpeaker,
}: {
  /** Teams whose channels the Messages tab merges. */
  feedTeams: FeedTeam[];
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RailTab>('reviews');

  // All three feeds are mounted unconditionally, and that is the trade: a tab
  // badge is only worth having if it is truthful before the tab is clicked, and
  // a reviewer should not have to open a tab labelled nothing to find out it is
  // not nothing. Same call `DeckQueueRail` documents for its Accepted count.
  const reviews = useReviewFeed();
  const dispatch = useDispatchFeed();
  const messages = useMessageFeed(feedTeams);

  const active = tab === 'reviews' ? reviews : tab === 'dispatch' ? dispatch : messages;

  const openRow = useCallback(
    (row: RailRow) => {
      if (tab !== 'messages' || !onOpenSpeaker) return;
      // `channelToRow` keys Messages rows `${teamId}:${itemId}`.
      const teamId = row.id.slice(0, row.id.indexOf(':'));
      const persona = feedTeams.find((tm) => tm.teamId === teamId)?.members[0];
      if (teamId && persona) onOpenSpeaker(teamId, persona.personaId);
    },
    [tab, onOpenSpeaker, feedTeams],
  );

  const renderRow = useCallback(
    (row: RailRow) => (
      <RailRowView
        row={row}
        // Only Dispatch rows are selectable, and only they should cost a Set
        // lookup — a Messages feed asking a dispatch selection whether it holds
        // a channel item id is a question with no meaning.
        selected={row.selectable ? dispatch.ctl.selected.has(row.id) : undefined}
        onToggle={row.selectable ? dispatch.ctl.toggle : undefined}
        onOpen={openRow}
      />
    ),
    [dispatch.ctl.selected, dispatch.ctl.toggle, openRow],
  );

  // Conversations' own tab styling, verbatim.
  const tabClass = (on: boolean) =>
    `px-2 py-0.5 rounded-interactive typo-label transition-colors ${
      on ? 'text-foreground bg-secondary/40' : 'text-foreground opacity-45 hover:opacity-80'
    }`;

  const TABS: Array<{ id: RailTab; label: string; icon: typeof AlertCircle; count: number }> = [
    { id: 'reviews', label: t.monitor.conv_tab_reviews, icon: AlertCircle, count: reviews.total },
    { id: 'dispatch', label: t.monitor.grid_rail_tab_dispatch, icon: Rocket, count: dispatch.total },
    { id: 'messages', label: t.monitor.grid_rail_tab_messages, icon: MessagesSquare, count: messages.unread },
  ];

  const EMPTY: Record<RailTab, { heading: string; description: string }> = {
    reviews: { heading: t.monitor.grid_rail_empty_reviews, description: t.monitor.grid_rail_empty_reviews_sub },
    dispatch: { heading: t.monitor.triage_accepted_empty, description: t.monitor.triage_accepted_empty_sub },
    messages: { heading: t.monitor.grid_messages_empty, description: t.monitor.grid_rail_empty_messages_sub },
  };

  return (
    <div
      className="flex min-h-0 w-[320px] flex-shrink-0 flex-col border-l border-border bg-foreground/[0.012]"
      data-testid="activity-rail"
    >
      <div
        className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-border px-2"
        role="group"
        aria-label={t.monitor.grid_rail_tabs_aria}
      >
        {TABS.map((v) => {
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setTab(v.id)}
              aria-pressed={tab === v.id}
              data-testid={`activity-rail-tab-${v.id}`}
              className={tabClass(tab === v.id)}
            >
              <Icon className="mr-1 inline h-3 w-3" />
              {v.label}
              {v.count > 0 && <span className="ml-1 tabular-nums opacity-60">{v.count}</span>}
            </button>
          );
        })}
      </div>

      {/* The Dispatch tab is the only one with a control bar; it stays pinned
          above its own scroller so the selection count never scrolls away. */}
      {tab === 'dispatch' && <DeckDispatchBar ctl={dispatch.ctl} />}

      {/* Keyed by tab so the three feeds never share a scroll position — and so
          the virtualizer re-measures instead of restoring one list's offset
          into another list's rows. */}
      <RailList
        key={tab}
        rows={active.rows}
        rowHeight={RAIL_ROW_HEIGHT}
        renderRow={renderRow}
        hasMore={active.hasMore}
        loading={active.loading}
        onEndReached={active.loadMore}
        testId={`activity-rail-list-${tab}`}
        empty={
          <div className="px-3 py-8">
            <EmptyIllustration
              icon={tab === 'messages' ? MessagesSquare : tab === 'dispatch' ? Inbox : AlertCircle}
              heading={EMPTY[tab].heading}
              description={EMPTY[tab].description}
            />
          </div>
        }
      />
    </div>
  );
}

export default ActivityRail;
