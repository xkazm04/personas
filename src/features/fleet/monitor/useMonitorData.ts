// useMonitorData — data layer for the Persona Monitor.
//
// Gathers every feed the Monitor fuses: the persona roster + health, the
// pending human-review queue (local + cloud), unread messages, and live
// process activity. Self-contained — the Monitor can mount this from the
// titlebar without depending on the Overview dashboard pipeline.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { listManualReviews, updateManualReviewStatus, dispatchReviewAction } from '@/api/overview/reviews';
import { listMessages, markMessageRead } from '@/api/overview/messages';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';
import { createLogger } from '@/lib/log';

const logger = createLogger('persona-monitor');

/** Most recent messages scanned for unread state — unread skews recent. */
const MESSAGE_SCAN_LIMIT = 300;

/** Shape a raw `PersonaManualReview` row into the `ManualReviewItem` the UI consumes. */
function shapeReview(r: PersonaManualReview): ManualReviewItem {
  return {
    id: r.id,
    persona_id: r.persona_id,
    execution_id: r.execution_id,
    review_type: r.severity,
    content: r.title + (r.description ? `\n${r.description}` : ''),
    severity: r.severity,
    status: r.status,
    reviewer_notes: r.reviewer_notes,
    context_data: r.context_data,
    suggested_actions: r.suggested_actions,
    title: r.title,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    source: 'local',
  };
}

export interface MonitorData {
  personas: ReturnType<typeof useAgentStore.getState>['personas'];
  healthMap: Record<string, PersonaHealth>;
  reviews: ManualReviewItem[];
  unreadMessages: PersonaMessage[];
  activeProcesses: Record<string, ActiveProcess>;
  loading: boolean;
  /** True while ANY review write is in flight. Presentational only — the write
   *  guard is per-review (see `useInFlight`), never this flag. */
  isProcessing: boolean;
  /**
   * Both verdict writers REJECT when the write fails. Callers that show the
   * decision as done before the round-trip (the triage deck resolves
   * optimistically) depend on that rejection to put the row back; swallowing it
   * here is how a card leaves the queue while SQLite still says `pending`.
   */
  handleReviewAction: (id: string, status: ManualReviewStatus, notes?: string) => Promise<void>;
  /** Phase 4 — choose a suggested action: resolves + dispatches a follow-up run. */
  handleDispatchAction: (id: string, action: string) => Promise<void>;
  handleMarkRead: (id: string) => Promise<void>;
}

/**
 * Per-key in-flight ledger.
 *
 * The previous guard was a single `if (isProcessing) return;` — which meant a
 * second verdict issued while the first was still in flight was **dropped on
 * the floor**: no write, no error, and (for the triage deck) a card that had
 * already left the queue. A reviewer clearing a stack at one card per second
 * hits that window constantly.
 *
 * So the guard is keyed. Different reviews proceed in parallel; a repeat call
 * for the SAME review joins the in-flight promise instead of racing a duplicate
 * write. Either way no caller is ever told "done" without a write having
 * happened.
 */
function useInFlight() {
  const inFlight = useRef(new Map<string, Promise<void>>());
  const [busyKeys, setBusyKeys] = useState<readonly string[]>([]);

  const track = useCallback((key: string, run: () => Promise<void>): Promise<void> => {
    const joined = inFlight.current.get(key);
    if (joined) return joined;

    const promise = run().finally(() => {
      inFlight.current.delete(key);
      setBusyKeys((prev) => prev.filter((k) => k !== key));
    });
    inFlight.current.set(key, promise);
    setBusyKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    return promise;
  }, []);

  return { track, busy: busyKeys.length > 0 };
}

export function useMonitorData(): MonitorData {
  const personas = useAgentStore((s) => s.personas);
  const healthMap = useAgentStore((s) => s.personaHealthMap);
  const fetchPersonaSummaries = useAgentStore((s) => s.fetchPersonaSummaries);
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  const cloudReviews = useOverviewStore((s) => s.cloudReviews);
  const fetchCloudReviews = useOverviewStore((s) => s.fetchCloudReviews);
  const respondToCloudReview = useOverviewStore((s) => s.respondToCloudReview);
  const fetchPendingReviewCount = useOverviewStore((s) => s.fetchPendingReviewCount);
  const fetchUnreadMessageCount = useOverviewStore((s) => s.fetchUnreadMessageCount);
  const isCloudConnected = useSystemStore((s) => s.cloudConfig?.is_connected ?? false);

  const [localReviews, setLocalReviews] = useState<ManualReviewItem[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<PersonaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const { track, busy: isProcessing } = useInFlight();

  const reloadReviews = useCallback(async () => {
    try {
      const raw = await listManualReviews(undefined, 'pending');
      setLocalReviews(raw.map(shapeReview));
    } catch (err) {
      logger.error('Failed to load manual reviews', { error: err });
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadMessages = useCallback(async () => {
    try {
      const raw = await listMessages(MESSAGE_SCAN_LIMIT);
      setUnreadMessages(raw.filter((m) => !m.is_read));
    } catch (err) {
      logger.error('Failed to load messages', { error: err });
    }
  }, []);

  useEffect(() => {
    void reloadReviews();
    void reloadMessages();
    void fetchPersonaSummaries();
  }, [reloadReviews, reloadMessages, fetchPersonaSummaries]);
  useEffect(() => { if (isCloudConnected) void fetchCloudReviews(); }, [isCloudConnected, fetchCloudReviews]);

  // Reviews/messages aren't event-driven — poll to catch ones created while
  // the Monitor is open. Process activity is already live via the
  // PROCESS_ACTIVITY event bridge.
  usePolling(reloadReviews, { interval: POLLING_CONFIG.dashboardRefresh.interval, enabled: true });
  usePolling(reloadMessages, { interval: POLLING_CONFIG.dashboardRefresh.interval, enabled: true });
  usePolling(fetchPersonaSummaries, { interval: POLLING_CONFIG.dashboardRefresh.interval, enabled: true });
  usePolling(fetchCloudReviews, {
    interval: POLLING_CONFIG.cloudReviews.interval,
    enabled: isCloudConnected,
    maxBackoff: POLLING_CONFIG.cloudReviews.maxBackoff,
  });

  const reviews = useMemo<ManualReviewItem[]>(
    () => [...localReviews, ...cloudReviews.filter((r) => r.status === 'pending')],
    [localReviews, cloudReviews],
  );

  // Read through a ref so the writers keep a stable identity (they are stored in
  // refs by the triage deck's keyboard layer) while still seeing the newest poll.
  const reviewsRef = useRef(reviews);
  reviewsRef.current = reviews;

  /** The row a verdict is about, or an error — never a silent no-op. */
  const requireReview = useCallback((id: string): ManualReviewItem => {
    const review = reviewsRef.current.find((r) => r.id === id);
    if (!review) throw new Error(`Review ${id} is no longer in the pending queue`);
    return review;
  }, []);

  /** Re-read every surface a resolved review appears on. */
  const refreshAfterWrite = useCallback(async () => {
    await reloadReviews();
    if (isCloudConnected) await fetchCloudReviews();
    void fetchPendingReviewCount();
  }, [reloadReviews, isCloudConnected, fetchCloudReviews, fetchPendingReviewCount]);

  const handleReviewAction = useCallback(
    (id: string, status: ManualReviewStatus, notes?: string) =>
      track(`review:${id}`, async () => {
        try {
          const review = requireReview(id);
          if (review.source === 'cloud') {
            await respondToCloudReview(
              review.id,
              review.execution_id,
              status === 'approved' ? 'approve' : 'reject',
              notes ?? '',
            );
          } else {
            await updateManualReviewStatus(id, status, notes);
          }
          await refreshAfterWrite();
        } catch (err) {
          logger.error('Failed to action review', { error: err });
          // Rethrow: the caller decides how to surface it. Swallowing here is
          // what let an optimistic queue report a decision that never landed.
          throw err;
        }
      }),
    [track, requireReview, respondToCloudReview, refreshAfterWrite],
  );

  // Phase 4 — resolve a review by CHOOSING a suggested action, which records the
  // branch AND dispatches a follow-up persona run to carry it out. Cloud reviews
  // have no dispatch path, so the choice is recorded as an approval.
  const handleDispatchAction = useCallback(
    (id: string, action: string) =>
      track(`review:${id}`, async () => {
        try {
          const review = requireReview(id);
          if (review.source === 'cloud') {
            await respondToCloudReview(review.id, review.execution_id, 'approve', action);
          } else {
            await dispatchReviewAction(id, action);
          }
          await refreshAfterWrite();
        } catch (err) {
          logger.error('Failed to dispatch review action', { error: err });
          throw err;
        }
      }),
    [track, requireReview, respondToCloudReview, refreshAfterWrite],
  );

  const handleMarkRead = useCallback(
    async (id: string) => {
      // Optimistic — drop it from the unread set immediately.
      setUnreadMessages((prev) => prev.filter((m) => m.id !== id));
      try {
        await markMessageRead(id);
        void fetchUnreadMessageCount();
      } catch (err) {
        logger.error('Failed to mark message read', { error: err });
        void reloadMessages();
      }
    },
    [fetchUnreadMessageCount, reloadMessages],
  );

  return {
    personas, healthMap, reviews, unreadMessages, activeProcesses,
    loading, isProcessing, handleReviewAction, handleDispatchAction, handleMarkRead,
  };
}
