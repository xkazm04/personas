// useRailSurface — the Activity rail's three feeds, verbs and modals without
// its chrome or rows. PROTOTYPE SEAM lifted from `ActivityRail`: a variant
// renders its own tab strip and its own row (inside the shared virtualised
// `RailList`), and mounts `modals` once.

import { useCallback, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, MessagesSquare, Rocket } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { TriageFocus } from '@/features/shared/components/decisions/TriageFocus';
import type { TriageDecision, TriageItem } from '@/features/agents/quick-answer/triage/triageTypes';
import type { FeedTeam } from '../../channels/types';
import type { RailProjectFilter } from '../rail/railFilter';
import { useDispatchFeed, useMessageFeed, useReviewFeed } from '../rail/useRailFeeds';
import { useSimFeed } from '../rail/useSimFeed';
import { useRailActions } from '../rail/useRailActions';
import { RailThreadModal } from '../rail/RailThreadModal';
import type { RailTab, RailTabSpec } from '../rail/RailChrome';
import type { SimRailRows } from '../simulation';

export function useRailSurface({
  feedTeams, onOpenSpeaker, filter, simulated, rowsEnabled = true,
}: {
  feedTeams: FeedTeam[];
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
  filter: RailProjectFilter | null;
  simulated: SimRailRows | null;
  /**
   * Whether anything is RENDERING the rows. A docked surface that is shut
   * passes false and no feed adapts a row for any tab. The three counts are
   * unaffected by design: `useRailFeeds` never gates the queue, the accepted
   * list or the channel subscription the badges are derived from, only the
   * projection into rows — so a shut desk still says honestly how much is
   * waiting behind it.
   */
  rowsEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RailTab>('reviews');
  const [showAllThreads, setShowAllThreads] = useState(false);

  const live = !simulated;
  const reviews = useReviewFeed(rowsEnabled && live && tab === 'reviews', filter);
  const dispatch = useDispatchFeed(rowsEnabled && live && tab === 'dispatch', filter);
  const messages = useMessageFeed(feedTeams, rowsEnabled && live && tab === 'messages', filter, showAllThreads);

  const simThreads = useMemo(
    () => (simulated ? (showAllThreads ? simulated.messages : simulated.messages.filter((r) => r.unread)) : null),
    [simulated, showAllThreads],
  );
  const simRows = simulated
    ? tab === 'reviews' ? simulated.reviews : tab === 'dispatch' ? simulated.dispatch : simThreads
    : null;
  const simFeed = useSimFeed(rowsEnabled ? simRows : null, filter);
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

  // ---- The opened case, IN the dock ---------------------------------------
  //
  // This used to be `RailTriageModal`: a centre-screen modal, three buttons,
  // no verdict hotkeys, no per-decision carousel, and a `try/finally` with no
  // `catch` that closed on a write that had FAILED. It is now the shared
  // `TriageFocus` rendered in the dock's own body, which is strictly more
  // surface at strictly less width.
  //
  // `queueSidebar` is OFF and that is the whole reason the prop exists. The
  // rail's default width is 320px and the sidebar alone is 330; the dock's tab
  // list already IS the queue, so the rail is redundant here and impossible
  // besides. Overview, which owns a page, passes it and gets the rail.
  //
  // The queue the focus navigates is the tab's OWN rows resolved back through
  // `itemById` — no second list, so N-of-M can never disagree with what the
  // operator just scrolled past, and every kind the unified queue produces
  // (review, idea, question, policy, evolution, goal) decides here, not just
  // reviews.
  const triageItems = useMemo<TriageItem[]>(() => {
    if (!act.openTriage) return [];
    const resolved = active.rows
      .map((row) => reviews.itemById(row.id))
      .filter((item): item is TriageItem => !!item);
    // A row the feed can no longer resolve (it polled away mid-read) must not
    // take the open card with it.
    return resolved.some((i) => i.id === act.openTriage!.id) ? resolved : [act.openTriage];
  }, [act.openTriage, active.rows, reviews]);

  const triageIndex = Math.max(0, triageItems.findIndex((i) => i.id === act.openTriage?.id));

  const onTriageIndexChange = useCallback((next: number) => {
    const row = active.rows[next];
    if (row) act.openRow(row);
  }, [active.rows, act]);

  /** Rejects on a failed write, so the card stays open with everything typed. */
  const onTriageDecide = useCallback(async (decision: TriageDecision) => {
    await reviews.resolve(decision);
    act.closeTriage();
  }, [reviews, act]);

  const triage = act.openTriage ? (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="rail-triage-focus">
      <div className="flex h-9 flex-shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={act.closeTriage}
          aria-label={t.common.back}
          data-testid="rail-triage-close"
          icon={<ArrowLeft className="h-3.5 w-3.5" />}
        />
        <span className="min-w-0 flex-1 truncate typo-label text-foreground">
          {t.monitor.grid_rail_triage_modal_aria}
        </span>
      </div>
      <TriageFocus
        className="min-h-0 flex-1"
        items={triageItems}
        index={triageIndex}
        onIndexChange={onTriageIndexChange}
        onDecide={onTriageDecide}
      />
    </div>
  ) : null;

  const modals = (
    <RailThreadModal
      thread={act.openThread ? messages.threadByKey(act.openThread.key) ?? act.openThread : null}
      onClose={act.closeThread}
      onMarkRead={messages.markThreadRead}
      onOpenDetail={onOpenSpeaker ? act.drillToSpeaker : undefined}
    />
  );

  return {
    tab, setTab, tabs, active, act, empty,
    /** Dispatch selection controller — `DeckDispatchBar` takes it as `ctl`. */
    dispatchCtl: dispatch.ctl,
    showAllThreads, setShowAllThreads, hiddenThreads,
    /** Key for `RailList` so the three feeds never share a scroll offset. */
    listKey: `${tab}:${filter?.teamId ?? 'all'}:${tab === 'messages' && showAllThreads ? 'all' : 'unread'}`,
    simulated: !!simulated,
    /** The opened case, to render INSTEAD of the row list. Null when none. */
    triage,
    modals,
  };
}

export type RailSurface = ReturnType<typeof useRailSurface>;
