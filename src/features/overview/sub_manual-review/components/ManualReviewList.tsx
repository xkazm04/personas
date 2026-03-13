import { useEffect, useState, useMemo, useCallback } from 'react';
import { ClipboardCheck, Plus } from 'lucide-react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { seedMockManualReview } from '@/api/overview/reviews';
import { FILTER_LABELS, type FilterStatus, type SourceFilter } from '../libs/reviewHelpers';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { BulkActionBar } from './BulkActionBar';
import { ReviewInboxPanel } from './ReviewInboxPanel';
import { ReviewFilterTrailing } from './ReviewFilterTrailing';

export default function ManualReviewList() {
  const manualReviews = useOverviewStore((s) => s.manualReviews);
  const cloudReviews = useOverviewStore((s) => s.cloudReviews);
  const isCloudConnected = useSystemStore((s) => s.cloudConfig?.is_connected ?? false);
  const personas = useAgentStore((s) => s.personas);
  const fetchManualReviews = useOverviewStore((s) => s.fetchManualReviews);
  const fetchCloudReviews = useOverviewStore((s) => s.fetchCloudReviews);
  const updateManualReview = useOverviewStore((s) => s.updateManualReview);
  const respondToCloudReview = useOverviewStore((s) => s.respondToCloudReview);

  const [filter, setFilter] = useState<FilterStatus>('all');
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
    const local = manualReviews.map((r) => ({ ...r, source: 'local' as const }));
    const merged = [...local, ...cloudReviews];
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return merged;
  }, [manualReviews, cloudReviews]);

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

  const handleAction = useCallback(async (status: ManualReviewStatus, notes?: string) => {
    if (!activeReview || isProcessing) return;
    setIsProcessing(true);
    try {
      if (activeReview.source === 'cloud') {
        await respondToCloudReview(activeReview.id, activeReview.execution_id, status === 'approved' ? 'approve' : 'reject', notes ?? '');
      } else {
        await updateManualReview(activeReview.id, { status, reviewer_notes: notes });
      }
      const nextPending = filteredReviews.find((r) => r.id !== activeReview.id && r.status === 'pending');
      if (nextPending) setActiveReviewId(nextPending.id);
    } finally { setIsProcessing(false); }
  }, [activeReview, isProcessing, updateManualReview, respondToCloudReview, filteredReviews]);

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

  const handleSeedReview = useCallback(async () => {
    try { await seedMockManualReview(); await fetchManualReviews(); }
    catch (err) { console.error('Failed to seed mock review:', err); }
  }, [fetchManualReviews]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<ClipboardCheck className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Manual Reviews"
        subtitle={`${allReviews.length} review${allReviews.length !== 1 ? 's' : ''} · ${statusCounts.pending ?? 0} pending${cloudReviews.length > 0 ? ` · ${cloudReviews.length} cloud` : ''}`}
        actions={import.meta.env.DEV && (
          <button onClick={handleSeedReview} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock review (dev only)">
            <Plus className="w-3.5 h-3.5" /> Mock Review
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
        {filteredReviews.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                <ClipboardCheck className="w-6 h-6 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium text-foreground/70">No review items yet</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Items requiring approval will appear here</p>
            </div>
          </div>
        ) : (
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
        )}
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
