// ActivityRail — the Activity board's decision surface.
//
// A direct lift of the Conversations rail (`ConversationBriefing`'s right-hand
// column): same border, same tint, same tab styling. That is the point —
// Activity and Conversations are the same room seen from two angles, and a rail
// that looked different in each would say they are different apps.
//
// THE RULE THE RAIL ENFORCES, inherited from Conversations: a decision surface
// is not a message and not a tile. The board answers "what is every persona
// doing"; nothing on it is decidable. Anything the operator must ACT on lives
// here, one glance from the board that raised it.
//
// Three tabs, in the order the operator's day runs:
//   • Reviews  — the UNIFIED TRIAGE QUEUE, the same queue the deck's rail reads.
//                Badge = items in hand.
//   • Dispatch — accepted work nobody has sent to a runner. Badge = rows.
//   • Messages — the peripheral channel read as ONE THREAD PER SOURCE (each
//                persona, each team's room voices, one system thread; see
//                `rail/messageThreads`). Only threads with something unread
//                are listed unless "All threads" is on. Badge = UNREAD THREADS,
//                not messages: the other two badge a backlog you must work off,
//                and this one badges the conversations waiting on you.
//
// All three render through ONE row model (`rail/railModel`) and ONE scroller
// (`rail/RailList`, virtualized + infinite-load). What differs between them is
// data, not layout. The chrome — resize handle, tab bar, scope chip — lives in
// `rail/RailChrome`; this file is the feed wiring and the two open surfaces.
//
// OPENING A ROW. Two tabs have a full surface behind the row, and each reuses
// the component that already renders that thing: a review opens
// `TriageCardBody` (the deck's own card) and a thread opens its lines as
// `TalkBubble`s plus a reply composer (`rail/RailThreadModal`). Dispatch rows deliberately open nothing — a
// dispatchable idea is *selected*, not read.
//
// The row-id → source-object lookups come from the feed hooks (`itemById`)
// rather than from the row, because `RailRow` is a projection with no
// back-pointer and keeping it that way is what lets the model stay React-free.
//
// SIMULATION. When `simulated` carries rows, the three live feeds are put to
// sleep (their `active` gate goes false) and every tab reads `useSimFeed`
// instead. Rows are still projected, scoped, paged, virtualized and rendered by
// the real components — only their SOURCE changes. Nothing opens and nothing
// decides in that mode: a simulated review has no verdict door to write
// through, and an Accept that quietly decides nothing is worse than no Accept.

import { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Inbox, MessagesSquare, Rocket } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import type { FeedTeam } from '../channels/types';
import { RailList } from './rail/RailList';
import type { RailRow } from './rail/railModel';
import type { RailProjectFilter } from './rail/railFilter';
import { useDispatchFeed, useMessageFeed, useReviewFeed } from './rail/useRailFeeds';
import { useSimFeed } from './rail/useSimFeed';
import { useRailActions } from './rail/useRailActions';
import { railRowHeight, RailRowView } from './rail/RailRowView';
import { RailTriageModal } from './rail/RailTriageModal';
import { RailThreadModal } from './rail/RailThreadModal';
import { RailThreadFilter, RailThreadRow } from './rail/RailThreadRow';
import { useRailWidth } from './rail/useRailWidth';
import {
  RailResizeHandle, RailScopeChip, RailTabBar, type RailTab, type RailTabSpec,
} from './rail/RailChrome';
import type { SimRailRows } from './simulation';

export function ActivityRail({
  feedTeams, onOpenSpeaker, filter = null, onClearFilter, simulated = null,
}: {
  /** Teams whose channels the Messages tab merges. */
  feedTeams: FeedTeam[];
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
  /** The one project column all three tabs are scoped to, or null for all. */
  filter?: RailProjectFilter | null;
  onClearFilter?: () => void;
  /** Mock rows for all three tabs, or null to read the real feeds. */
  simulated?: SimRailRows | null;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RailTab>('reviews');
  const rail = useRailWidth();
  const [showAllThreads, setShowAllThreads] = useState(false);

  // All three feeds stay mounted, and that is still the trade: a tab badge is
  // only worth having if it is truthful before the tab is clicked. What each
  // takes is whether it is the one being LOOKED AT — that gates the row
  // projection only, never the subscription the badge counts. The project scope
  // is passed to all three ALWAYS, including inactive ones, because it is what
  // their badges count. Under simulation the projection gate is closed on all
  // three; the subscriptions stay, so switching back is instant.
  const live = !simulated;
  const reviews = useReviewFeed(live && tab === 'reviews', filter);
  const dispatch = useDispatchFeed(live && tab === 'dispatch', filter);
  const messages = useMessageFeed(feedTeams, live && tab === 'messages', filter, showAllThreads);

  // Simulated threads honour the same unread-only default as the real ones.
  const simThreads = useMemo(
    () => (simulated ? (showAllThreads ? simulated.messages : simulated.messages.filter((r) => r.unread)) : null),
    [simulated, showAllThreads],
  );
  const simRows = simulated
    ? tab === 'reviews' ? simulated.reviews : tab === 'dispatch' ? simulated.dispatch : simThreads
    : null;
  const simFeed = useSimFeed(simRows, filter);
  const active = simulated ? simFeed : tab === 'reviews' ? reviews : tab === 'dispatch' ? dispatch : messages;

  // Opening and deciding — see `rail/useRailActions`. Nothing in a simulated
  // row resolves to a source object, so both doors correctly no-op there.
  const act = useRailActions({
    tab,
    reviewById: reviews.itemById,
    threadByKey: messages.threadByKey,
    decide: reviews.decide,
    onOpenSpeaker,
  });

  const renderRow = useCallback(
    (row: RailRow) => tab === 'messages' ? (
      <RailThreadRow row={row} onOpen={act.openRow} />
    ) : (
      <RailRowView
        row={row}
        // Only Dispatch rows are selectable, and only they should cost a Set
        // lookup — a Messages feed asking a dispatch selection whether it holds
        // a channel item id is a question with no meaning.
        selected={row.selectable ? dispatch.ctl.selected.has(row.id) : undefined}
        onToggle={row.selectable ? dispatch.ctl.toggle : undefined}
        // A dispatch row opens nothing: it is selected, not read.
        onOpen={row.selectable ? undefined : act.openRow}
        onAccept={row.decidable ? act.acceptRow : undefined}
        onReject={row.decidable ? act.rejectRow : undefined}
      />
    ),
    [tab, dispatch.ctl.selected, dispatch.ctl.toggle, act.openRow, act.acceptRow, act.rejectRow],
  );

  const tabs: RailTabSpec[] = [
    {
      id: 'reviews', label: t.monitor.conv_tab_reviews, icon: AlertCircle,
      count: simulated ? simulated.reviews.length : reviews.total,
    },
    {
      id: 'dispatch', label: t.monitor.grid_rail_tab_dispatch, icon: Rocket,
      count: simulated ? simulated.dispatch.length : dispatch.total,
    },
    {
      id: 'messages', label: t.monitor.grid_rail_tab_messages, icon: MessagesSquare,
      count: simulated ? simulated.messages.filter((r) => r.unread).length : messages.unread,
    },
  ];

  const EMPTY: Record<RailTab, { heading: string; description: string }> = {
    reviews: { heading: t.monitor.grid_rail_empty_reviews, description: t.monitor.grid_rail_empty_reviews_sub },
    dispatch: { heading: t.monitor.triage_accepted_empty, description: t.monitor.triage_accepted_empty_sub },
    messages: showAllThreads
      ? { heading: t.monitor.grid_messages_empty, description: t.monitor.grid_rail_empty_messages_sub }
      : { heading: t.monitor.grid_rail_empty_threads, description: t.monitor.grid_rail_empty_threads_sub },
  };

  return (
    <div className="flex min-h-0 flex-shrink-0" style={{ width: rail.width }}>
      <RailResizeHandle rail={rail} />

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-foreground/[0.012]"
        data-testid="activity-rail"
        data-simulated={simulated ? true : undefined}
      >
        <RailTabBar tabs={tabs} tab={tab} onSelect={setTab} />
        {filter && <RailScopeChip filter={filter} onClear={onClearFilter} />}

        {/* The Dispatch tab is the only one with a control bar; it stays pinned
            above its own scroller so the selection count never scrolls away.
            It acts on the REAL backlog, so it is absent while simulating. */}
        {tab === 'dispatch' && !simulated && <DeckDispatchBar ctl={dispatch.ctl} />}
        {tab === 'messages' && (
          <RailThreadFilter
            showAll={showAllThreads}
            onChange={setShowAllThreads}
            hidden={simulated
              ? simulated.messages.length - simulated.messages.filter((r) => r.unread).length
              : messages.total - messages.unread}
          />
        )}

        {/* Keyed by tab AND by scope so the three feeds never share a scroll
            position — and so the virtualizer re-measures instead of restoring
            one list's offset into another list's rows. */}
        <RailList
          key={`${tab}:${filter?.teamId ?? 'all'}:${tab === 'messages' && showAllThreads ? 'all' : 'unread'}`}
          rows={active.rows}
          heightOf={railRowHeight}
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

      {/* Both modals portal to the body, so neither inherits the rail's width
          or the Monitor overlay's stacking context. */}
      <RailTriageModal item={act.openTriage} onClose={act.closeTriage} onDecide={reviews.decide} />
      <RailThreadModal
        // Re-resolved live by key, so lines that land while it is open show
        // up; the captured thread only covers a thread that left the window.
        thread={act.openThread ? messages.threadByKey(act.openThread.key) ?? act.openThread : null}
        onClose={act.closeThread}
        onMarkRead={messages.markThreadRead}
        onOpenDetail={onOpenSpeaker ? act.drillToSpeaker : undefined}
      />
    </div>
  );
}

export default ActivityRail;
