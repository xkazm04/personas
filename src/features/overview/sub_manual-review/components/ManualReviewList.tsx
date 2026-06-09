import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardCheck, Plus, BookOpen, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { IllustrationEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from "@/stores/toastStore";
import { usePersonaMap, useEnrichedRecords } from "@/hooks/utility/data/usePersonaMap";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { ManualReviewItem } from '@/lib/types/types';
import { seedMockManualReview, gcStaleManualReviews, updateManualReviewStatus, dispatchReviewAction, deleteAllManualReviews } from '@/api/overview/reviews';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { toastCatch } from '@/lib/silentCatch';
import { FILTER_LABELS, type FilterStatus, type SourceFilter } from '../libs/reviewHelpers';
import { useManualReviewQueue } from '../hooks/useManualReviewQueue';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { BulkActionBar } from './BulkActionBar';
import { dashboardItem } from '@/lib/utils/animation/animationPresets';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { createLogger } from "@/lib/log";

const logger = createLogger("manual-review");
import { ReviewInboxPanel } from './ReviewInboxPanel';
import { BacklogInboxGroup } from './BacklogInboxGroup';
import { ReviewFilterTrailing } from './ReviewFilterTrailing';
import type { TriageReview } from './reviewFocusHelpers';
import { ReviewFocusFlow } from './ReviewFocusFlow';
import { debtText } from '@/i18n/DebtText';

/**
 * Shape a raw `PersonaManualReview` row (as returned by the layered
 * `useManualReviewQueue`) into the `ManualReviewItem` the review UI
 * consumes — mirrors the transform the old fetch-all `overviewSlice`
 * path used to do.
 */
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
  };
}

export default function ManualReviewList() {
  const { t, tx } = useTranslation();
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const {
    cloudReviews, fetchCloudReviews, respondToCloudReview,
  } = useOverviewStore(useShallow((s) => ({
    cloudReviews: s.cloudReviews,
    fetchCloudReviews: s.fetchCloudReviews,
    respondToCloudReview: s.respondToCloudReview,
  })));
  const isCloudConnected = useSystemStore((s) => s.cloudConfig?.is_connected ?? false);
  const personas = useAgentStore((s) => s.personas);
  const personaMap = usePersonaMap();

  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ManualReviewStatus | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Layered fetch — L0 counts + L1/L2 keyset pages. Status + persona
  // filters are pushed server-side; the client never materialises the
  // whole persona_manual_reviews table (see useManualReviewQueue).
  const reviewQueue = useManualReviewQueue({
    status: filter === 'all' ? undefined : filter,
    personaId: selectedPersonaId || undefined,
  });

  const localReviews = useMemo(
    () => reviewQueue.rows.map(shapeReview),
    [reviewQueue.rows],
  );
  const enrichedManualReviews = useEnrichedRecords(localReviews, personaMap);
  const enrichedCloudReviews = useEnrichedRecords(cloudReviews, personaMap);

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

  // Filter-tab badges read the L0 counts (one GROUP BY) for the local
  // reviews — accurate over the whole table even though only a page is
  // loaded — plus the (small, fully-loaded) cloud set.
  const statusCounts = useMemo(() => {
    const cloud = { pending: 0, approved: 0, rejected: 0, resolved: 0 };
    for (const r of enrichedCloudReviews) {
      if (r.status in cloud) cloud[r.status as keyof typeof cloud]++;
    }
    const c = reviewQueue.counts;
    return {
      all: (c?.total ?? 0) + enrichedCloudReviews.length,
      pending: (c?.pending ?? 0) + cloud.pending,
      approved: (c?.approved ?? 0) + cloud.approved,
      rejected: (c?.rejected ?? 0) + cloud.rejected,
      resolved: (c?.resolved ?? 0) + cloud.resolved,
    };
  }, [reviewQueue.counts, enrichedCloudReviews]);

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
        await updateManualReviewStatus(reviewToAct.id, status, notes);
      }
      const nextPending = filteredReviews.find((r) => r.id !== reviewToAct!.id && r.status === 'pending');
      if (nextPending) setActiveReviewId(nextPending.id);
      // Refresh L0 counts + L1 page so the acted-on row leaves the list.
      reviewQueue.reload();
    } finally { setIsProcessing(false); }
  }, [activeReview, allReviews, isProcessing, respondToCloudReview, filteredReviews, reviewQueue.reload]);

  // Phase 5b — choose a suggested action: resolve + dispatch a follow-up run
  // (the same action model as the Quick Answer stepper). Cloud reviews record
  // the choice as an approval (no dispatch path).
  const handleDispatchAction = useCallback(async (id: string, action: string) => {
    const reviewToAct = allReviews.find((r) => r.id === id) ?? activeReview;
    if (!reviewToAct || isProcessing) return;
    setIsProcessing(true);
    try {
      if (reviewToAct.source === 'cloud') {
        await respondToCloudReview(reviewToAct.id, reviewToAct.execution_id, 'approve', action);
      } else {
        await dispatchReviewAction(reviewToAct.id, action);
      }
      const nextPending = filteredReviews.find((r) => r.id !== reviewToAct.id && r.status === 'pending');
      if (nextPending) setActiveReviewId(nextPending.id);
      reviewQueue.reload();
    } finally { setIsProcessing(false); }
  }, [activeReview, allReviews, isProcessing, respondToCloudReview, filteredReviews, reviewQueue.reload]);

  const handleBulkAction = useCallback(async (status: ManualReviewStatus) => {
    setIsBulkProcessing(true);
    try {
      const decision = status === 'approved' ? 'approve' : 'reject';
      await Promise.allSettled(Array.from(selectedIds).map((id) => {
        const review = reviewMap.get(id);
        if (!review) return Promise.resolve();
        if (review.source === 'cloud') return respondToCloudReview(review.id, review.execution_id, decision, '');
        return updateManualReviewStatus(id, status);
      }));
      setSelectedIds(new Set());
      setConfirmAction(null);
      reviewQueue.reload();
    } finally { setIsBulkProcessing(false); }
  }, [selectedIds, reviewMap, respondToCloudReview, reviewQueue.reload]);

  const activeSelectionCount = useMemo(() => Array.from(selectedIds).filter((id) => selectablePendingIds.has(id)).length, [selectedIds, selectablePendingIds]);

  const { shouldAnimate } = useMotion();

  const handleSeedReview = useCallback(async () => {
    try { await seedMockManualReview(); reviewQueue.reload(); }
    catch (err) { logger.error('Failed to seed mock review', { error: err }); }
  }, [reviewQueue.reload]);

  // A-grade Phase 8 (2026-05-04) — on-demand stale-review GC. The same
  // sweep runs once at startup via `engine::background`, but giving the
  // user an explicit button means they don't have to restart to clear
  // accumulation from a long-running session. 7-day default mirrors the
  // backend constant — passing `null` lets the Tauri command pick.
  const [isGcing, setIsGcing] = useState(false);
  const handleGcStale = useCallback(async () => {
    if (isGcing) return;
    setIsGcing(true);
    try {
      const resolved = await gcStaleManualReviews();
      reviewQueue.reload();
      const toastStore = useToastStore.getState();
      if (resolved > 0) {
        toastStore.addToast(
          `Auto-resolved ${resolved} stale review${resolved === 1 ? '' : 's'} (older than 7 days).`,
          'success',
          2400,
        );
      } else {
        toastStore.addToast('No stale reviews to clear.', 'success', 1600);
      }
    } catch (err) {
      logger.error('Failed to GC stale reviews', { error: err });
      useToastStore.getState().addToast(
        'Could not clear stale reviews — see logs.',
        'error',
        2400,
      );
    } finally {
      setIsGcing(false);
    }
  }, [isGcing, reviewQueue.reload]);

  // Hard-delete ALL local manual reviews (confirm-gated). Distinct from the
  // "Clear stale" sweep above, which only auto-resolves old pending rows.
  const handleDeleteAll = useCallback(async () => {
    if (isDeletingAll) return;
    setIsDeletingAll(true);
    try {
      await deleteAllManualReviews();
      reviewQueue.reload();
    } catch (err) {
      toastCatch('ManualReviewList:deleteAll', 'Failed to delete all reviews')(err);
    } finally {
      setIsDeletingAll(false);
      setConfirmingDeleteAll(false);
    }
  }, [isDeletingAll, reviewQueue.reload]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<ClipboardCheck className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.overview.review.title}
        subtitle={`${statusCounts.all} ${t.overview.review.subtitle.replace('{count}', '')} · ${statusCounts.pending ?? 0} ${t.overview.review.filter_pending.toLowerCase()}${cloudReviews.length > 0 ? ` · ${cloudReviews.length} ${t.overview.review.cloud_badge.toLowerCase()}` : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            {/* A-grade Phase 8 — on-demand sweep. Always visible (unlike
                the dev-only seed button below) because it's idempotent
                and safe; matches the auto-aging contract that runs at
                startup. Hidden when there are zero reviews of any kind
                — nothing to clear. */}
            {statusCounts.all > 0 && (
              <button
                onClick={() => void handleGcStale()}
                disabled={isGcing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-heading bg-foreground/5 text-foreground border border-border/30 hover:bg-foreground/10 hover:text-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={debtText("auto_auto_resolve_any_review_left_in_pending_fo_07992b1b")}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isGcing ? 'Clearing…' : 'Clear stale'}
              </button>
            )}
            {(reviewQueue.counts?.total ?? 0) > 0 && (
              <button
                onClick={() => setConfirmingDeleteAll(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-heading bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
                title={t.overview.review.delete_all}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {import.meta.env.DEV && (
              <button onClick={handleSeedReview} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title={t.overview.review.seed_tooltip}>
                <Plus className="w-3.5 h-3.5" /> {t.overview.review.mock_review}
              </button>
            )}
          </div>
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
        {/* #1 — Dev Tools backlog (pending scanned ideas) triaged inline here,
            so reviews + backlog candidates live in one inbox. */}
        <BacklogInboxGroup />
        <AnimatePresence mode="wait">
        {reviewQueue.loading && filteredReviews.length === 0 ? (
          <div key="loading" className="flex-1 min-h-0 overflow-hidden">
            <ListSkeleton rows={8} rowHeight={84} />
          </div>
        ) : filteredReviews.length === 0 ? (
          <motion.div
            key="empty"
            className="flex-1 flex items-center justify-center p-6"
            variants={shouldAnimate ? dashboardItem : undefined}
            initial={shouldAnimate ? "hidden" : false}
            animate="show"
            exit={shouldAnimate ? "exit" : undefined}
          >
            <IllustrationEmptyState
              motif="approval"
              content={{
                icon: ClipboardCheck,
                title: t.overview.review.empty_title,
                subtitle: t.overview.review.empty_subtitle,
                action: { label: t.overview.dashboard.create_persona, onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus },
                secondaryAction: { label: t.overview.dashboard.from_templates, onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen },
              }}
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
              onDispatchAction={handleDispatchAction}
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
              revealKey={`${filter}|${sourceFilter}|${selectedPersonaId}`}
              activeReviewId={activeReviewId}
              activeReview={activeReview}
              selectedIds={selectedIds}
              isProcessing={isProcessing}
              onSelectReview={setActiveReviewId}
              onToggleSelect={toggleSelect}
              onAction={handleAction}
              sentinelRef={reviewQueue.sentinelRef}
              hasMore={reviewQueue.hasMore}
              loadingMore={reviewQueue.loadingMore}
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

      {confirmingDeleteAll && (
        <ConfirmDialog
          danger
          title={t.overview.review.delete_all_confirm_title}
          body={tx(t.overview.review.delete_all_confirm_body, { count: reviewQueue.counts?.total ?? 0 })}
          confirmLabel={t.overview.review.delete_all_confirm_cta}
          onConfirm={handleDeleteAll}
          onCancel={() => setConfirmingDeleteAll(false)}
        />
      )}
    </ContentBox>
  );
}
