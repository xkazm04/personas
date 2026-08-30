// ActivityRail — the Activity board's decision surface.
//
// A direct lift of the Conversations rail (`ConversationBriefing`'s right-hand
// column): same width, same border, same tint, same tab strip. That is the
// point — Activity and Conversations are the same room seen from two angles, and
// a rail that looked different in each would say they are different apps.
//
// THE RULE THE RAIL ENFORCES, inherited from Conversations: a decision surface
// is not a message and not a tile. The board answers "what is every persona
// doing"; nothing on it is decidable. Anything the operator must ACT on — clear
// a held review, send accepted work to a runner — lives here, one glance from
// the board that raised it, and never inside a 38px tile.
//
// Three tabs, in the order the operator's day runs:
//   • Reviews  — `ReviewsRail`, fleet-scoped. Work is STOPPED until you answer.
//   • Dispatch — the deck's `useAcceptedDispatch` + its bar and list, unchanged.
//                An idea you accepted that nobody sent to a runner is the app's
//                own named leak (`dev_tools_undispatched_ideas`); this is the
//                second surface that can close it, and the first one that can do
//                it while you are watching the fleet that would run it.
//   • Messages — the peripheral read (see `ActivityMessages`).
//
// Tab bodies are mounted CONDITIONALLY, not hidden: the Messages tab holds a
// refcounted channel subscription, so leaving it mounted behind a `hidden` class
// would keep every team's channel subscribed for the life of the Monitor.

import { useMemo, useState } from 'react';
import { AlertCircle, MessagesSquare, Rocket } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { ReviewsRail } from '../channels/ReviewsRail';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { DeckAcceptedList } from '@/features/agents/quick-answer/triage/deck/DeckAcceptedList';
import { useAcceptedDispatch } from '@/features/agents/quick-answer/triage/deck/useAcceptedDispatch';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import type { FeedTeam } from '../channels/types';
import { ActivityMessages } from './ActivityMessages';

type RailTab = 'reviews' | 'dispatch' | 'messages';

export function ActivityRail({
  members, feedTeams, pendingReviews, onOpenSpeaker,
}: {
  /** The fleet, as channel members — `ReviewsRail` filters the pending queue to
   *  these persona ids, and on this surface that scope is the whole fleet. */
  members: ChannelMember[];
  /** Teams whose channels the Messages tab merges. */
  feedTeams: FeedTeam[];
  /** Count for the Reviews tab, taken from the board's own cards so the badge
   *  is truthful before the rail's independent 30s poll has answered. */
  pendingReviews: number;
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RailTab>('reviews');

  // Unconditional, as hooks must be — and deliberately not deferred to the tab
  // being opened: the count on a tab nobody has clicked is the only thing that
  // makes the tab worth clicking. Same trade `DeckQueueRail` makes.
  const accepted = useAcceptedDispatch({
    resolveErrorMessage: (err) =>
      resolveErrorTranslated(t, err instanceof Error ? err.message : String(err)).message,
  });

  // Conversations' own tab styling, verbatim — see the file header.
  const tabClass = (on: boolean) =>
    `px-2 py-0.5 rounded-interactive typo-label transition-colors ${
      on ? 'text-foreground bg-secondary/40' : 'text-foreground opacity-45 hover:opacity-80'
    }`;

  const TABS: Array<{ id: RailTab; label: string; icon: typeof AlertCircle; count: number }> = useMemo(
    () => [
      { id: 'reviews', label: t.monitor.conv_tab_reviews, icon: AlertCircle, count: pendingReviews },
      { id: 'dispatch', label: t.monitor.grid_rail_tab_dispatch, icon: Rocket, count: accepted.rows.length },
      { id: 'messages', label: t.monitor.grid_rail_tab_messages, icon: MessagesSquare, count: 0 },
    ],
    [t, pendingReviews, accepted.rows.length],
  );

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

      {/* `key={tab}` so the three bodies never share a DOM node — or a scroll
          position. The dispatch body owns its own scroller (the bar is pinned
          above the list), so it opts out of the shared one. */}
      <div
        key={tab}
        className={`flex min-h-0 flex-1 flex-col ${tab === 'dispatch' ? '' : 'overflow-y-auto'} ${
          tab === 'reviews' ? 'p-2' : ''
        }`}
      >
        {tab === 'reviews' && <ReviewsRail members={members} />}
        {tab === 'dispatch' && (
          <>
            <DeckDispatchBar ctl={accepted} />
            <DeckAcceptedList ctl={accepted} />
          </>
        )}
        {tab === 'messages' && <ActivityMessages teams={feedTeams} onOpen={onOpenSpeaker} />}
      </div>
    </div>
  );
}

export default ActivityRail;
