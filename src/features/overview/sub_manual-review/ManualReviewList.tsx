import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Check, X, ClipboardCheck, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/types/frontendTypes';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { STATUS_COLORS } from '@/lib/utils/designTokens';

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

const filterOptions: Array<{ id: FilterStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ManualReviewList() {
  const manualReviews = usePersonaStore((s) => s.manualReviews);
  const fetchManualReviews = usePersonaStore((s) => s.fetchManualReviews);
  const updateManualReview = usePersonaStore((s) => s.updateManualReview);

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ManualReviewStatus | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

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

  // Filter client-side
  const filteredReviews = useMemo(() => {
    if (filter === 'all') return manualReviews;
    return manualReviews.filter((r) => r.status === filter);
  }, [manualReviews, filter]);

  // Pending reviews in the current filtered view (selectable)
  const selectablePendingIds = useMemo(
    () => new Set(filteredReviews.filter((r) => r.status === 'pending').map((r) => r.id)),
    [filteredReviews]
  );

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedIds(new Set());
    setConfirmAction(null);
  }, [filter]);

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
    try {
      const promises = Array.from(selectedIds).map((id) =>
        updateManualReview(id, { status })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      setConfirmAction(null);
    } finally {
      setIsBulkProcessing(false);
    }
  }, [selectedIds, updateManualReview]);

  const activeSelectionCount = useMemo(
    () => Array.from(selectedIds).filter((id) => selectablePendingIds.has(id)).length,
    [selectedIds, selectablePendingIds]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 pt-4">
      {/* Filter pills with count badges */}
      <div className="flex items-center gap-2 mb-4">
        {filterOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setFilter(opt.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              filter === opt.id
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary/30 text-muted-foreground/60 border-primary/15 hover:text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            {opt.label}
            <span className="opacity-60 ml-1">({statusCounts[opt.id] ?? 0})</span>
          </button>
        ))}

        {/* Select all toggle (only when there are pending items to select) */}
        {selectablePendingIds.size > 0 && (
          <button
            onClick={toggleSelectAll}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-secondary/40 transition-colors"
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

      {/* Review list */}
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {filteredReviews.length === 0 && (
          <div className="text-center py-16">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
              <ClipboardCheck className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground/50">No items requiring review</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {filteredReviews.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              isExpanded={expandedId === review.id}
              onToggle={() => setExpandedId(expandedId === review.id ? null : review.id)}
              onAction={updateManualReview}
              isSelected={selectedIds.has(review.id)}
              onSelect={review.status === 'pending' ? () => toggleSelect(review.id) : undefined}
            />
          ))}
        </AnimatePresence>
      </div>

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
                    className="px-3 py-1.5 rounded-lg text-xs border border-primary/15 text-muted-foreground/60 hover:bg-secondary/50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleBulkAction(confirmAction)}
                    disabled={isBulkProcessing}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
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
                <span className="text-xs text-muted-foreground/60">
                  <span className="font-semibold text-foreground/70">{activeSelectionCount}</span> pending review{activeSelectionCount !== 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="px-3 py-1.5 rounded-lg text-xs border border-primary/15 text-muted-foreground/60 hover:bg-secondary/50 transition-colors"
                  >
                    Deselect
                  </button>
                  <button
                    onClick={() => setConfirmAction('approved')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve All
                  </button>
                  <button
                    onClick={() => setConfirmAction('rejected')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review Row
// ---------------------------------------------------------------------------

function ReviewRow({
  review,
  isExpanded,
  onToggle,
  onAction,
  isSelected,
  onSelect,
}: {
  review: ManualReviewItem;
  isExpanded: boolean;
  onToggle: () => void;
  onAction: (id: string, updates: { status?: string; reviewer_notes?: string }) => Promise<void>;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const [notes, setNotes] = useState(review.reviewer_notes || '');
  const status = STATUS_COLORS[review.status] ?? STATUS_COLORS.pending!;
  const statusLabel = STATUS_LABELS[review.status] ?? 'Pending';

  const handleAction = async (newStatus: ManualReviewStatus) => {
    await onAction(review.id, {
      status: newStatus,
      reviewer_notes: notes || undefined,
    });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-xl border border-primary/15 bg-secondary/20 hover:bg-secondary/30 transition-colors overflow-hidden"
    >
      {/* Main row */}
      <div className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
        {/* Selection checkbox (pending only) */}
        {onSelect ? (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors flex-shrink-0"
          >
            {isSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <div className="w-3.5 flex-shrink-0" />
        )}

        {/* Expand icon */}
        <button onClick={onToggle} className="text-muted-foreground/40 flex-shrink-0">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {/* Clickable content area for expand/collapse */}
        <button onClick={onToggle} className="flex-1 flex items-center gap-3 text-left min-w-0">
          {/* Severity indicator (shape + label per WCAG 1.4.1) */}
          <SeverityIndicator severity={review.severity} />

          {/* Persona icon + name */}
          <div className="flex items-center gap-2 min-w-[120px]">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center text-xs border border-primary/15"
              style={{ backgroundColor: (review.persona_color || '#6366f1') + '15' }}
            >
              {review.persona_icon || '?'}
            </div>
            <span className="text-xs text-muted-foreground/60 truncate max-w-[80px]">
              {review.persona_name || 'Unknown'}
            </span>
          </div>

          {/* Content (used as title) */}
          <span className="flex-1 text-sm text-foreground/80 truncate">
            {review.content.slice(0, 100)}
          </span>

          {/* Status badge */}
          <div className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${status.bgColor} ${status.color} ${status.borderColor}`}>
            {statusLabel}
          </div>

          {/* Created */}
          <span className="text-xs text-muted-foreground/40 min-w-[70px] text-right">
            {formatRelativeTime(review.created_at)}
          </span>
        </button>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-primary/15 space-y-3">
              {/* Content */}
              <div>
                <div className="text-[11px] font-mono text-muted-foreground/50 uppercase mb-1.5">Content</div>
                <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">{review.content}</p>
              </div>

              {/* Reviewer notes */}
              {review.status === 'pending' && (
                <div>
                  <div className="text-[11px] font-mono text-muted-foreground/50 uppercase mb-1.5">Reviewer Notes</div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add optional notes..."
                    className="w-full h-20 text-sm bg-background/50 border border-primary/15 rounded-lg p-3 text-foreground/80 placeholder:text-muted-foreground/30 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30"
                  />
                </div>
              )}

              {/* Action buttons */}
              {review.status === 'pending' && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => handleAction('approved')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleAction('rejected')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              )}

              {/* Show reviewer notes for non-pending reviews */}
              {review.status !== 'pending' && review.reviewer_notes && (
                <div>
                  <div className="text-[11px] font-mono text-muted-foreground/50 uppercase mb-1.5">Reviewer Notes</div>
                  <p className="text-sm text-foreground/60 italic">{review.reviewer_notes}</p>
                </div>
              )}

              {/* Metadata */}
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground/40">
                <span>ID: <span className="font-mono">{review.id}</span></span>
                <span>Execution: <span className="font-mono">{review.execution_id}</span></span>
                {review.resolved_at && (
                  <span>Resolved: {new Date(review.resolved_at).toLocaleString()}</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
