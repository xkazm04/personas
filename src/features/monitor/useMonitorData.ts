// useMonitorData — data layer for the Persona Monitor.
//
// Gathers the three feeds the Monitor fuses: the persona roster, the pending
// human-review queue (local + cloud), and live process activity. Self-
// contained — the Monitor can mount this from the titlebar without depending
// on the Overview dashboard pipeline.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { listManualReviews, updateManualReviewStatus } from '@/api/overview/reviews';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import { createLogger } from '@/lib/log';

const logger = createLogger('persona-monitor');

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
  reviews: ManualReviewItem[];
  activeProcesses: Record<string, import('@/stores/slices/processActivitySlice').ActiveProcess>;
  loading: boolean;
  isProcessing: boolean;
  handleAction: (id: string, status: ManualReviewStatus, notes?: string) => Promise<void>;
}

export function useMonitorData(): MonitorData {
  const personas = useAgentStore((s) => s.personas);
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  const cloudReviews = useOverviewStore((s) => s.cloudReviews);
  const fetchCloudReviews = useOverviewStore((s) => s.fetchCloudReviews);
  const respondToCloudReview = useOverviewStore((s) => s.respondToCloudReview);
  const fetchPendingReviewCount = useOverviewStore((s) => s.fetchPendingReviewCount);
  const isCloudConnected = useSystemStore((s) => s.cloudConfig?.is_connected ?? false);

  const [localReviews, setLocalReviews] = useState<ManualReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const reloadLocal = useCallback(async () => {
    try {
      const raw = await listManualReviews(undefined, 'pending');
      setLocalReviews(raw.map(shapeReview));
    } catch (err) {
      logger.error('Failed to load manual reviews', { error: err });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reloadLocal(); }, [reloadLocal]);
  useEffect(() => { if (isCloudConnected) void fetchCloudReviews(); }, [isCloudConnected, fetchCloudReviews]);

  // Local reviews aren't event-driven — poll to catch ones created by
  // executions while the Monitor is open. Process activity is already live
  // via the PROCESS_ACTIVITY event bridge, so it needs no poll here.
  usePolling(reloadLocal, { interval: POLLING_CONFIG.dashboardRefresh.interval, enabled: true });
  usePolling(fetchCloudReviews, {
    interval: POLLING_CONFIG.cloudReviews.interval,
    enabled: isCloudConnected,
    maxBackoff: POLLING_CONFIG.cloudReviews.maxBackoff,
  });

  const reviews = useMemo<ManualReviewItem[]>(
    () => [...localReviews, ...cloudReviews.filter((r) => r.status === 'pending')],
    [localReviews, cloudReviews],
  );

  const handleAction = useCallback(
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
        await reloadLocal();
        if (isCloudConnected) await fetchCloudReviews();
        // Keep the titlebar attention badge in sync without waiting for the
        // 30s sidebar poll.
        void fetchPendingReviewCount();
      } catch (err) {
        logger.error('Failed to action review', { error: err });
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, reviews, respondToCloudReview, reloadLocal, isCloudConnected, fetchCloudReviews, fetchPendingReviewCount],
  );

  return { personas, reviews, activeProcesses, loading, isProcessing, handleAction };
}
