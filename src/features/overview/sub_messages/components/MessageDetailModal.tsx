import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from '@/i18n/useTranslation';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Send, Trash2, ExternalLink, Check, X, Copy, Wand2, Loader2, CheckCircle2,
  ChevronLeft, ChevronRight,
  FileText, Code2, AlertCircle, HelpCircle, Image as ImageIcon, MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { getMessageDeliveries } from "@/api/overview/messages";
import { useOverviewStore } from "@/stores/overviewStore";
import { buildFeedbackInstruction, buildFeedbackChatTitle } from '../libs/feedbackInstruction';

import { formatRelativeTime } from '@/lib/utils/formatters';
import { deliveryStatusConfig, channelLabels } from '../libs/messageHelpers';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessageDelivery } from '@/lib/bindings/PersonaMessageDelivery';

interface MessageDetailModalProps {
  message: PersonaMessage;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
  /** Step through the currently-filtered list inside the modal. `dir` is +1
   *  for the next message, -1 for the previous one. The parent decides how
   *  to resolve that into the new `message` prop. */
  onNavigate?: (dir: 1 | -1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

const CONTENT_TYPE_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  text:     { icon: FileText,     tone: 'text-indigo-400' },
  markdown: { icon: FileText,     tone: 'text-indigo-400' },
  code:     { icon: Code2,        tone: 'text-violet-400' },
  alert:    { icon: AlertCircle,  tone: 'text-red-400' },
  error:    { icon: AlertCircle,  tone: 'text-red-400' },
  question: { icon: HelpCircle,   tone: 'text-amber-400' },
  image:    { icon: ImageIcon,    tone: 'text-emerald-400' },
};

export function MessageDetailModal({ message, onClose, onDelete, onNavigate, hasPrev, hasNext }: MessageDetailModalProps) {
  const { t, tx } = useTranslation();
  // Guard against incomplete message data (e.g. malformed realtime event)
  const msgId = message.id ?? '';
  const msgContent = message.content ?? '';
  const [deliveries, setDeliveries] = useState<PersonaMessageDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  // Tracks which direction we're moving so the body content can slide in from
  // the matching side — gives the user a clear sense of forward/back motion.
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markMessageAsRead = useOverviewStore((s) => s.markMessageAsRead);

  // Mark-as-read whenever a new message is shown in the modal — including
  // navigation via arrow keys. The parent also marks on row click, but it's
  // harmless to repeat and guarantees read state tracks actual user viewing.
  useEffect(() => {
    if (msgId && !message.is_read) {
      markMessageAsRead(msgId);
    }
  }, [msgId, message.is_read, markMessageAsRead]);

  useEffect(() => {
    setDeliveriesLoading(true);
    getMessageDeliveries(msgId)
      .then(setDeliveries)
      .catch(() => setDeliveries([]))
      .finally(() => setDeliveriesLoading(false));
  }, [msgId]);

  useEffect(() => {
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, []);

  const handleDelete = useCallback(async () => {
    // Await so the row actually leaves the store before we unmount the modal.
    // Previously these ran in parallel and the async delete could be dropped
    // silently if the component unmounted fast enough.
    try { await onDelete(); } finally { onClose(); }
  }, [onDelete, onClose]);

  const go = useCallback((dir: 1 | -1) => {
    if (!onNavigate) return;
    if (dir === 1 && !hasNext) return;
    if (dir === -1 && !hasPrev) return;
    setNavDir(dir);
    onNavigate(dir);
  }, [onNavigate, hasPrev, hasNext]);

  // Arrow-key navigation: bind at window level so the whole modal surface is
  // responsive even when focus isn't on a specific element.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [go]);

  // -- Respond with feedback → background advisory chat ---------------------
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [improving, setImproving] = useState<'idle' | 'loading' | 'sent'>('idle');
  const startFeedbackChat = useAgentStore((s) => s.startFeedbackChat);

  // Reset per-message local state whenever the user navigates to a new row.
  useEffect(() => {
    setShowFeedback(false);
    setFeedbackText('');
    setImproving('idle');
    setConfirmingDelete(false);
  }, [msgId]);

  const handleImprove = useCallback(async () => {
    if (!feedbackText.trim() || improving === 'loading') return;
    setImproving('loading');
    try {
      const personas = useAgentStore.getState().personas;
      const persona = personas.find((p) => p.id === message.persona_id);
      const instruction = buildFeedbackInstruction(message, feedbackText);
      const title = buildFeedbackChatTitle(message);

      await startFeedbackChat({
        personaId: message.persona_id,
        personaName: persona?.name ?? message.persona_name ?? undefined,
        sourceMessageId: message.id,
        instruction,
        title,
      });

      setImproving('sent');
    } catch {
      setImproving('idle');
    }
  }, [feedbackText, improving, message, startFeedbackChat]);

  const typeMeta = useMemo(() => {
    const key = (message.content_type || 'text').toLowerCase();
    return CONTENT_TYPE_ICONS[key] ?? { icon: MessageSquare, tone: 'text-indigo-400' };
  }, [message.content_type]);
  const TypeIcon = typeMeta.icon;

  const titleNode = (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-card bg-secondary/30 border border-primary/10 ${typeMeta.tone}`}
        title={message.content_type || 'text'}
        aria-label={message.content_type || 'text'}
      >
        <TypeIcon className="w-4 h-4" />
      </span>
      {message.title || t.overview.messages_view.message_label}
      {onNavigate && (
        <span className="inline-flex items-center ml-2 gap-0.5">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!hasPrev}
            className="p-1 rounded-card text-foreground/70 hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Previous message (←)"
            aria-label="Previous message"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!hasNext}
            className="p-1 rounded-card text-foreground/70 hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Next message (→)"
            aria-label="Next message"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </span>
      )}
    </span>
  );

  return (
    <DetailModal
      title={titleNode}
      subtitle={`${tx(t.overview.messages_view.from_label, { name: message.persona_name || t.overview.messages_view.unknown_persona })} \u00b7 ${formatRelativeTime(message.created_at)}`}
      onClose={onClose}
      actions={
        <>
          <div className="flex items-center gap-4 typo-body text-foreground mr-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(msgId).then(() => {
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 2000);
                }).catch(silentCatch("MessageDetailModal:copyId"));
              }}
              className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors"
              title={msgId}
            >
              ID: <span className="font-mono">{msgId.slice(0, 8)}</span>
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
                {t.overview.messages_view.view_execution} <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>

          {confirmingDelete ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={handleDelete} title="Confirm delete" className="text-red-400 bg-red-500/15 hover:bg-red-500/25">
                <Check className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setConfirmingDelete(false)} title="Cancel">
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                setConfirmingDelete(true);
                if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-heading bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> {t.common.delete}
            </button>
          )}
        </>
      }
    >
      <AnimatePresence mode="wait" custom={navDir} initial={false}>
        <motion.div
          key={msgId}
          custom={navDir}
          variants={{
            enter: (dir: 1 | -1) => ({ x: dir * 24, opacity: 0 }),
            center: { x: 0, opacity: 1 },
            exit:   (dir: 1 | -1) => ({ x: -dir * 24, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className="space-y-6"
        >
          <div>
            <div className="typo-code font-mono text-foreground uppercase mb-2">{t.overview.messages_view.content_label}</div>
            <MarkdownRenderer content={msgContent} className="typo-body leading-relaxed" />
          </div>

          {/* Improve from feedback */}
          <div className="border-t border-primary/10 pt-4">
            {improving === 'sent' ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-modal bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span className="typo-body text-emerald-400 font-medium">{t.overview.messages_view.improvement_started}</span>
              </div>
            ) : !showFeedback ? (
              <button
                type="button"
                onClick={() => setShowFeedback(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption font-medium bg-gradient-to-r from-violet-500/15 to-primary/15 text-primary border border-primary/15 hover:border-primary/25 transition-all"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {t.overview.messages_view.improve_agent}
              </button>
            ) : (
              <div className="space-y-2.5">
                <div className="typo-label font-semibold text-foreground uppercase tracking-wider">{t.overview.messages_view.what_could_be_better}</div>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder={t.overview.messages_view.improve_placeholder}
                  rows={3}
                  autoFocus
                  className="w-full px-3 py-2 rounded-card border border-primary/15 bg-secondary/20 typo-body text-foreground placeholder-muted-foreground/30 resize-none outline-none focus-visible:border-primary/30 transition-colors"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleImprove}
                    disabled={!feedbackText.trim() || improving === 'loading'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption font-medium bg-primary/15 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                  >
                    {improving === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    {improving === 'loading' ? t.overview.messages_view.starting : t.overview.messages_view.submit_improvement}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowFeedback(false); setFeedbackText(''); }}
                    className="px-2 py-1.5 typo-caption text-foreground hover:text-muted-foreground/70 transition-colors"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="typo-code font-mono text-foreground uppercase mb-2 flex items-center gap-1.5">
              <Send className="w-3 h-3" /> {t.overview.messages_view.delivery_status}
            </div>
            {deliveriesLoading ? (
              null
            ) : deliveries.length === 0 ? (
              <div className="typo-body text-foreground py-1">{t.overview.messages_view.no_channels}</div>
            ) : (
              <div className="space-y-1.5">
                {deliveries.map((d) => {
                  const defaultStatus = deliveryStatusConfig.pending!;
                  const statusCfg = deliveryStatusConfig[d.status] ?? defaultStatus;
                  const StatusIcon = statusCfg.icon;
                  return (
                    <div key={d.id} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-modal border ${statusCfg.bgColor} ${statusCfg.borderColor}`}>
                      <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusCfg.color}`} />
                      <span className="typo-heading text-foreground/90 min-w-[60px]">{channelLabels[d.channel_type] ?? d.channel_type}</span>
                      <span className={`typo-heading ${statusCfg.color}`}>{statusCfg.label}</span>
                      {d.delivered_at && <span className="typo-body text-foreground ml-auto">{formatRelativeTime(d.delivered_at)}</span>}
                      {d.error_message && <span className="typo-body text-red-400/80 ml-auto truncate max-w-[200px]" title={d.error_message}>{d.error_message}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </DetailModal>
  );
}
