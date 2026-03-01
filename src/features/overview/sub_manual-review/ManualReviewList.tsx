import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, ClipboardCheck, CheckSquare, Square, AlertTriangle, ExternalLink } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { FilterBar } from '@/features/shared/components/FilterBar';
import DetailModal from '@/features/overview/components/DetailModal';
import { PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/types/frontendTypes';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { useVirtualList } from '@/hooks/utility/useVirtualList';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

/** Renders distinct shapes per severity for WCAG 1.4.1 compliance */
function SeverityIndicator({ severity }: { severity: string }) {
  const label = SEVERITY_LABELS[severity] ?? 'Info';

  if (severity === 'critical') {
    // Triangle shape — red
    return (
      <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
        <svg width="12" height="12" viewBox="0 0 12 12" className="block">
          <polygon points="6,1 11,11 1,11" fill="rgba(239,68,68,0.15)" stroke="rgba(239,68,68,0.5)" strokeWidth="1" />
          <text x="6" y="9.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(239,68,68,0.9)">!</text>
        </svg>
        <span className="sr-only">{label} severity</span>
      </span>
    );
  }

  if (severity === 'warning') {
    // Diamond shape — amber
    return (
      <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
        <svg width="12" height="12" viewBox="0 0 12 12" className="block">
          <polygon points="6,1 11,6 6,11 1,6" fill="rgba(245,158,11,0.15)" stroke="rgba(245,158,11,0.5)" strokeWidth="1" />
          <text x="6" y="8.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(245,158,11,0.9)">!</text>
        </svg>
        <span className="sr-only">{label} severity</span>
      </span>
    );
  }

  // info — circle shape — blue (default)
  return (
    <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
      <svg width="12" height="12" viewBox="0 0 12 12" className="block">
        <circle cx="6" cy="6" r="5" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.5)" strokeWidth="1" />
        <text x="6" y="8.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(59,130,246,0.9)">i</text>
      </svg>
      <span className="sr-only">{label} severity</span>
    </span>
  );
}

type FilterStatus = 'all' | ManualReviewStatus;

const FILTER_LABELS: Record<FilterStatus, string> = {
  all: 'All',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ManualReviewList() {
  const manualReviews = usePersonaStore((s) => s.manualReviews);
  const personas = usePersonaStore((s) => s.personas);
  const fetchManualReviews = usePersonaStore((s) => s.fetchManualReviews);
  const updateManualReview = usePersonaStore((s) => s.updateManualReview);

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [selectedReview, setSelectedReview] = useState<ManualReviewItem | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ManualReviewStatus | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Always fetch all reviews so we can compute counts client-side
  useEffect(() => {
    fetchManualReviews();
  }, [fetchManualReviews]);

  // Compute counts from the full reviews array
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: manualReviews.length, pending: 0, approved: 0, rejected: 0 };
    for (const r of manualReviews) {
      if (r.status in counts) counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    return counts;
  }, [manualReviews]);

  // Filter client-side by status and persona
  const filteredReviews = useMemo(() => {
    let result = manualReviews;
    if (filter !== 'all') {
      result = result.filter((r) => r.status === filter);
    }
    if (selectedPersonaId) {
      result = result.filter((r) => r.persona_id === selectedPersonaId);
    }
    return result;
  }, [manualReviews, filter, selectedPersonaId]);

  // Pending reviews in the current filtered view (selectable)
  const selectablePendingIds = useMemo(
    () => new Set(filteredReviews.filter((r) => r.status === 'pending').map((r) => r.id)),
    [filteredReviews]
  );

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedIds(new Set());
    setConfirmAction(null);
    setBulkError(null);
  }, [filter, selectedPersonaId]);

  // Sync modal notes when opening a review
  useEffect(() => {
    if (selectedReview) {
      setNotes(selectedReview.reviewer_notes || '');
    }
  }, [selectedReview]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === selectablePendingIds.size && selectablePendingIds.size > 0) {
        return new Set();
      }
      return new Set(selectablePendingIds);
    });
  }, [selectablePendingIds]);

  const handleBulkAction = useCallback(async (status: ManualReviewStatus) => {
    setIsBulkProcessing(true);
    setBulkError(null);
    try {
      const ids = Array.from(selectedIds);
      const results = await Promise.allSettled(
        ids.map((id) => updateManualReview(id, { status }))
      );

      const failedIds = new Set<string>();
      results.forEach((result, i) => {
        if (result.status === 'rejected') failedIds.add(ids[i]!);
      });

      if (failedIds.size === 0) {
        setSelectedIds(new Set());
        setConfirmAction(null);
      } else {
        // Keep failed IDs selected so the user can retry
        setSelectedIds(failedIds);
        setConfirmAction(null);
        const failedReviews = manualReviews.filter((r) => failedIds.has(r.id));
        const names = failedReviews.map((r) => r.content.slice(0, 40)).join(', ');
        setBulkError(
          `${failedIds.size} of ${ids.length} review${ids.length !== 1 ? 's' : ''} failed: ${names}`
        );
      }
    } finally {
      setIsBulkProcessing(false);
    }
  }, [selectedIds, updateManualReview, manualReviews]);

  const handleModalAction = useCallback(async (newStatus: ManualReviewStatus) => {
    if (!selectedReview) return;
    await updateManualReview(selectedReview.id, {
      status: newStatus,
      reviewer_notes: notes || undefined,
    });
    setSelectedReview(null);
  }, [selectedReview, notes, updateManualReview]);

  const activeSelectionCount = useMemo(
    () => Array.from(selectedIds).filter((id) => selectablePendingIds.has(id)).length,
    [selectedIds, selectablePendingIds]
  );

  const { parentRef: reviewListRef, virtualizer } = useVirtualList(filteredReviews, 44);

  return (
    <ContentBox>
      <ContentHeader
        icon={<ClipboardCheck className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Manual Reviews"
        subtitle={`${manualReviews.length} review${manualReviews.length !== 1 ? 's' : ''} recorded`}
      />

      {/* Filter bar */}
      <FilterBar<FilterStatus>
        options={(['all', 'pending', 'approved', 'rejected'] as FilterStatus[]).map((id) => ({
          id,
          label: FILTER_LABELS[id],
          badge: statusCounts[id] ?? 0,
        }))}
        value={filter}
        onChange={setFilter}
        badgeStyle="paren"
        layoutIdPrefix="review-filter"
        trailing={
          <div className="ml-auto flex items-center gap-2">
            <PersonaSelect
              value={selectedPersonaId}
              onChange={setSelectedPersonaId}
              personas={personas}
            />
            {selectablePendingIds.size > 0 && (
              <button
                onClick={toggleSelectAll}
                data-testid="review-select-all-btn"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
              >
                {activeSelectionCount === selectablePendingIds.size ? (
                  <CheckSquare className="w-3.5 h-3.5" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
                Select all pending
              </button>
            )}
          </div>
        }
      />

      {/* Review table */}
      <ContentBody flex>
        {filteredReviews.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4 md:p-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                <ClipboardCheck className="w-5 h-5 text-muted-foreground/80" />
              </div>
              <p className="text-sm text-muted-foreground/90">No review items yet</p>
              <p className="text-sm text-muted-foreground/80 mt-1">Items that require approval will appear here</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-primary/15">
                <tr className="text-sm text-muted-foreground/80 uppercase tracking-wider">
                  <th className="w-10 px-3 py-2.5 text-left font-medium">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium min-w-[120px]">Persona</th>
                  <th className="px-3 py-2.5 text-left font-medium w-24">Severity</th>
                  <th className="px-3 py-2.5 text-left font-medium">Content</th>
                  <th className="px-3 py-2.5 text-left font-medium w-24">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium w-28">Created</th>
                </tr>
              </thead>
            </table>
            <div ref={reviewListRef} className="flex-1 overflow-y-auto">
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                <table className="w-full border-collapse">
                  <tbody>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const review = filteredReviews[virtualRow.index]!;
                      const status = STATUS_COLORS[review.status] ?? STATUS_COLORS.pending!;
                      const statusLabel = STATUS_LABELS[review.status] ?? 'Pending';
                      const isPending = review.status === 'pending';

                      return (
                        <tr
                          key={review.id}
                          onClick={() => setSelectedReview(review)}
                          style={{
                            position: 'absolute',
                            top: 0,
                            transform: `translateY(${virtualRow.start}px)`,
                            width: '100%',
                            height: `${virtualRow.size}px`,
                            display: 'table',
                            tableLayout: 'fixed',
                          }}
                          className="hover:bg-white/[0.03] cursor-pointer transition-colors border-b border-primary/[0.06]"
                        >
                          {/* Checkbox */}
                          <td className="w-10 px-3 py-2.5 align-middle">
                            {isPending ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleSelect(review.id); }}
                                className="text-muted-foreground/80 hover:text-muted-foreground transition-colors flex-shrink-0"
                              >
                                {selectedIds.has(review.id) ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-primary" />
                                ) : (
                                  <Square className="w-3.5 h-3.5" />
                                )}
                              </button>
                            ) : (
                              <div className="w-3.5" />
                            )}
                          </td>

                          {/* Persona */}
                          <td className="px-3 py-2.5 align-middle min-w-[120px]">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded-md flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
                                style={{ backgroundColor: (review.persona_color || '#6366f1') + '15' }}
                              >
                                {review.persona_icon || '?'}
                              </div>
                              <span className="text-sm text-muted-foreground/80 truncate">
                                {review.persona_name || 'Unknown'}
                              </span>
                            </div>
                          </td>

                          {/* Severity */}
                          <td className="px-3 py-2.5 align-middle w-24">
                            <div className="flex items-center gap-1.5">
                              <SeverityIndicator severity={review.severity} />
                              <span className="text-sm text-muted-foreground/70">
                                {SEVERITY_LABELS[review.severity] ?? 'Info'}
                              </span>
                            </div>
                          </td>

                          {/* Content (truncated) */}
                          <td className="px-3 py-2.5 align-middle">
                            <span className="text-sm text-foreground/80 truncate block">
                              {review.content.slice(0, 100)}
                            </span>
                          </td>

                          {/* Status badge */}
                          <td className="px-3 py-2.5 align-middle w-24">
                            <span className={`inline-block px-2 py-0.5 rounded-md text-sm font-medium border ${status.bgColor} ${status.color} ${status.borderColor}`}>
                              {statusLabel}
                            </span>
                          </td>

                          {/* Created */}
                          <td className="px-3 py-2.5 align-middle w-28 text-right">
                            <span className="text-sm text-muted-foreground/80">
                              {formatRelativeTime(review.created_at)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </ContentBody>

      {/* Detail modal */}
      <AnimatePresence>
        {selectedReview && (
          <DetailModal
            title={selectedReview.persona_name || 'Unknown Persona'}
            subtitle={`${STATUS_LABELS[selectedReview.status] ?? 'Pending'} \u00b7 ${SEVERITY_LABELS[selectedReview.severity] ?? 'Info'} severity`}
            onClose={() => setSelectedReview(null)}
            actions={
              selectedReview.status === 'pending' ? (
                <>
                  <button
                    onClick={() => handleModalAction('approved')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleModalAction('rejected')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </>
              ) : undefined
            }
          >
            <div className="space-y-4">
              {/* Content */}
              <div>
                <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-1.5">Content</div>
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{selectedReview.content}</p>
              </div>

              {/* Reviewer notes textarea (pending items) */}
              {selectedReview.status === 'pending' && (
                <div>
                  <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-1.5">Reviewer Notes</div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add optional notes..."
                    className="w-full h-20 text-sm bg-background/50 border border-primary/15 rounded-lg p-3 text-foreground/80 placeholder:text-muted-foreground/80 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30"
                  />
                </div>
              )}

              {/* Show reviewer notes for non-pending items */}
              {selectedReview.status !== 'pending' && selectedReview.reviewer_notes && (
                <div>
                  <div className="text-sm font-mono text-muted-foreground/90 uppercase mb-1.5">Reviewer Notes</div>
                  <p className="text-sm text-foreground/80 italic">{selectedReview.reviewer_notes}</p>
                </div>
              )}

              {/* Metadata */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground/80 pt-2 border-t border-primary/10">
                <span>ID: <span className="font-mono">{selectedReview.id}</span></span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const store = usePersonaStore.getState();
                    store.selectPersona(selectedReview.persona_id);
                    store.setEditorTab('use-cases');
                    setSelectedReview(null);
                  }}
                  className="inline-flex items-center gap-1 text-blue-400/70 hover:text-blue-400 transition-colors"
                  title={`View execution ${selectedReview.execution_id}`}
                >
                  View Execution
                  <ExternalLink className="w-3 h-3" />
                </button>
                {selectedReview.resolved_at && (
                  <span>Resolved: {new Date(selectedReview.resolved_at).toLocaleString()}</span>
                )}
              </div>
            </div>
          </DetailModal>
        )}
      </AnimatePresence>

      {/* Sticky bulk action bar */}
      <AnimatePresence>
        {activeSelectionCount > 0 && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 border-t border-primary/15 bg-secondary/40 backdrop-blur-sm px-4 py-3"
          >
            {bulkError && (
              <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1 truncate">{bulkError}</span>
                <button
                  onClick={() => setBulkError(null)}
                  className="text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {confirmAction ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-foreground/80">
                    {confirmAction === 'approved' ? 'Approve' : 'Reject'}{' '}
                    <span className="font-semibold">{activeSelectionCount}</span> review{activeSelectionCount !== 1 ? 's' : ''}?
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmAction(null)}
                    disabled={isBulkProcessing}
                    className="px-3 py-1.5 rounded-lg text-sm border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleBulkAction(confirmAction)}
                    disabled={isBulkProcessing}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                      confirmAction === 'approved'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                        : 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                    }`}
                  >
                    {isBulkProcessing ? 'Processing...' : 'Confirm'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground/80">
                  <span className="font-semibold text-foreground/90">{activeSelectionCount}</span> pending review{activeSelectionCount !== 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="px-3 py-1.5 rounded-lg text-sm border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 transition-colors"
                  >
                    Deselect
                  </button>
                  <button
                    onClick={() => setConfirmAction('approved')}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve All
                  </button>
                  <button
                    onClick={() => setConfirmAction('rejected')}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject All
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </ContentBox>
  );
}
