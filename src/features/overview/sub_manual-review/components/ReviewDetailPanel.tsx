import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Check, X, Send, Bot, User, Cloud, ExternalLink } from 'lucide-react';
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
    }).catch(silentCatch("ReviewDetailPanel:listReviewMessages"));
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

  return (
    <div className="flex flex-col h-full">
      {/* Thread Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-primary/10 bg-secondary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base border border-primary/15 flex-shrink-0" style={{ backgroundColor: (review.persona_color || '#6366f1') + '15' }}>
              {review.persona_icon || '?'}
            </div>
            <div className="min-w-0">
              <h3 className="typo-heading text-foreground/90 truncate">{review.persona_name || 'Unknown Persona'}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <SeverityIndicator severity={review.severity} />
                <span className="text-xs text-muted-foreground/60">{SEVERITY_LABELS[review.severity] ?? 'Info'} severity</span>
                <span className="text-xs text-muted-foreground/50">·</span>
                <span className="text-xs text-muted-foreground/60">{formatRelativeTime(review.created_at)}</span>
                {isCloud && (<><span className="text-xs text-muted-foreground/40">·</span><span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded typo-caption bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"><Cloud className="w-2.5 h-2.5" />Cloud</span></>)}
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
            <ExternalLink className="w-3 h-3" /> Execution
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="typo-caption text-violet-400">{review.persona_name || 'Agent'}</span>
              <span className="text-xs text-muted-foreground/60">{formatRelativeTime(review.created_at)}</span>
            </div>
            <div className="rounded-xl bg-violet-500/[0.06] border border-violet-500/15 px-3.5 py-2.5">
              <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{review.content}</p>
            </div>
            {contextData && (
              <div className="mt-2 rounded-lg bg-secondary/30 border border-primary/10 px-3 py-2">
                <div className="text-xs font-mono text-muted-foreground/60 uppercase mb-1">Context</div>
                <ContextDataPreview raw={contextData} />
              </div>
            )}
            {suggestedActions.length > 0 && isPending && (
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
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border ${isUser ? 'bg-blue-500/15 border-blue-500/25' : 'bg-violet-500/15 border-violet-500/25'}`}>
                {isUser ? <User className="w-3.5 h-3.5 text-blue-400" /> : <Bot className="w-3.5 h-3.5 text-violet-400" />}
              </div>
              <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
                <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                  <span className={`typo-caption ${isUser ? 'text-blue-400' : 'text-violet-400'}`}>{isUser ? 'You' : (review.persona_name || 'Agent')}</span>
                  <span className="text-xs text-muted-foreground/60">{formatRelativeTime(msg.created_at)}</span>
                </div>
                <div className={`rounded-xl px-3.5 py-2.5 max-w-[85%] ${isUser ? 'bg-blue-500/[0.08] border border-blue-500/15' : 'bg-violet-500/[0.06] border border-violet-500/15'}`}>
                  <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            </div>
          );
        })}

        {!isPending && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-sm text-muted-foreground/70">
              Review {review.status} {review.resolved_at ? `on ${new Date(review.resolved_at).toLocaleString()}` : ''}
            </span>
            {review.reviewer_notes && <span className="text-sm text-foreground/70 italic ml-1">-- {review.reviewer_notes}</span>}
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
              placeholder={isCloud ? "Response message (optional)..." : "Reply to this review..."}
              rows={1}
              className="flex-1 text-sm bg-background/50 border border-primary/15 rounded-xl px-3 py-2 text-foreground/80 placeholder:text-muted-foreground/50 resize-none focus-ring focus-visible:border-primary/30 max-h-24"
              style={{ minHeight: '36px' }}
            />
            {!isCloud && (
              <button onClick={handleSend} disabled={!input.trim() || isSending} className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0" title="Send message">
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground/50">{isCloud ? 'Approve or reject this cloud review' : 'Enter to send · Shift+Enter for new line'}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => handleAction('approved', input.trim() || undefined)} disabled={isProcessing || actionFiredRef.current} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <Check className="w-3.5 h-3.5" />{isProcessing ? 'Processing...' : 'Approve'}
              </button>
              <button onClick={() => handleAction('rejected', input.trim() || undefined)} disabled={isProcessing || actionFiredRef.current} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <X className="w-3.5 h-3.5" />{isProcessing ? 'Processing...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
