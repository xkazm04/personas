// useMonitorData — data layer for the Persona Monitor.
//
// Gathers every feed the Monitor fuses: the persona roster + health, the
// pending human-review queue (local + cloud), unread messages, and live
// process activity. Self-contained — the Monitor can mount this from the
// titlebar without depending on the Overview dashboard pipeline.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { listManualReviews, updateManualReviewStatus } from '@/api/overview/reviews';
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
  isProcessing: boolean;
  handleReviewAction: (id: string, status: ManualReviewStatus, notes?: string) => Promise<void>;
  handleMarkRead: (id: string) => Promise<void>;
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
  const [isProcessing, setIsProcessing] = useState(false);

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

  const handleReviewAction = useCallback(
    async (id: string, status: ManualReviewStatus, notes?: string) => {
      if (isProcessing) return;
      const review = reviews.find((r) => r.id === id);
      if (!review) return;
      setIsProcessing(true);
      try {
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
        await reloadReviews();
        if (isCloudConnected) await fetchCloudReviews();
        void fetchPendingReviewCount();
      } catch (err) {
        logger.error('Failed to action review', { error: err });
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, reviews, respondToCloudReview, reloadReviews, isCloudConnected, fetchCloudReviews, fetchPendingReviewCount],
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
    loading, isProcessing, handleReviewAction, handleMarkRead,
  };
}
