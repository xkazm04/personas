import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  X,
  ClipboardCheck,
  Send,
  MessageSquare,
  ChevronRight,
  AlertTriangle,
  CheckSquare,
  Square,
  ExternalLink,
  Bot,
  User,
  Zap,
  Plus,
  Cloud,
  Monitor,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { FilterBar } from '@/features/shared/components/FilterBar';
import { PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/types/frontendTypes';
import type { ReviewMessage } from '@/lib/bindings/ReviewMessage';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { listReviewMessages, addReviewMessage, seedMockManualReview } from '@/api/reviews';

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

function SeverityIndicator({ severity }: { severity: string }) {
  const label = SEVERITY_LABELS[severity] ?? 'Info';
  if (severity === 'critical') {
    return (
      <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
        <svg width="12" height="12" viewBox="0 0 12 12" className="block">
          <polygon points="6,1 11,11 1,11" fill="rgba(239,68,68,0.15)" stroke="rgba(239,68,68,0.5)" strokeWidth="1" />
          <text x="6" y="9.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(239,68,68,0.9)">!</text>
        </svg>
      </span>
    );
  }
  if (severity === 'warning') {
    return (
      <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
        <svg width="12" height="12" viewBox="0 0 12 12" className="block">
          <polygon points="6,1 11,6 6,11 1,6" fill="rgba(245,158,11,0.15)" stroke="rgba(245,158,11,0.5)" strokeWidth="1" />
          <text x="6" y="8.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(245,158,11,0.9)">!</text>
        </svg>
      </span>
    );
  }
  return (
    <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
      <svg width="12" height="12" viewBox="0 0 12 12" className="block">
        <circle cx="6" cy="6" r="5" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.5)" strokeWidth="1" />
        <text x="6" y="8.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(59,130,246,0.9)">i</text>
      </svg>
    </span>
  );
}

type FilterStatus = 'all' | ManualReviewStatus;
type SourceFilter = 'all' | 'local' | 'cloud';

const FILTER_LABELS: Record<FilterStatus, string> = {
  all: 'All',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All Sources',
  local: 'Local',
  cloud: 'Cloud',
};

// ---------------------------------------------------------------------------
// Suggested Actions Parser
// ---------------------------------------------------------------------------

function parseSuggestedActions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // not JSON — split by newlines or semicolons
  }
  return raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Context Data Renderer
// ---------------------------------------------------------------------------

function ContextDataPreview({ raw }: { raw: string | null | undefined }) {
  if (!raw) return null;
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return <p className="text-sm text-foreground/70 whitespace-pre-wrap">{raw}</p>;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  return (
    <div className="space-y-1">
      {Object.entries(parsed).map(([key, val]) => (
        <div key={key} className="flex gap-2 text-sm">
          <span className="text-muted-foreground/60 font-mono flex-shrink-0">{key}:</span>
          <span className="text-foreground/80 break-all">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review Inbox Item
// ---------------------------------------------------------------------------

function InboxItem({
  review,
  isActive,
  onClick,
}: {
  review: ManualReviewItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const status = STATUS_COLORS[review.status] ?? STATUS_COLORS.pending!;
  const statusLabel = STATUS_LABELS[review.status] ?? 'Pending';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-primary/[0.06] transition-colors group ${
        isActive
          ? 'bg-primary/[0.08] border-l-2 border-l-primary'
          : 'border-l-2 border-l-transparent hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Persona avatar */}
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0 mt-0.5"
          style={{ backgroundColor: (review.persona_color || '#6366f1') + '15' }}
        >
          {review.persona_icon || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground/90 truncate">
              {review.persona_name || 'Unknown'}
            </span>
            <span className="text-xs text-muted-foreground/60 flex-shrink-0">
              {formatRelativeTime(review.created_at)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground/70 truncate mt-0.5">
            {review.content.slice(0, 80)}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <SeverityIndicator severity={review.severity} />
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium border ${status.bgColor} ${status.color} ${status.borderColor}`}
            >
              {statusLabel}
            </span>
            {review.source === 'cloud' && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Cloud className="w-2.5 h-2.5" />
                Cloud
              </span>
            )}
          </div>
        </div>
        <ChevronRight className={`w-3.5 h-3.5 mt-1 flex-shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground/30 group-hover:text-muted-foreground/50'}`} />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Conversation Thread
// ---------------------------------------------------------------------------

function ConversationThread({
  review,
  onAction,
  isProcessing,
}: {
  review: ManualReviewItem;
  onAction: (status: ManualReviewStatus, notes?: string) => Promise<void>;
  isProcessing: boolean;
}) {
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isCloud = review.source === 'cloud';

  // Fetch conversation messages (local reviews only — cloud reviews don't have local message threads)
  useEffect(() => {
    if (isCloud) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    listReviewMessages(review.id).then((msgs) => {
      if (!cancelled) setMessages(msgs);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [review.id, isCloud]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setIsSending(true);
    try {
      const msg = await addReviewMessage(review.id, 'user', text);
      setMessages((prev) => [...prev, msg]);
      setInput('');
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, review.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Parse suggested actions
  const suggestedActions = useMemo(
    () => parseSuggestedActions((review as unknown as { suggested_actions?: string }).suggested_actions),
    [review],
  );

  // Parse context data — the ManualReviewItem doesn't have context_data directly,
  // but we can access it from the raw review content or via the original data
  const contextData = (review as unknown as { context_data?: string }).context_data;
  const isPending = review.status === 'pending';

  return (
    <div className="flex flex-col h-full">
      {/* Thread Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-primary/10 bg-secondary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-base border border-primary/15 flex-shrink-0"
              style={{ backgroundColor: (review.persona_color || '#6366f1') + '15' }}
            >
              {review.persona_icon || '?'}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground/90 truncate">
                {review.persona_name || 'Unknown Persona'}
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <SeverityIndicator severity={review.severity} />
                <span className="text-xs text-muted-foreground/60">
                  {SEVERITY_LABELS[review.severity] ?? 'Info'} severity
                </span>
                <span className="text-xs text-muted-foreground/50">·</span>
                <span className="text-xs text-muted-foreground/60">
                  {formatRelativeTime(review.created_at)}
                </span>
                {isCloud && (
                  <>
                    <span className="text-xs text-muted-foreground/40">·</span>
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      <Cloud className="w-2.5 h-2.5" />
                      Cloud
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                const store = usePersonaStore.getState();
                store.selectPersona(review.persona_id);
                store.setEditorTab('use-cases');
              }}
              className="inline-flex items-center gap-1 text-xs text-blue-400/70 hover:text-blue-400 transition-colors"
              title="View execution"
            >
              <ExternalLink className="w-3 h-3" />
              Execution
            </button>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Initial review content as first "message" from persona */}
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-violet-400">
                {review.persona_name || 'Agent'}
              </span>
              <span className="text-xs text-muted-foreground/60">
                {formatRelativeTime(review.created_at)}
              </span>
            </div>
            <div className="rounded-xl bg-violet-500/[0.06] border border-violet-500/15 px-3.5 py-2.5">
              <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
                {review.content}
              </p>
            </div>

            {/* Context data preview */}
            {contextData && (
              <div className="mt-2 rounded-lg bg-secondary/30 border border-primary/10 px-3 py-2">
                <div className="text-xs font-mono text-muted-foreground/60 uppercase mb-1">Context</div>
                <ContextDataPreview raw={contextData} />
              </div>
            )}

            {/* Suggested actions as interactive buttons */}
            {suggestedActions.length > 0 && isPending && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestedActions.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(action)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15 transition-colors"
                  >
                    <Zap className="w-3 h-3" />
                    {action}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Thread messages */}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border ${
                  isUser
                    ? 'bg-blue-500/15 border-blue-500/25'
                    : 'bg-violet-500/15 border-violet-500/25'
                }`}
              >
                {isUser ? (
                  <User className="w-3.5 h-3.5 text-blue-400" />
                ) : (
                  <Bot className="w-3.5 h-3.5 text-violet-400" />
                )}
              </div>
              <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
                <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                  <span className={`text-xs font-medium ${isUser ? 'text-blue-400' : 'text-violet-400'}`}>
                    {isUser ? 'You' : (review.persona_name || 'Agent')}
                  </span>
                  <span className="text-xs text-muted-foreground/60">
                    {formatRelativeTime(msg.created_at)}
                  </span>
                </div>
                <div
                  className={`rounded-xl px-3.5 py-2.5 max-w-[85%] ${
                    isUser
                      ? 'bg-blue-500/[0.08] border border-blue-500/15'
                      : 'bg-violet-500/[0.06] border border-violet-500/15'
                  }`}
                >
                  <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}

        {/* Resolved notice */}
        {!isPending && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-sm text-muted-foreground/70">
              Review {review.status} {review.resolved_at ? `on ${new Date(review.resolved_at).toLocaleString()}` : ''}
            </span>
            {review.reviewer_notes && (
              <span className="text-sm text-foreground/70 italic ml-1">— {review.reviewer_notes}</span>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Action Bar */}
      {isPending && (
        <div className="flex-shrink-0 border-t border-primary/10 bg-secondary/20 px-4 py-3 space-y-2">
          {/* Message input — local reviews get full threading; cloud reviews get a response note */}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={isCloud ? undefined : handleKeyDown}
              placeholder={isCloud ? "Response message (optional)..." : "Reply to this review..."}
              rows={1}
              className="flex-1 text-sm bg-background/50 border border-primary/15 rounded-xl px-3 py-2 text-foreground/80 placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30 max-h-24"
              style={{ minHeight: '36px' }}
            />
            {!isCloud && (
              <button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground/50">
              {isCloud ? 'Approve or reject this cloud review' : 'Enter to send · Shift+Enter for new line'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onAction('approved', input.trim() || undefined)}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-3.5 h-3.5" />
                {isProcessing ? 'Processing…' : 'Approve'}
              </button>
              <button
                onClick={() => onAction('rejected', input.trim() || undefined)}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="w-3.5 h-3.5" />
                {isProcessing ? 'Processing…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component — Split Pane Layout
// ---------------------------------------------------------------------------

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

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ManualReviewStatus | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  useEffect(() => {
    fetchManualReviews();
  }, [fetchManualReviews]);

  // Fetch cloud reviews when connected, auto-refresh every 15s
  useEffect(() => {
    if (!isCloudConnected) return;
    fetchCloudReviews();
    const interval = setInterval(fetchCloudReviews, 15_000);
    return () => clearInterval(interval);
  }, [isCloudConnected, fetchCloudReviews]);

  // Tag local reviews with source='local' and merge with cloud reviews
  const allReviews = useMemo(() => {
    const local = manualReviews.map((r) => ({ ...r, source: 'local' as const }));
    const merged = [...local, ...cloudReviews];
    // Sort by created_at descending (newest first)
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return merged;
  }, [manualReviews, cloudReviews]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allReviews.length, pending: 0, approved: 0, rejected: 0 };
    for (const r of allReviews) {
      if (r.status in counts) counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    return counts;
  }, [allReviews]);

  const filteredReviews = useMemo(() => {
    let result = allReviews;
    if (filter !== 'all') result = result.filter((r) => r.status === filter);
    if (sourceFilter !== 'all') result = result.filter((r) => (r.source ?? 'local') === sourceFilter);
    if (selectedPersonaId) result = result.filter((r) => r.persona_id === selectedPersonaId);
    return result;
  }, [allReviews, filter, sourceFilter, selectedPersonaId]);

  const activeReview = useMemo(
    () => filteredReviews.find((r) => r.id === activeReviewId) ?? null,
    [filteredReviews, activeReviewId],
  );

  // Auto-select first review when list changes
  useEffect(() => {
    if (!activeReview && filteredReviews.length > 0) {
      setActiveReviewId(filteredReviews[0]!.id);
    }
  }, [activeReview, filteredReviews]);

  // Clear selection on filter change
  useEffect(() => {
    setSelectedIds(new Set());
    setConfirmAction(null);
  }, [filter, sourceFilter, selectedPersonaId]);

  const selectablePendingIds = useMemo(
    () => new Set(filteredReviews.filter((r) => r.status === 'pending').map((r) => r.id)),
    [filteredReviews],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  const handleAction = useCallback(
    async (status: ManualReviewStatus, notes?: string) => {
      if (!activeReview || isProcessing) return;
      setIsProcessing(true);
      try {
        if (activeReview.source === 'cloud') {
          // Cloud review: map status → decision string the cloud API expects
          const decision = status === 'approved' ? 'approve' : 'reject';
          await respondToCloudReview(activeReview.id, activeReview.execution_id, decision, notes ?? '');
        } else {
          // Local review: use existing local handler
          await updateManualReview(activeReview.id, {
            status,
            reviewer_notes: notes,
          });
        }
        // Auto-advance to next pending review
        const nextPending = filteredReviews.find(
          (r) => r.id !== activeReview.id && r.status === 'pending',
        );
        if (nextPending) setActiveReviewId(nextPending.id);
      } finally {
        setIsProcessing(false);
      }
    },
    [activeReview, isProcessing, updateManualReview, respondToCloudReview, filteredReviews],
  );

  const handleBulkAction = useCallback(
    async (status: ManualReviewStatus) => {
      setIsBulkProcessing(true);
      try {
        const decision = status === 'approved' ? 'approve' : 'reject';
        await Promise.allSettled(
          Array.from(selectedIds).map((id) => {
            const review = allReviews.find((r) => r.id === id);
            if (!review) return Promise.resolve();
            if (review.source === 'cloud') {
              return respondToCloudReview(review.id, review.execution_id, decision, '');
            }
            return updateManualReview(id, { status });
          }),
        );
        setSelectedIds(new Set());
        setConfirmAction(null);
      } finally {
        setIsBulkProcessing(false);
      }
    },
    [selectedIds, allReviews, updateManualReview, respondToCloudReview],
  );

  const activeSelectionCount = useMemo(
    () => Array.from(selectedIds).filter((id) => selectablePendingIds.has(id)).length,
    [selectedIds, selectablePendingIds],
  );

  const handleSeedReview = useCallback(async () => {
    try {
      await seedMockManualReview();
      await fetchManualReviews();
    } catch (err) {
      console.error('Failed to seed mock review:', err);
    }
  }, [fetchManualReviews]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<ClipboardCheck className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Manual Reviews"
        subtitle={`${allReviews.length} review${allReviews.length !== 1 ? 's' : ''} · ${statusCounts.pending ?? 0} pending${cloudReviews.length > 0 ? ` · ${cloudReviews.length} cloud` : ''}`}
        actions={
          import.meta.env.DEV && (
            <button
              onClick={handleSeedReview}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors"
              title="Seed a mock review (dev only)"
            >
              <Plus className="w-3.5 h-3.5" />
              Mock Review
            </button>
          )
        }
      />

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
            {/* Source filter — only shown when cloud reviews exist */}
            {isCloudConnected && (
              <div className="flex items-center rounded-xl border border-primary/15 overflow-hidden text-xs">
                {(['all', 'local', 'cloud'] as SourceFilter[]).map((src) => (
                  <button
                    key={src}
                    onClick={() => setSourceFilter(src)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${
                      sourceFilter === src
                        ? 'bg-primary/10 text-foreground/90 font-medium'
                        : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-white/[0.03]'
                    }`}
                  >
                    {src === 'local' && <Monitor className="w-3 h-3" />}
                    {src === 'cloud' && <Cloud className="w-3 h-3" />}
                    {SOURCE_LABELS[src]}
                  </button>
                ))}
              </div>
            )}
            <PersonaSelect
              value={selectedPersonaId}
              onChange={setSelectedPersonaId}
              personas={personas}
            />
            {selectablePendingIds.size > 0 && (
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
              >
                {activeSelectionCount === selectablePendingIds.size ? (
                  <CheckSquare className="w-3.5 h-3.5" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
                Select all
              </button>
            )}
          </div>
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
              <p className="text-sm text-muted-foreground/60 mt-1">
                Items requiring approval will appear here
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Inbox list */}
            <div className="w-[340px] flex-shrink-0 border-r border-primary/10 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto">
                {filteredReviews.map((review) => (
                  <div key={review.id} className="flex items-start">
                    {/* Checkbox overlay for pending items */}
                    {review.status === 'pending' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(review.id);
                        }}
                        className="flex-shrink-0 w-8 flex items-center justify-center pt-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                      >
                        {selectedIds.has(review.id) ? (
                          <CheckSquare className="w-3.5 h-3.5 text-primary" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <div className={`flex-1 min-w-0 ${review.status !== 'pending' ? 'pl-8' : ''}`}>
                      <InboxItem
                        review={review}
                        isActive={review.id === activeReviewId}
                        onClick={() => setActiveReviewId(review.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Conversation thread */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              {activeReview ? (
                <ConversationThread
                  key={activeReview.id}
                  review={activeReview}
                  onAction={handleAction}
                  isProcessing={isProcessing}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <MessageSquare className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground/50">Select a review to view</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </ContentBody>

      {/* Bulk action bar */}
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
                    <span className="font-semibold">{activeSelectionCount}</span> review
                    {activeSelectionCount !== 1 ? 's' : ''}?
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmAction(null)}
                    disabled={isBulkProcessing}
                    className="px-3 py-1.5 rounded-xl text-sm border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleBulkAction(confirmAction)}
                    disabled={isBulkProcessing}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                      confirmAction === 'approved'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                        : 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                    }`}
                  >
                    {isBulkProcessing ? 'Processing…' : 'Confirm'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground/80">
                  <span className="font-semibold text-foreground/90">{activeSelectionCount}</span>{' '}
                  pending review{activeSelectionCount !== 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="px-3 py-1.5 rounded-xl text-sm border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 transition-colors"
                  >
                    Deselect
                  </button>
                  <button
                    onClick={() => setConfirmAction('approved')}
                    className="px-3 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve All
                  </button>
                  <button
                    onClick={() => setConfirmAction('rejected')}
                    className="px-3 py-1.5 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
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
