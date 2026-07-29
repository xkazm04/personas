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
import { usePersonaMap, useEnrichedRecords } from '@/hooks/utility/data/usePersonaMap';
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

/**
 * A review row with the three columns `PersonaManualReview` carries that the
 * shared {@link ManualReviewItem} shape never had a home for.
 *
 * `assignment_id` / `step_id` are the load-bearing pair: a review that has them
 * was emitted by a persona running as a TEAM STEP, and that step is HELD until
 * someone rules on it. Approving such a review resumes work that is currently
 * stopped — a materially different act from approving an advisory review, and
 * for the whole life of this shaper the surfaces downstream had no way to know
 * which one they were looking at.
 */
export interface MonitorReviewItem extends ManualReviewItem {
  /** Resume-loop link (`NULL` for standalone, non-team reviews). */
  assignment_id: string | null;
  step_id: string | null;
  /** Capability attribution, inherited from the originating execution. */
  use_case_id: string | null;
}

/**
 * Shape a raw `PersonaManualReview` row into the item the UI consumes.
 *
 * Three lossy habits are corrected here, all of which showed up as visible
 * defects on the triage deck:
 *
 *  • `review_type` used to be filled with `severity`, so every card printed the
 *    same word under two labels ("Severity: high · Type: high"). The DB has no
 *    review-type column; the honest value is empty, and the adapters render a
 *    type only when there is one.
 *  • `content` used to be `title + '\n' + description`, so the headline was
 *    printed twice — once as the card's `<h2>`, once as the body's first line.
 *    `content` is now the description alone. (`MonitorDrawer` already rendered
 *    title and content as separate elements, so it was double-printing too.)
 *  • The resume-loop and provenance ids were dropped entirely.
 */
function shapeReview(r: PersonaManualReview): MonitorReviewItem {
  return {
    id: r.id,
    persona_id: r.persona_id,
    execution_id: r.execution_id,
    review_type: '',
    content: r.description ?? '',
    severity: r.severity,
    status: r.status,
    reviewer_notes: r.reviewer_notes,
    context_data: r.context_data,
    suggested_actions: r.suggested_actions,
    title: r.title,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    source: 'local',
    assignment_id: r.assignment_id,
    step_id: r.step_id,
    use_case_id: r.use_case_id,
  };
}

export interface MonitorData {
  personas: ReturnType<typeof useAgentStore.getState>['personas'];
  healthMap: Record<string, PersonaHealth>;
  reviews: MonitorReviewItem[];
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

  const [localReviews, setLocalReviews] = useState<MonitorReviewItem[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<PersonaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const { track, busy: isProcessing } = useInFlight();
  // The app's ONE persona-join helper, already used by ManualReviewList for the
  // same rows. This shaper populated no identity at all, which is why the deck
  // rendered "Persona: —" on every review card while two other surfaces showed
  // the name for the same row.
  const personaMap = usePersonaMap();

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

  const pendingCloud = useMemo<MonitorReviewItem[]>(
    // Cloud rows come from the cloud worker and have no resume-loop link — they
    // are never a held team step. Normalised to null so one shape flows on.
    () =>
      cloudReviews
        .filter((r) => r.status === 'pending')
        .map((r) => ({ ...r, assignment_id: null, step_id: null, use_case_id: null })),
    [cloudReviews],
  );

  const enrichedLocal = useEnrichedRecords(localReviews, personaMap);
  const enrichedCloud = useEnrichedRecords(pendingCloud, personaMap);

  const reviews = useMemo<MonitorReviewItem[]>(
    () => [...enrichedLocal, ...enrichedCloud],
    [enrichedLocal, enrichedCloud],
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
