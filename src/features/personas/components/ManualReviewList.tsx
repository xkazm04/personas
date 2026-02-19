import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Check, X, ClipboardCheck } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/types/frontendTypes';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { SEVERITY_COLORS, STATUS_COLORS } from '@/lib/utils/designTokens';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

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

  useEffect(() => {
    const statusParam = filter === 'all' ? undefined : filter;
    fetchManualReviews(statusParam);
  }, [filter, fetchManualReviews]);

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 pt-4">
      {/* Filter pills */}
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
          </button>
        ))}
      </div>

      {/* Review list */}
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {manualReviews.length === 0 && (
          <div className="text-center py-16">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
              <ClipboardCheck className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground/50">No items requiring review</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {manualReviews.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              isExpanded={expandedId === review.id}
              onToggle={() => setExpandedId(expandedId === review.id ? null : review.id)}
              onAction={updateManualReview}
            />
          ))}
        </AnimatePresence>
      </div>
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
}: {
  review: ManualReviewItem;
  isExpanded: boolean;
  onToggle: () => void;
  onAction: (id: string, updates: { status?: string; reviewer_notes?: string }) => Promise<void>;
}) {
  const [notes, setNotes] = useState(review.reviewer_notes || '');
  const severity = SEVERITY_COLORS[review.severity] ?? SEVERITY_COLORS.info!;
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
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        {/* Expand icon */}
        <div className="text-muted-foreground/40">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>

        {/* Severity dot */}
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 border ${severity.bgColor} ${severity.borderColor}`}
          style={{ boxShadow: review.severity === 'critical' ? '0 0 6px rgba(239,68,68,0.3)' : undefined }}
        />

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
