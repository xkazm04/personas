// useRailSurface — the Activity rail's three feeds, verbs and modals without
// its chrome or rows. PROTOTYPE SEAM lifted from `ActivityRail`: a variant
// renders its own tab strip and its own row (inside the shared virtualised
// `RailList`), and mounts `modals` once.

import { useMemo, useState } from 'react';
import { AlertCircle, MessagesSquare, Rocket } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FeedTeam } from '../../channels/types';
import type { RailProjectFilter } from '../rail/railFilter';
import { useDispatchFeed, useMessageFeed, useReviewFeed } from '../rail/useRailFeeds';
import { useSimFeed } from '../rail/useSimFeed';
import { useRailActions } from '../rail/useRailActions';
import { RailTriageModal } from '../rail/RailTriageModal';
import { RailThreadModal } from '../rail/RailThreadModal';
import type { RailTab, RailTabSpec } from '../rail/RailChrome';
import type { SimRailRows } from '../simulation';

export function useRailSurface({
  feedTeams, onOpenSpeaker, filter, simulated,
}: {
  feedTeams: FeedTeam[];
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
  filter: RailProjectFilter | null;
  simulated: SimRailRows | null;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RailTab>('reviews');
  const [showAllThreads, setShowAllThreads] = useState(false);

  const live = !simulated;
  const reviews = useReviewFeed(live && tab === 'reviews', filter);
  const dispatch = useDispatchFeed(live && tab === 'dispatch', filter);
  const messages = useMessageFeed(feedTeams, live && tab === 'messages', filter, showAllThreads);

  const simThreads = useMemo(
    () => (simulated ? (showAllThreads ? simulated.messages : simulated.messages.filter((r) => r.unread)) : null),
    [simulated, showAllThreads],
  );
  const simRows = simulated
    ? tab === 'reviews' ? simulated.reviews : tab === 'dispatch' ? simulated.dispatch : simThreads
    : null;
  const simFeed = useSimFeed(simRows, filter);
  const active = simulated ? simFeed : tab === 'reviews' ? reviews : tab === 'dispatch' ? dispatch : messages;

  const act = useRailActions({
    tab,
    reviewById: reviews.itemById,
    threadByKey: messages.threadByKey,
    decide: reviews.decide,
    onOpenSpeaker,
  });

  const tabs: RailTabSpec[] = [
    { id: 'reviews', label: t.monitor.conv_tab_reviews, icon: AlertCircle,
      count: simulated ? simulated.reviews.length : reviews.total },
    { id: 'dispatch', label: t.monitor.grid_rail_tab_dispatch, icon: Rocket,
      count: simulated ? simulated.dispatch.length : dispatch.total },
    { id: 'messages', label: t.monitor.grid_rail_tab_messages, icon: MessagesSquare,
      count: simulated ? simulated.messages.filter((r) => r.unread).length : messages.unread },
  ];

  const empty: Record<RailTab, { heading: string; description: string }> = {
    reviews: { heading: t.monitor.grid_rail_empty_reviews, description: t.monitor.grid_rail_empty_reviews_sub },
    dispatch: { heading: t.monitor.triage_accepted_empty, description: t.monitor.triage_accepted_empty_sub },
    messages: showAllThreads
      ? { heading: t.monitor.grid_messages_empty, description: t.monitor.grid_rail_empty_messages_sub }
      : { heading: t.monitor.grid_rail_empty_threads, description: t.monitor.grid_rail_empty_threads_sub },
  };

  const hiddenThreads = simulated
    ? simulated.messages.length - simulated.messages.filter((r) => r.unread).length
    : messages.total - messages.unread;

  const modals = (
    <>
      <RailTriageModal item={act.openTriage} onClose={act.closeTriage} onDecide={reviews.decide} />
      <RailThreadModal
        thread={act.openThread ? messages.threadByKey(act.openThread.key) ?? act.openThread : null}
        onClose={act.closeThread}
        onMarkRead={messages.markThreadRead}
        onOpenDetail={onOpenSpeaker ? act.drillToSpeaker : undefined}
      />
    </>
  );

  return {
    tab, setTab, tabs, active, act, empty,
    /** Dispatch selection controller — `DeckDispatchBar` takes it as `ctl`. */
    dispatchCtl: dispatch.ctl,
    showAllThreads, setShowAllThreads, hiddenThreads,
    /** Key for `RailList` so the three feeds never share a scroll offset. */
    listKey: `${tab}:${filter?.teamId ?? 'all'}:${tab === 'messages' && showAllThreads ? 'all' : 'unread'}`,
    simulated: !!simulated,
    modals,
  };
}

export type RailSurface = ReturnType<typeof useRailSurface>;
