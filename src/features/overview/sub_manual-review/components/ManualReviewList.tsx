import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardCheck, Plus, BookOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { usePersonaMap, useEnrichedRecords } from "@/hooks/utility/data/usePersonaMap";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { seedMockManualReview } from '@/api/overview/reviews';
import { FILTER_LABELS, type FilterStatus, type SourceFilter } from '../libs/reviewHelpers';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { BulkActionBar } from './BulkActionBar';
import { dashboardItem } from '@/features/templates/animationPresets';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { createLogger } from "@/lib/log";

const logger = createLogger("manual-review");
import { ReviewInboxPanel } from './ReviewInboxPanel';
import { ReviewFilterTrailing } from './ReviewFilterTrailing';
import type { TriageReview } from './TriagePlayer';
import { ReviewFocusFlow } from './ReviewFocusFlow';

export default function ManualReviewList() {
  const { t } = useTranslation();
  const {
    manualReviews, cloudReviews,
    fetchManualReviews, fetchCloudReviews,
    updateManualReview, respondToCloudReview,
  } = useOverviewStore(useShallow((s) => ({
    manualReviews: s.manualReviews,
    cloudReviews: s.cloudReviews,
    fetchManualReviews: s.fetchManualReviews,
    fetchCloudReviews: s.fetchCloudReviews,
    updateManualReview: s.updateManualReview,
    respondToCloudReview: s.respondToCloudReview,
  })));
  const isCloudConnected = useSystemStore((s) => s.cloudConfig?.is_connected ?? false);
  const personas = useAgentStore((s) => s.personas);
  const personaMap = usePersonaMap();
  const enrichedManualReviews = useEnrichedRecords(manualReviews, personaMap);
  const enrichedCloudReviews = useEnrichedRecords(cloudReviews, personaMap);

  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ManualReviewStatus | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  useEffect(() => { fetchManualReviews(); }, [fetchManualReviews]);

  usePolling(fetchCloudReviews, {
    interval: POLLING_CONFIG.cloudReviews.interval,
    enabled: isCloudConnected,
    maxBackoff: POLLING_CONFIG.cloudReviews.maxBackoff,
  });

  const allReviews = useMemo(() => {
    const local = enrichedManualReviews.map((r) => ({ ...r, source: 'local' as const }));
    const merged = [...local, ...enrichedCloudReviews];
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return merged;
  }, [enrichedManualReviews, enrichedCloudReviews]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allReviews.length, pending: 0, approved: 0, rejected: 0 };
    for (const r of allReviews) { if (r.status in counts) counts[r.status] = (counts[r.status] ?? 0) + 1; }
    return counts;
  }, [allReviews]);

  const reviewMap = useMemo(() => new Map(allReviews.map((r) => [r.id, r])), [allReviews]);

  const { filtered: filteredReviews } = useFilteredCollection(allReviews, {
    exact: [
      { field: 'status', value: filter === 'all' ? null : filter },
      { field: 'source' as keyof typeof allReviews[0], value: sourceFilter === 'all' ? null : sourceFilter, fallback: 'local' },
      { field: 'persona_id', value: selectedPersonaId || null },
    ],
  });

  const activeReview = useMemo(() => filteredReviews.find((r) => r.id === activeReviewId) ?? null, [filteredReviews, activeReviewId]);
  useEffect(() => { if (!activeReview && filteredReviews.length > 0) setActiveReviewId(filteredReviews[0]!.id); }, [activeReview, filteredReviews]);
  useEffect(() => { setSelectedIds(new Set()); setConfirmAction(null); }, [filter, sourceFilter, selectedPersonaId]);
  const selectablePendingIds = useMemo(() => new Set(filteredReviews.filter((r) => r.status === 'pending').map((r) => r.id)), [filteredReviews]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === selectablePendingIds.size && selectablePendingIds.size > 0
        ? new Set()
        : new Set(selectablePendingIds),
    );
  }, [selectablePendingIds]);

  const handleAction = useCallback(async (idOrStatus: string | ManualReviewStatus, statusOrNotes?: ManualReviewStatus | string, maybeNotes?: string) => {
    // Overload: (id, status, notes?) or (status, notes?)
    let reviewToAct: typeof activeReview;
    let status: ManualReviewStatus;
    let notes: string | undefined;

    if (['approved', 'rejected', 'pending'].includes(idOrStatus)) {
      // Legacy: (status, notes?)
      reviewToAct = activeReview;
      status = idOrStatus as ManualReviewStatus;
      notes = statusOrNotes as string | undefined;
    } else {
      // New: (id, status, notes?)
      reviewToAct = allReviews.find((r) => r.id === idOrStatus) ?? null;
      status = statusOrNotes as ManualReviewStatus;
      notes = maybeNotes;
    }

    if (!reviewToAct || isProcessing) return;
    setIsProcessing(true);
    try {
      if (reviewToAct.source === 'cloud') {
        await respondToCloudReview(reviewToAct.id, reviewToAct.execution_id, status === 'approved' ? 'approve' : 'reject', notes ?? '');
      } else {
        await updateManualReview(reviewToAct.id, { status, reviewer_notes: notes });
      }
      const nextPending = filteredReviews.find((r) => r.id !== reviewToAct!.id && r.status === 'pending');
      if (nextPending) setActiveReviewId(nextPending.id);
    } finally { setIsProcessing(false); }
  }, [activeReview, allReviews, isProcessing, updateManualReview, respondToCloudReview, filteredReviews]);

  const handleBulkAction = useCallback(async (status: ManualReviewStatus) => {
    setIsBulkProcessing(true);
    try {
      const decision = status === 'approved' ? 'approve' : 'reject';
      await Promise.allSettled(Array.from(selectedIds).map((id) => {
        const review = reviewMap.get(id);
        if (!review) return Promise.resolve();
        if (review.source === 'cloud') return respondToCloudReview(review.id, review.execution_id, decision, '');
        return updateManualReview(id, { status });
      }));
      setSelectedIds(new Set());
      setConfirmAction(null);
    } finally { setIsBulkProcessing(false); }
  }, [selectedIds, reviewMap, updateManualReview, respondToCloudReview]);

  const activeSelectionCount = useMemo(() => Array.from(selectedIds).filter((id) => selectablePendingIds.has(id)).length, [selectedIds, selectablePendingIds]);

  const { shouldAnimate } = useMotion();

  const handleSeedReview = useCallback(async () => {
    try { await seedMockManualReview(); await fetchManualReviews(); }
    catch (err) { logger.error('Failed to seed mock review', { error: err }); }
  }, [fetchManualReviews]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<ClipboardCheck className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.overview.review.title}
        subtitle={`${allReviews.length} ${t.overview.review.subtitle.replace('{count}', '')} · ${statusCounts.pending ?? 0} ${t.overview.review.filter_pending.toLowerCase()}${cloudReviews.length > 0 ? ` · ${cloudReviews.length} ${t.overview.review.cloud_badge.toLowerCase()}` : ''}`}
        actions={import.meta.env.DEV && (
          <button onClick={handleSeedReview} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title={t.overview.review.seed_tooltip}>
            <Plus className="w-3.5 h-3.5" /> {t.overview.review.mock_review}
          </button>
        )}
      />

      <FilterBar<FilterStatus>
        options={(['all', 'pending', 'approved', 'rejected'] as FilterStatus[]).map((id) => ({
          id, label: FILTER_LABELS[id], badge: statusCounts[id] ?? 0,
        }))}
        value={filter} onChange={setFilter} badgeStyle="paren" layoutIdPrefix="review-filter"
        trailing={
          <ReviewFilterTrailing
            isCloudConnected={isCloudConnected}
            sourceFilter={sourceFilter}
            onSourceFilterChange={setSourceFilter}
            selectedPersonaId={selectedPersonaId}
            onPersonaChange={setSelectedPersonaId}
            personas={personas}
            selectablePendingCount={selectablePendingIds.size}
            activeSelectionCount={activeSelectionCount}
            onToggleSelectAll={toggleSelectAll}
          />
        }
      />

      <ContentBody flex>
        <AnimatePresence mode="wait">
        {filteredReviews.length === 0 ? (
          <motion.div
            key="empty"
            className="flex-1 flex items-center justify-center p-6"
            variants={shouldAnimate ? dashboardItem : undefined}
            initial={shouldAnimate ? "hidden" : false}
            animate="show"
            exit={shouldAnimate ? "exit" : undefined}
          >
            <EmptyState
              icon={ClipboardCheck}
              title={t.overview.review.empty_title}
              subtitle={t.overview.review.empty_subtitle}
              action={{ label: t.overview.dashboard.create_persona, onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus }}
              secondaryAction={{ label: t.overview.dashboard.from_templates, onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen }}
            />
          </motion.div>
        ) : filter === 'pending' ? (
          <motion.div
            key="focus"
            className="flex-1 overflow-hidden"
            variants={shouldAnimate ? dashboardItem : undefined}
            initial={shouldAnimate ? "hidden" : false}
            animate="show"
            exit={shouldAnimate ? "exit" : undefined}
          >
            <ReviewFocusFlow
              reviews={filteredReviews as TriageReview[]}
              onApprove={(id: string, notes?: string) => handleAction(id, 'approved' as ManualReviewStatus, notes)}
              onReject={(id: string, notes?: string) => handleAction(id, 'rejected' as ManualReviewStatus, notes)}
              isProcessing={isProcessing}
            />
          </motion.div>
        ) : (
          <motion.div
            key={`inbox-${filter}`}
            className="flex-1 min-h-0 flex flex-col"
            variants={shouldAnimate ? dashboardItem : undefined}
            initial={shouldAnimate ? "hidden" : false}
            animate="show"
            exit={shouldAnimate ? "exit" : undefined}
          >
            <ReviewInboxPanel
              filteredReviews={filteredReviews}
              activeReviewId={activeReviewId}
              activeReview={activeReview}
              selectedIds={selectedIds}
              isProcessing={isProcessing}
              onSelectReview={setActiveReviewId}
              onToggleSelect={toggleSelect}
              onAction={handleAction}
            />
          </motion.div>
        )}
        </AnimatePresence>
      </ContentBody>

      <BulkActionBar
        activeSelectionCount={activeSelectionCount}
        confirmAction={confirmAction}
        isBulkProcessing={isBulkProcessing}
        onConfirmAction={setConfirmAction}
        onBulkAction={handleBulkAction}
        onDeselect={() => setSelectedIds(new Set())}
      />
    </ContentBox>
  );
}
