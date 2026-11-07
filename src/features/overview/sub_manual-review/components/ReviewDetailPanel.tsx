import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useTranslation } from '@/i18n/useTranslation';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Check, X, Send, User, Cloud, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import Button from '@/features/shared/components/buttons/Button';
import { useSystemStore } from '@/stores/systemStore';
import { openExecutionFromLink } from '@/lib/deepLinks/navigationLinks';
import { listReviewMessages, addReviewMessage } from '@/api/overview/reviews';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { resolveReviewSeverity, parseSuggestedActions, detectAutoResolution, reviewStatusLabel } from '../libs/reviewHelpers';
import { RichMarkdown } from '@/features/shared/components/editors/RichMarkdown';
import { AutoResolvedBadge } from './AutoResolvedBadge';
import { SeverityIndicator, ContextDataPreview } from './ReviewListItem';
import { ReviewReportLink } from './ReviewReportLink';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { ReviewMessage } from '@/lib/bindings/ReviewMessage';
import type { ReviewMessageAddedPayload } from '@/lib/eventRegistry';
import { useReviewMessageAddedListener } from '@/hooks/realtime/useReviewMessageAddedListener';

interface ConversationThreadProps {
  review: ManualReviewItem;
  onAction: (status: ManualReviewStatus, notes?: string) => Promise<void>;
  isProcessing: boolean;
}

export function ConversationThread({ review, onAction, isProcessing }: ConversationThreadProps) {
  const { t, tx } = useTranslation();
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isCloud = review.source === 'cloud';

  // Local guard against double-submit -- fires immediately before parent state updates
  const actionFiredRef = useRef(false);
  const handleAction = useCallback((status: ManualReviewStatus, notes?: string) => {
    if (actionFiredRef.current || isProcessing) return;
    actionFiredRef.current = true;
    onAction(status, notes).finally(() => { actionFiredRef.current = false; });
  }, [onAction, isProcessing]);

  useEffect(() => {
    if (isCloud) { setMessages([]); return; }
    let cancelled = false;
    listReviewMessages(review.id).then((msgs) => {
      if (!cancelled) setMessages(msgs);
    }).catch(toastCatch("ReviewDetailPanel:listReviewMessages", "Failed to load review messages"));
    return () => { cancelled = true; };
  }, [review.id, isCloud]);

  // Live thread. `add_review_message` emits `review-message-added` on every
  // write and, until this listener existed, nothing in the app was subscribed:
  // the thread only changed when `handleSend` below appended its own optimistic
  // row, so a message written by anything else — a persona reply, a second
  // window — stayed invisible until the panel was reopened. Dedupe by id
  // because the optimistic append and this event describe the same row.
  useReviewMessageAddedListener(
    useCallback(
      (msg: ReviewMessageAddedPayload) => {
        if (isCloud || msg.review_id !== review.id) return;
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id)
            ? prev
            : [
                ...prev,
                {
                  id: msg.id,
                  review_id: msg.review_id,
                  role: msg.role,
                  content: msg.content,
                  metadata: msg.metadata ?? null,
                  created_at: msg.created_at,
                },
              ],
        );
      },
      [isCloud, review.id],
    ),
  );

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
    } catch (err) {
      // This was try/finally with no catch: a failed write was an unhandled
      // rejection (Enter calls handleSend un-awaited) and the reviewer saw the
      // button re-enable with no sign the reply never reached the thread. The
      // draft stays in the box so it can be sent again.
      toastCatch('ReviewDetailPanel:addReviewMessage')(err);
    } finally { setIsSending(false); }
  }, [input, isSending, review.id]);

  const suggestedActions = useMemo(
    () => parseSuggestedActions(review.suggested_actions),
    [review],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void handleSend(); }
    // Number keys 1-9 select suggested actions when input is empty
    if (!input.trim() && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (idx < suggestedActions.length) {
        e.preventDefault();
        setInput(suggestedActions[idx] ?? '');
      }
    }
  }, [handleSend, input, suggestedActions]);

  const contextData = review.context_data;
  const isPending = review.status === 'pending';

  // Parse multi-decision items from context_data
  const decisions = useMemo<Array<{ id: string; label: string; description?: string; category?: string }>>(() => {
    if (!contextData) return [];
    try {
      const parsed = JSON.parse(contextData);
      if (Array.isArray(parsed?.decisions)) return parsed.decisions;
    } catch (err) { silentCatch("features/overview/sub_manual-review/components/ReviewDetailPanel:catch1")(err); }
    return [];
  }, [contextData]);

  const [decisionStates, setDecisionStates] = useState<Record<string, 'accepted' | 'rejected' | null>>({});
  const toggleDecision = useCallback((id: string, state: 'accepted' | 'rejected') => {
    setDecisionStates((prev) => ({ ...prev, [id]: prev[id] === state ? null : state }));
  }, []);

  const acceptedCount = Object.values(decisionStates).filter((v) => v === 'accepted').length;
  const rejectedCount = Object.values(decisionStates).filter((v) => v === 'rejected').length;
  const hasDecisions = decisions.length > 0;
  const autoResolution = detectAutoResolution(review);

  return (
    <div className="flex flex-col h-full">
      {/* Thread Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-hair bg-surface-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h3 className="typo-heading text-ink-1 truncate">{review.persona_name || t.overview.review.unknown_persona}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <SeverityIndicator severity={review.severity} />
                <span className="typo-body text-ink-2">{resolveReviewSeverity(review.severity).label} {t.overview.review.severity_label}{resolveReviewSeverity(review.severity).defaulted ? ' — payload unreadable' : ''}</span>
                <span className="typo-body text-ink-3">·</span>
                <RelativeTime timestamp={review.created_at} className="typo-data text-ink-3" />
                {isCloud && (<><span className="typo-body text-ink-3">·</span><span className="inline-flex items-center gap-1 typo-eyebrow text-role-external"><Cloud className="w-3 h-3" />{t.overview.review.cloud_badge}</span></>)}
                {autoResolution && (<><span className="typo-body text-ink-3">·</span><AutoResolvedBadge review={review} /></>)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ReviewReportLink contextData={review.context_data} />
            <Button
              variant="ghost"
              size="xs"
              data-testid="review-execution-link"
              onClick={() => {
                // With an execution id, hand it to the Activity list's focus
                // door (opens that run's detail); without one, the section root.
                if (review.execution_id && openExecutionFromLink(review.execution_id)) return;
                useSystemStore.getState().setSidebarSection('overview');
              }}
              tooltip={review.execution_id ? `Execution ${review.execution_id.slice(0, 8)}` : 'View executions'}
              icon={<ExternalLink className="w-3 h-3" />}
            >
              {t.overview.review.execution_link}
            </Button>
          </div>
        </div>
      </div>

      {/* Auto-resolution notice: this review skipped the human queue by policy. */}
      {autoResolution && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-hair bg-surface-1">
          <p className="typo-caption text-status-warning">
            {autoResolution.kind === 'trust_llm'
              ? t.overview.review.auto_resolved.banner_trust_llm
              : t.overview.review.auto_resolved.banner_auto_triage}
          </p>
          {autoResolution.reasoning && (
            <p className="typo-caption text-status-warning mt-1">
              <span className="typo-label">{t.overview.review.auto_resolved.reasoning_label}:</span>{' '}
              {autoResolution.reasoning}
            </p>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="flex gap-3">
          <PersonaIcon icon={review.persona_icon} color={review.persona_color} display="framed" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="typo-body text-role-agent">{review.persona_name || t.overview.review.agent}</span>
              <RelativeTime timestamp={review.created_at} className="typo-data text-ink-3" />
            </div>
            <div className="rounded-card bg-surface-1 border border-hair px-3.5 py-2.5">
              <RichMarkdown content={review.content} className="typo-body text-ink-1" />
            </div>
            {contextData && (
              <div className="mt-2 rounded-card bg-surface-1 border border-hair px-3 py-2">
                <div className="typo-eyebrow mb-1">{t.overview.review.context_label}</div>
                <ContextDataPreview raw={contextData} />
              </div>
            )}
            {/* Multi-decision items */}
            {hasDecisions && isPending && (
              <div className="mt-3 rounded-card border border-hair bg-surface-1 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-hair bg-surface-1">
                  <span className="typo-eyebrow text-ink-3">{t.overview.review.decisions_label} (<span className="num">{decisions.length}</span>)</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => { const all: Record<string, 'accepted'> = {}; decisions.forEach((d) => { all[d.id] = 'accepted'; }); setDecisionStates(all); }}
                    >
                      {t.overview.review.accept_all}
                    </Button>
                    <span className="text-ink-4">|</span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => { const all: Record<string, 'rejected'> = {}; decisions.forEach((d) => { all[d.id] = 'rejected'; }); setDecisionStates(all); }}
                    >
                      {t.overview.review.reject_all_items}
                    </Button>
                    <span className="text-ink-4">|</span>
                    <Button variant="ghost" size="xs" onClick={() => setDecisionStates({})}>
                      {t.common.clear}
                    </Button>
                  </div>
                </div>
                <div className="divide-y divide-hair">
                  {decisions.map((d) => {
                    const state = decisionStates[d.id] ?? null;
                    return (
                      <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 transition-colors">
                        <div className="flex-1 min-w-0">
                          <span className="typo-body text-ink-1">{d.label}</span>
                          {d.description && <p className="typo-caption text-ink-3 mt-0.5">{d.description}</p>}
                        </div>
                        {d.category && (
                          <span className="typo-eyebrow text-ink-3 flex-shrink-0">{d.category}</span>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant={state === 'accepted' ? 'accent' : 'ghost'}
                            tone={state === 'accepted' ? 'success' : undefined}
                            size="icon-sm"
                            onClick={() => toggleDecision(d.id, 'accepted')}
                            tooltip={t.overview.review.accept}
                            aria-label={t.overview.review.accept}
                            aria-pressed={state === 'accepted'}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant={state === 'rejected' ? 'accent' : 'ghost'}
                            tone={state === 'rejected' ? 'error' : undefined}
                            size="icon-sm"
                            onClick={() => toggleDecision(d.id, 'rejected')}
                            tooltip={t.overview.review.reject}
                            aria-label={t.overview.review.reject}
                            aria-pressed={state === 'rejected'}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(acceptedCount > 0 || rejectedCount > 0) && (
                  <div className="flex items-center gap-3 px-3 py-2 border-t border-hair bg-surface-1">
                    {acceptedCount > 0 && <span className="typo-caption text-status-success">{acceptedCount} {t.overview.review.accepted_label}</span>}
                    {rejectedCount > 0 && <span className="typo-caption text-status-error">{rejectedCount} {t.overview.review.rejected_label}</span>}
                    {decisions.length - acceptedCount - rejectedCount > 0 && <span className="typo-caption text-ink-3">{decisions.length - acceptedCount - rejectedCount} {t.overview.review.undecided_label}</span>}
                  </div>
                )}
              </div>
            )}

            {suggestedActions.length > 0 && isPending && !hasDecisions && (
              <div className="mt-2 flex flex-col gap-1">
                {suggestedActions.map((action, i) => (
                  <Button key={i} variant="secondary" size="sm" className="justify-start text-left" onClick={() => setInput(action)}>
                    <span className="typo-data text-ink-3 flex-shrink-0">{i + 1}</span>
                    {action}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={`animate-fade-slide-in flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
              {isUser ? (
                <div className="icon-frame flex-shrink-0 mt-0.5 border bg-surface-1 border-hair">
                  <User className="w-3.5 h-3.5 text-ink-2" />
                </div>
              ) : (
                <PersonaIcon icon={review.persona_icon} color={review.persona_color} display="framed" frameSize={"lg"} />
              )}
              <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
                <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                  <span className={`typo-label ${isUser ? 'text-ink-1' : 'text-role-agent'}`}>{isUser ? t.overview.review.you : (review.persona_name || t.overview.review.agent)}</span>
                  <RelativeTime timestamp={msg.created_at} className="typo-data text-ink-3" />
                </div>
                <div className={`rounded-card px-3.5 py-2.5 max-w-[85%] border border-hair ${isUser ? 'bg-surface-2' : 'bg-surface-1'}`}>
                  <p className="typo-body text-ink-1 whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            </div>
          );
        })}

        {!isPending && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-surface-1 border border-hair">
            <Check className="w-3.5 h-3.5 text-status-success" />
            <span className="typo-body text-ink-2">
              {tx(t.overview.review.review_status, { status: reviewStatusLabel(t, review.status) })}
              {review.resolved_at ? <> · <AbsoluteTime timestamp={review.resolved_at} /></> : null}
            </span>
            {review.reviewer_notes && <span className="typo-body text-ink-2 ml-1">-- {review.reviewer_notes}</span>}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Action Bar */}
      {isPending && (
        <div className="flex-shrink-0 border-t border-hair bg-surface-1 px-4 py-3 space-y-2">
          <div className="flex items-end gap-2">
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={isCloud ? undefined : handleKeyDown}
              placeholder={isCloud ? t.overview.review.cloud_reply_placeholder : t.overview.review.reply_placeholder}
              rows={1}
              className="flex-1 typo-body bg-background/50 border border-hair rounded-card px-3 py-2 text-ink-1 placeholder:text-ink-3 resize-none focus-ring focus-visible:border-hair-2 max-h-24"
              style={{ minHeight: '36px' }}
            />
            {!isCloud && (
              <Button variant="primary" size="icon-md" onClick={handleSend} disabled={!input.trim() || isSending} className="flex-shrink-0" tooltip={t.overview.review.send_message} aria-label={t.overview.review.send_message}>
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="typo-caption text-ink-3">{isCloud ? t.overview.review.cloud_action_hint : t.overview.review.reply_hint}</span>
            <div className="flex items-center gap-2">
              <Button onClick={() => {
                // Include per-item decisions in reviewer notes for multi-decision reviews
                let notes = input.trim() || undefined;
                if (hasDecisions && (acceptedCount > 0 || rejectedCount > 0)) {
                  const decisionSummary = decisions
                    .filter((d) => decisionStates[d.id])
                    .map((d) => `${decisionStates[d.id] === 'accepted' ? '+' : '-'} ${d.label}`)
                    .join('\n');
                  notes = notes ? `${notes}\n\nDecisions:\n${decisionSummary}` : `Decisions:\n${decisionSummary}`;
                }
                handleAction('approved', notes);
              }} disabled={actionFiredRef.current} loading={isProcessing} loadingLabel={t.overview.review.processing} variant="accent" tone="success" icon={<Check className="w-3.5 h-3.5" />}>
                {hasDecisions && acceptedCount > 0 ? tx(t.overview.review.approve_with_count, { accepted: acceptedCount, total: decisions.length }) : t.overview.review.approve}
              </Button>
              <Button onClick={() => {
                let notes = input.trim() || undefined;
                if (hasDecisions && (acceptedCount > 0 || rejectedCount > 0)) {
                  const decisionSummary = decisions
                    .filter((d) => decisionStates[d.id])
                    .map((d) => `${decisionStates[d.id] === 'accepted' ? '+' : '-'} ${d.label}`)
                    .join('\n');
                  notes = notes ? `${notes}\n\nDecisions:\n${decisionSummary}` : `Decisions:\n${decisionSummary}`;
                }
                handleAction('rejected', notes);
              }} disabled={actionFiredRef.current} loading={isProcessing} loadingLabel={t.overview.review.processing} variant="accent" tone="error" icon={<X className="w-3.5 h-3.5" />}>
                {t.overview.review.reject}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
