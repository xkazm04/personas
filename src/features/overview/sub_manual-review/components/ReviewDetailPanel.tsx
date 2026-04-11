import { toastCatch } from "@/lib/silentCatch";
import { useTranslation } from '@/i18n/useTranslation';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Check, X, Send, User, Cloud, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useSystemStore } from '@/stores/systemStore';
import { listReviewMessages, addReviewMessage } from '@/api/overview/reviews';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { SEVERITY_LABELS, parseSuggestedActions } from '../libs/reviewHelpers';
import { SeverityIndicator, ContextDataPreview } from './ReviewListItem';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { ReviewMessage } from '@/lib/bindings/ReviewMessage';

interface ConversationThreadProps {
  review: ManualReviewItem;
  onAction: (status: ManualReviewStatus, notes?: string) => Promise<void>;
  isProcessing: boolean;
}

export function ConversationThread({ review, onAction, isProcessing }: ConversationThreadProps) {
  const { t } = useTranslation();
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
    } finally { setIsSending(false); }
  }, [input, isSending, review.id]);

  const suggestedActions = useMemo(
    () => parseSuggestedActions(review.suggested_actions),
    [review],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
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
    } catch { /* not JSON or no decisions */ }
    return [];
  }, [contextData]);

  const [decisionStates, setDecisionStates] = useState<Record<string, 'accepted' | 'rejected' | null>>({});
  const toggleDecision = useCallback((id: string, state: 'accepted' | 'rejected') => {
    setDecisionStates((prev) => ({ ...prev, [id]: prev[id] === state ? null : state }));
  }, []);

  const acceptedCount = Object.values(decisionStates).filter((v) => v === 'accepted').length;
  const rejectedCount = Object.values(decisionStates).filter((v) => v === 'rejected').length;
  const hasDecisions = decisions.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Thread Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-primary/10 bg-secondary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h3 className="typo-heading text-foreground truncate">{review.persona_name || t.overview.review.unknown_persona}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <SeverityIndicator severity={review.severity} />
                <span className="text-sm text-foreground/70">{SEVERITY_LABELS[review.severity] ?? 'Info'} {t.overview.review.severity_label}</span>
                <span className="text-sm text-foreground/40">·</span>
                <span className="text-sm text-foreground/70">{formatRelativeTime(review.created_at)}</span>
                {isCloud && (<><span className="text-sm text-foreground/40">·</span><span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded typo-caption bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"><Cloud className="w-2.5 h-2.5" />{t.overview.review.cloud_badge}</span></>)}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              useSystemStore.getState().setSidebarSection('overview');
            }}
            className="inline-flex items-center gap-1 text-xs text-blue-400/70 hover:text-blue-400 transition-colors"
            title={review.execution_id ? `Execution ${review.execution_id.slice(0, 8)}` : 'View executions'}
          >
            <ExternalLink className="w-3 h-3" /> {t.overview.review.execution_link}
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="flex gap-3">
          <PersonaIcon icon={review.persona_icon} color={review.persona_color} display="framed" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-violet-400">{review.persona_name || t.overview.review.agent}</span>
              <span className="text-sm text-foreground/60">{formatRelativeTime(review.created_at)}</span>
            </div>
            <div className="rounded-xl bg-violet-500/[0.06] border border-violet-500/15 px-3.5 py-2.5">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{review.content}</p>
            </div>
            {contextData && (
              <div className="mt-2 rounded-lg bg-secondary/30 border border-primary/10 px-3 py-2">
                <div className="text-xs font-mono text-foreground/50 uppercase mb-1">{t.overview.review.context_label}</div>
                <ContextDataPreview raw={contextData} />
              </div>
            )}
            {/* Multi-decision items */}
            {hasDecisions && isPending && (
              <div className="mt-3 rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-secondary/10">
                  <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">{t.overview.review.decisions_label} ({decisions.length})</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { const all: Record<string, 'accepted'> = {}; decisions.forEach((d) => { all[d.id] = 'accepted'; }); setDecisionStates(all); }}
                      className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      {t.overview.review.accept_all}
                    </button>
                    <span className="text-foreground/30">|</span>
                    <button
                      onClick={() => { const all: Record<string, 'rejected'> = {}; decisions.forEach((d) => { all[d.id] = 'rejected'; }); setDecisionStates(all); }}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      {t.overview.review.reject_all_items}
                    </button>
                    <span className="text-foreground/30">|</span>
                    <button
                      onClick={() => setDecisionStates({})}
                      className="text-xs text-foreground/60 hover:text-foreground/80 transition-colors"
                    >
                      {t.common.clear}
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-primary/5">
                  {decisions.map((d) => {
                    const state = decisionStates[d.id] ?? null;
                    return (
                      <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-foreground">{d.label}</span>
                          {d.description && <p className="text-xs text-foreground/60 mt-0.5">{d.description}</p>}
                        </div>
                        {d.category && (
                          <span className="text-xs text-foreground/50 px-1.5 py-0.5 rounded bg-secondary/40 flex-shrink-0">{d.category}</span>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => toggleDecision(d.id, 'accepted')}
                            className={`p-1 rounded-lg transition-colors ${state === 'accepted' ? 'bg-emerald-500/15 text-emerald-400' : 'text-muted-foreground/30 hover:text-emerald-400/60 hover:bg-emerald-500/5'}`}
                            title="Accept"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleDecision(d.id, 'rejected')}
                            className={`p-1 rounded-lg transition-colors ${state === 'rejected' ? 'bg-red-500/15 text-red-400' : 'text-muted-foreground/30 hover:text-red-400/60 hover:bg-red-500/5'}`}
                            title="Reject"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(acceptedCount > 0 || rejectedCount > 0) && (
                  <div className="flex items-center gap-3 px-3 py-2 border-t border-primary/10 bg-secondary/10">
                    {acceptedCount > 0 && <span className="text-xs text-emerald-400">{acceptedCount} {t.overview.review.accepted_label}</span>}
                    {rejectedCount > 0 && <span className="text-xs text-red-400">{rejectedCount} {t.overview.review.rejected_label}</span>}
                    {decisions.length - acceptedCount - rejectedCount > 0 && <span className="text-xs text-foreground/50">{decisions.length - acceptedCount - rejectedCount} {t.overview.review.undecided_label}</span>}
                  </div>
                )}
              </div>
            )}

            {suggestedActions.length > 0 && isPending && !hasDecisions && (
              <div className="mt-2 flex flex-col gap-1">
                {suggestedActions.map((action, i) => (
                  <button key={i} onClick={() => setInput(action)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-amber-500/[0.06] text-amber-300 border border-amber-500/15 hover:bg-amber-500/[0.12] hover:border-amber-500/25 transition-colors text-left">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-500/15 text-amber-400 text-xs font-mono font-bold flex-shrink-0">{i + 1}</span>
                    {action}
                  </button>
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
                <div className="icon-frame flex-shrink-0 mt-0.5 border bg-blue-500/15 border-blue-500/25">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                </div>
              ) : (
                <PersonaIcon icon={review.persona_icon} color={review.persona_color} display="framed" frameSize={"lg"} />
              )}
              <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
                <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                  <span className={`text-sm font-medium ${isUser ? 'text-blue-400' : 'text-violet-400'}`}>{isUser ? t.overview.review.you : (review.persona_name || t.overview.review.agent)}</span>
                  <span className="text-sm text-foreground/60">{formatRelativeTime(msg.created_at)}</span>
                </div>
                <div className={`rounded-xl px-3.5 py-2.5 max-w-[85%] ${isUser ? 'bg-blue-500/[0.08] border border-blue-500/15' : 'bg-violet-500/[0.06] border border-violet-500/15'}`}>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            </div>
          );
        })}

        {!isPending && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-sm text-foreground/80">
              Review {review.status} {review.resolved_at ? `on ${new Date(review.resolved_at).toLocaleString()}` : ''}
            </span>
            {review.reviewer_notes && <span className="text-sm text-foreground italic ml-1">-- {review.reviewer_notes}</span>}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Action Bar */}
      {isPending && (
        <div className="flex-shrink-0 border-t border-primary/10 bg-secondary/20 px-4 py-3 space-y-2">
          <div className="flex items-end gap-2">
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={isCloud ? undefined : handleKeyDown}
              placeholder={isCloud ? t.overview.review.cloud_reply_placeholder : t.overview.review.reply_placeholder}
              rows={1}
              className="flex-1 text-sm bg-background/50 border border-primary/15 rounded-xl px-3 py-2 text-foreground/80 placeholder:text-muted-foreground/50 resize-none focus-ring focus-visible:border-primary/30 max-h-24"
              style={{ minHeight: '36px' }}
            />
            {!isCloud && (
              <button onClick={handleSend} disabled={!input.trim() || isSending} className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0" title={t.overview.review.send_message}>
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/50">{isCloud ? t.overview.review.cloud_action_hint : t.overview.review.reply_hint}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => {
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
              }} disabled={isProcessing || actionFiredRef.current} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <Check className="w-3.5 h-3.5" />{isProcessing ? t.overview.review.processing : hasDecisions && acceptedCount > 0 ? `${t.overview.review.approve} (${acceptedCount}/${decisions.length})` : t.overview.review.approve}
              </button>
              <button onClick={() => {
                let notes = input.trim() || undefined;
                if (hasDecisions && (acceptedCount > 0 || rejectedCount > 0)) {
                  const decisionSummary = decisions
                    .filter((d) => decisionStates[d.id])
                    .map((d) => `${decisionStates[d.id] === 'accepted' ? '+' : '-'} ${d.label}`)
                    .join('\n');
                  notes = notes ? `${notes}\n\nDecisions:\n${decisionSummary}` : `Decisions:\n${decisionSummary}`;
                }
                handleAction('rejected', notes);
              }} disabled={isProcessing || actionFiredRef.current} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <X className="w-3.5 h-3.5" />{isProcessing ? t.overview.review.processing : t.overview.review.reject}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
