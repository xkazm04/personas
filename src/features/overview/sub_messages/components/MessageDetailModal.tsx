import { silentCatch } from "@/lib/silentCatch";
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, ExternalLink, Check, X, Copy, Wand2, Loader2, CheckCircle2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { getMessageDeliveries } from "@/api/overview/messages";
import { sendAppNotification } from '@/api/system/system';
import { parseDesignContext, serializeDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';

import { formatRelativeTime } from '@/lib/utils/formatters';
import { deliveryStatusConfig, channelLabels } from '../libs/messageHelpers';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessageDelivery } from '@/lib/bindings/PersonaMessageDelivery';

interface MessageDetailModalProps {
  message: PersonaMessage;
  onClose: () => void;
  onDelete: () => void;
}

export function MessageDetailModal({ message, onClose, onDelete }: MessageDetailModalProps) {
  const [deliveries, setDeliveries] = useState<PersonaMessageDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDeliveriesLoading(true);
    getMessageDeliveries(message.id)
      .then(setDeliveries)
      .catch(() => setDeliveries([]))
      .finally(() => setDeliveriesLoading(false));
  }, [message.id]);

  useEffect(() => {
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, []);

  const handleDelete = useCallback(() => {
    onDelete();
    onClose();
  }, [onDelete, onClose]);

  // -- Improve persona from feedback ----------------------------------------
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [improving, setImproving] = useState<'idle' | 'loading' | 'sent'>('idle');
  const startMatrix = useAgentStore((s) => s.startMatrix);
  const updatePersona = useAgentStore((s) => s.updatePersona);
  const isMatrixRunning = useAgentStore((s) => s.isMatrixRunning);
  const prevMatrixRunning = useRef(isMatrixRunning);

  // Watch for matrix completion to send notification
  useEffect(() => {
    const improvementPid = useSystemStore.getState().feedbackImprovementPersonaId;
    if (prevMatrixRunning.current && !isMatrixRunning && improvementPid) {
      useSystemStore.getState().setFeedbackImprovementComplete(true);
      useSystemStore.getState().setFeedbackImprovementPersonaId(null);
      sendAppNotification('Agent Improved', 'Your agent has been updated based on your feedback.').catch(() => {});
    }
    prevMatrixRunning.current = isMatrixRunning;
  }, [isMatrixRunning]);

  const handleImprove = useCallback(async () => {
    if (!feedbackText.trim() || improving === 'loading') return;
    setImproving('loading');
    try {
      // 1. Enrich design_context with message content + feedback
      const personas = useAgentStore.getState().personas;
      const persona = personas.find((p) => p.id === message.persona_id);
      if (persona) {
        const ctx = parseDesignContext(persona.design_context);
        const enriched = serializeDesignContext({
          ...ctx,
          userFeedback: { message: message.content.slice(0, 500), feedback: feedbackText, at: new Date().toISOString() },
        });
        await updatePersona(message.persona_id, { design_context: enriched });
      }

      // 2. Start background improvement via Matrix
      const instruction =
        `Improve this agent based on user feedback about its output.\n\n` +
        `Message output the user wants improved:\n${message.content.slice(0, 500)}\n\n` +
        `User feedback:\n${feedbackText}\n\n` +
        `Apply non-aggressive improvements to address the feedback while preserving working behavior.`;

      const models = selectedModelsToConfigs(new Set(['sonnet']));
      await startMatrix(message.persona_id, instruction, models);

      // 3. Mark for notification on completion
      useSystemStore.getState().setFeedbackImprovementPersonaId(message.persona_id);

      setImproving('sent');
    } catch {
      setImproving('idle');
    }
  }, [feedbackText, improving, message, startMatrix, updatePersona]);

  return (
    <DetailModal
      title={message.title || 'Message'}
      subtitle={`From ${message.persona_name || 'Unknown'} \u00b7 ${formatRelativeTime(message.created_at)}`}
      onClose={onClose}
      actions={
        <>
          <div className="flex items-center gap-4 text-sm text-muted-foreground/80 mr-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(message.id).then(() => {
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 2000);
                }).catch(silentCatch("MessageDetailModal:copyId"));
              }}
              className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors"
              title={message.id}
            >
              ID: <span className="font-mono">{message.id.slice(0, 8)}</span>
              {copiedId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
            {message.execution_id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  useAgentStore.getState().selectPersona(message.persona_id);
                  useSystemStore.getState().setEditorTab('use-cases');
                }}
                className="inline-flex items-center gap-1 text-blue-400/70 hover:text-blue-400 transition-colors"
                title={message.execution_id}
              >
                View Execution <ExternalLink className="w-3 h-3" />
              </button>
            )}
            <span>Type: {message.content_type}</span>
          </div>

          {confirmingDelete ? (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors" title="Confirm delete">
                <Check className="w-4 h-4 text-red-400" />
              </button>
              <button onClick={() => setConfirmingDelete(false)} className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors" title="Cancel">
                <X className="w-4 h-4 text-muted-foreground/90" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setConfirmingDelete(true);
                if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div>
          <div className="text-sm font-mono text-foreground/60 uppercase mb-2">Content</div>
          <MarkdownRenderer content={message.content} className="text-sm leading-relaxed" />
        </div>

        {/* Improve from feedback */}
        <div className="border-t border-primary/10 pt-4">
          {improving === 'sent' ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="text-sm text-emerald-400 font-medium">Improvement started — you&apos;ll be notified when done</span>
            </div>
          ) : !showFeedback ? (
            <button
              type="button"
              onClick={() => setShowFeedback(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-violet-500/15 to-primary/15 text-primary border border-primary/15 hover:border-primary/25 transition-all"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Improve Agent
            </button>
          ) : (
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">What could be better?</div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Describe how this output could be improved..."
                rows={3}
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-secondary/20 text-sm text-foreground/80 placeholder-muted-foreground/30 resize-none outline-none focus-visible:border-primary/30 transition-colors"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleImprove}
                  disabled={!feedbackText.trim() || improving === 'loading'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/15 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                >
                  {improving === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  {improving === 'loading' ? 'Starting...' : 'Submit Improvement'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowFeedback(false); setFeedbackText(''); }}
                  className="px-2 py-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-mono text-foreground/60 uppercase mb-2 flex items-center gap-1.5">
            <Send className="w-3 h-3" /> Delivery Status
          </div>
          {deliveriesLoading ? (
            null
          ) : deliveries.length === 0 ? (
            <div className="text-sm text-muted-foreground/80 py-1">No delivery channels configured</div>
          ) : (
            <div className="space-y-1.5">
              {deliveries.map((d) => {
                const defaultStatus = deliveryStatusConfig.pending!;
                const statusCfg = deliveryStatusConfig[d.status] ?? defaultStatus;
                const StatusIcon = statusCfg.icon;
                return (
                  <div key={d.id} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border ${statusCfg.bgColor} ${statusCfg.borderColor}`}>
                    <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusCfg.color}`} />
                    <span className="typo-heading text-foreground/90 min-w-[60px]">{channelLabels[d.channel_type] ?? d.channel_type}</span>
                    <span className={`typo-heading ${statusCfg.color}`}>{statusCfg.label}</span>
                    {d.delivered_at && <span className="text-sm text-muted-foreground/80 ml-auto">{formatRelativeTime(d.delivered_at)}</span>}
                    {d.error_message && <span className="text-sm text-red-400/80 ml-auto truncate max-w-[200px]" title={d.error_message}>{d.error_message}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DetailModal>
  );
}
