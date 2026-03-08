import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, ClipboardCheck, MessageSquare, AlertTriangle, CheckSquare, Square, Plus, Cloud, Monitor } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { FilterBar } from '@/features/shared/components/FilterBar';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import type { ManualReviewStatus } from '@/lib/types/frontendTypes';
import { seedMockManualReview } from '@/api/reviews';
import { FILTER_LABELS, SOURCE_LABELS, type FilterStatus, type SourceFilter } from '../libs/reviewHelpers';
import { InboxItem } from './ReviewListItem';
import { ConversationThread } from './ReviewDetailPanel';

export default function ManualReviewList() {
  const manualReviews = usePersonaStore((s) => s.manualReviews);
  const cloudReviews = usePersonaStore((s) => s.cloudReviews);
  const isCloudConnected = usePersonaStore((s) => s.cloudConfig?.is_connected ?? false);
  const personas = usePersonaStore((s) => s.personas);
  const fetchManualReviews = usePersonaStore((s) => s.fetchManualReviews);
  const fetchCloudReviews = usePersonaStore((s) => s.fetchCloudReviews);
  const updateManualReview = usePersonaStore((s) => s.updateManualReview);
  const respondToCloudReview = usePersonaStore((s) => s.respondToCloudReview);

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ManualReviewStatus | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  useEffect(() => { fetchManualReviews(); }, [fetchManualReviews]);

  useEffect(() => {
    if (!isCloudConnected) return;
    fetchCloudReviews();
    const interval = setInterval(fetchCloudReviews, 15_000);
    return () => clearInterval(interval);
  }, [isCloudConnected, fetchCloudReviews]);

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

  const filteredReviews = useMemo(() => {
    let result = allReviews;
    if (filter !== 'all') result = result.filter((r) => r.status === filter);
    if (sourceFilter !== 'all') result = result.filter((r) => (r.source ?? 'local') === sourceFilter);
    if (selectedPersonaId) result = result.filter((r) => r.persona_id === selectedPersonaId);
    return result;
  }, [allReviews, filter, sourceFilter, selectedPersonaId]);

  const activeReview = useMemo(() => filteredReviews.find((r) => r.id === activeReviewId) ?? null, [filteredReviews, activeReviewId]);

  useEffect(() => { if (!activeReview && filteredReviews.length > 0) setActiveReviewId(filteredReviews[0]!.id); }, [activeReview, filteredReviews]);
  useEffect(() => { setSelectedIds(new Set()); setConfirmAction(null); }, [filter, sourceFilter, selectedPersonaId]);

  const selectablePendingIds = useMemo(() => new Set(filteredReviews.filter((r) => r.status === 'pending').map((r) => r.id)), [filteredReviews]);
  const toggleSelect = useCallback((id: string) => { setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }, []);
  const toggleSelectAll = useCallback(() => { setSelectedIds((prev) => prev.size === selectablePendingIds.size && selectablePendingIds.size > 0 ? new Set() : new Set(selectablePendingIds)); }, [selectablePendingIds]);

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
        const review = allReviews.find((r) => r.id === id);
        if (!review) return Promise.resolve();
        if (review.source === 'cloud') return respondToCloudReview(review.id, review.execution_id, decision, '');
        return updateManualReview(id, { status });
      }));
      setSelectedIds(new Set());
      setConfirmAction(null);
    } finally { setIsBulkProcessing(false); }
  }, [selectedIds, allReviews, updateManualReview, respondToCloudReview]);

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
        options={(['all', 'pending', 'approved', 'rejected'] as FilterStatus[]).map((id) => ({ id, label: FILTER_LABELS[id], badge: statusCounts[id] ?? 0 }))}
        value={filter} onChange={setFilter} badgeStyle="paren" layoutIdPrefix="review-filter"
        trailing={
          <div className="ml-auto flex items-center gap-2">
            {isCloudConnected && (
              <div className="flex items-center rounded-xl border border-primary/15 overflow-hidden text-xs">
                {(['all', 'local', 'cloud'] as SourceFilter[]).map((src) => (
                  <button key={src} onClick={() => setSourceFilter(src)} className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${sourceFilter === src ? 'bg-primary/10 text-foreground/90 font-medium' : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-white/[0.03]'}`}>
                    {src === 'local' && <Monitor className="w-3 h-3" />}
                    {src === 'cloud' && <Cloud className="w-3 h-3" />}
                    {SOURCE_LABELS[src]}
                  </button>
                ))}
              </div>
            )}
            <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
            {selectablePendingIds.size > 0 && (
              <button onClick={toggleSelectAll} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40 transition-colors">
                {activeSelectionCount === selectablePendingIds.size ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />} Select all
              </button>
            )}
          </div>
        }
      />

      <ContentBody flex>
        {filteredReviews.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center"><ClipboardCheck className="w-6 h-6 text-muted-foreground/60" /></div>
              <p className="text-sm font-medium text-foreground/70">No review items yet</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Items requiring approval will appear here</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-[340px] 2xl:w-[420px] flex-shrink-0 border-r border-primary/10 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto">
                {filteredReviews.map((review) => (
                  <div key={review.id} className="flex items-start">
                    {review.status === 'pending' && (
                      <button onClick={(e) => { e.stopPropagation(); toggleSelect(review.id); }} className="flex-shrink-0 w-8 flex items-center justify-center pt-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                        {selectedIds.has(review.id) ? <CheckSquare className="w-3.5 h-3.5 text-primary" /> : <Square className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <div className={`flex-1 min-w-0 ${review.status !== 'pending' ? 'pl-8' : ''}`}>
                      <InboxItem review={review} isActive={review.id === activeReviewId} onClick={() => setActiveReviewId(review.id)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              {activeReview ? (
                <ConversationThread key={activeReview.id} review={activeReview} onAction={handleAction} isProcessing={isProcessing} />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center"><MessageSquare className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" /><p className="text-sm text-muted-foreground/50">Select a review to view</p></div>
                </div>
              )}
            </div>
          </div>
        )}
      </ContentBody>

      <AnimatePresence>
        {activeSelectionCount > 0 && (
          <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0 border-t border-primary/15 bg-secondary/40 backdrop-blur-sm px-4 py-3">
            {confirmAction ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm"><AlertTriangle className="w-4 h-4 text-amber-400" /><span className="text-foreground/80">{confirmAction === 'approved' ? 'Approve' : 'Reject'} <span className="font-semibold">{activeSelectionCount}</span> review{activeSelectionCount !== 1 ? 's' : ''}?</span></div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setConfirmAction(null)} disabled={isBulkProcessing} className="px-3 py-1.5 rounded-xl text-sm border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 transition-colors">Cancel</button>
                  <button onClick={() => handleBulkAction(confirmAction)} disabled={isBulkProcessing} className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${confirmAction === 'approved' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25' : 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'}`}>{isBulkProcessing ? 'Processing...' : 'Confirm'}</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground/80"><span className="font-semibold text-foreground/90">{activeSelectionCount}</span> pending review{activeSelectionCount !== 1 ? 's' : ''} selected</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 rounded-xl text-sm border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 transition-colors">Deselect</button>
                  <button onClick={() => setConfirmAction('approved')} className="px-3 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />Approve All</button>
                  <button onClick={() => setConfirmAction('rejected')} className="px-3 py-1.5 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"><X className="w-3.5 h-3.5" />Reject All</button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </ContentBox>
  );
}
