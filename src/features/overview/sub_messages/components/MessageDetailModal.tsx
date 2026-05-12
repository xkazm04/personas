import { useTranslation } from '@/i18n/useTranslation';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Send, Trash2, ExternalLink, Check, X, Copy, Wand2, Loader2, CheckCircle2,
  ChevronLeft, ChevronRight, Star, Printer, MessageCircle, ShieldCheck,
  ShieldAlert, ThumbsUp, ThumbsDown,
  FileText, Code2, AlertCircle, HelpCircle, Image as ImageIcon, MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { getMessageDeliveries } from "@/api/overview/messages";
import {
  createMemory, updateMemoryContent, listMemoriesByExecution,
} from "@/api/overview/memories";
import {
  listManualReviews, updateManualReviewStatus,
} from "@/api/overview/reviews";
import { useOverviewStore } from "@/stores/overviewStore";
import { buildFeedbackInstruction, buildFeedbackChatTitle } from '../libs/feedbackInstruction';
import { buildSummariseChatPrompt } from '../libs/chatSeed';
import type { CompanionCockpitSpecBody } from '@/api/companion';

import { formatRelativeTime } from '@/lib/utils/formatters';
import { deliveryStatusConfig, channelLabels } from '../libs/messageHelpers';
import {
  SeverityIndicator,
  ContextDataPreview,
} from '@/features/overview/sub_manual-review/components/ReviewListItem';
import {
  parseDecisions,
  getDecisionImage,
  type DecisionVerdict,
} from '@/features/overview/sub_manual-review/components/reviewFocusHelpers';
import { FocusedDecisionCard } from '@/features/overview/sub_manual-review/components/FocusedDecisionCard';
import { silentCatch } from '@/lib/silentCatch';
import { toastCatch } from '@/lib/silentCatch';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaMessageDelivery } from '@/lib/bindings/PersonaMessageDelivery';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';

interface MessageDetailModalProps {
  message: PersonaMessage;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
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

/**
 * Tag stamped on every rating-derived memory. Lets the upsert path find
 * the existing row for an (execution, persona) pair on a re-rate without
 * scanning all memories for substring matches.
 */
const RATING_MEMORY_TAG = 'message_rating';

/**
 * Memory category used for ratings. `learned` = "Insights the agent derived
 * from past executions" — semantically correct, and persists across persona
 * runs via the standard memory-injection pipeline.
 */
const RATING_MEMORY_CATEGORY = 'learned';

/**
 * Message detail modal — editorial reading layout with operational hooks.
 *
 * Sections:
 *   I.  Content        — large reading surface + per-content actions row
 *                        (Export to PDF, Play in chat).
 *   II. Improve agent  — star rating quick path + free-form feedback.
 *                        Ratings are upserted into the persona's memory
 *                        store so re-rating updates rather than duplicates.
 *   III. Delivery      — colophon row of channel × status chips.
 *   IV. Pending decisions — surfaces manual-review rows linked to the
 *                        same execution_id. Inline approve/reject so the
 *                        user can resolve message + review in one stop.
 */
export function MessageDetailModal({
  message, onClose, onDelete, onNavigate, hasPrev, hasNext,
}: MessageDetailModalProps) {
  const { t, tx } = useTranslation();
  const msgId = message.id ?? '';
  const msgContent = message.content ?? '';
  const [deliveries, setDeliveries] = useState<PersonaMessageDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { copied: copiedId, copy: copyId } = useCopyToClipboard();
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markMessageAsRead = useOverviewStore((s) => s.markMessageAsRead);

  // Plugin gating — Companion plugin must be enabled for "Play in chat".
  const companionEnabled = useSystemStore((s) => s.enabledPlugins.has('companion'));

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
    try { await onDelete(); } finally { onClose(); }
  }, [onDelete, onClose]);

  const go = useCallback((dir: 1 | -1) => {
    if (!onNavigate) return;
    if (dir === 1 && !hasNext) return;
    if (dir === -1 && !hasPrev) return;
    setNavDir(dir);
    onNavigate(dir);
  }, [onNavigate, hasPrev, hasNext]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [go]);

  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [improving, setImproving] = useState<'idle' | 'loading' | 'sent'>('idle');
  const startFeedbackChat = useAgentStore((s) => s.startFeedbackChat);

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

  // -- Rating upsert ----------------------------------------------------
  // Hydrate from the existing memory (if any) on mount + when message
  // changes, so the row's current rating persists across modal opens.

  const [rating, setRating] = useState<number>(0);
  const [ratingMemoryId, setRatingMemoryId] = useState<string | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);

  useEffect(() => {
    setRating(0);
    setRatingMemoryId(null);
    if (!message.execution_id) return;
    let cancelled = false;
    listMemoriesByExecution(message.execution_id)
      .then((memories: PersonaMemory[]) => {
        if (cancelled) return;
        const existing = memories.find((m) =>
          m.persona_id === message.persona_id &&
          (m.tags ?? []).includes(RATING_MEMORY_TAG),
        );
        if (existing) {
          setRatingMemoryId(existing.id);
          // Importance 1..5 maps directly onto the star value.
          setRating(existing.importance);
        }
      })
      .catch(silentCatch('MessageDetailModal:listMemoriesByExecution'));
    return () => { cancelled = true; };
  }, [message.execution_id, message.persona_id]);

  const handleRate = useCallback(async (stars: number) => {
    if (!message.execution_id || ratingSaving) return;
    if (stars < 1 || stars > 5) return;

    setRatingSaving(true);
    const title = tx(t.overview.messages_view.rating_memory_title, { stars });
    const contentKey =
      stars >= 4 ? t.overview.messages_view.rating_memory_content_good :
      stars >= 3 ? t.overview.messages_view.rating_memory_content_neutral :
      t.overview.messages_view.rating_memory_content_poor;
    const content = tx(contentKey, { stars });

    try {
      if (ratingMemoryId) {
        await updateMemoryContent(
          ratingMemoryId, title, content, stars, [RATING_MEMORY_TAG],
        );
      } else {
        const created = await createMemory({
          persona_id: message.persona_id,
          title,
          content,
          category: RATING_MEMORY_CATEGORY,
          source_execution_id: message.execution_id,
          importance: stars,
          tags: [RATING_MEMORY_TAG],
          use_case_id: null,
        });
        setRatingMemoryId(created.id);
      }
      setRating(stars);
    } catch (err) {
      toastCatch('Failed to save rating')(err);
    } finally {
      setRatingSaving(false);
    }
  }, [message.execution_id, message.persona_id, ratingMemoryId, ratingSaving, t, tx]);

  // -- Pending decisions linked to this execution -----------------------

  const [linkedReviews, setLinkedReviews] = useState<PersonaManualReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [resolvingReviewId, setResolvingReviewId] = useState<string | null>(null);

  const reloadReviews = useCallback(() => {
    if (!message.execution_id || !message.persona_id) {
      setLinkedReviews([]);
      setReviewsLoading(false);
      return;
    }
    setReviewsLoading(true);
    listManualReviews(message.persona_id, 'pending')
      .then((rows) => {
        setLinkedReviews(rows.filter((r) => r.execution_id === message.execution_id));
      })
      .catch((err) => {
        silentCatch('MessageDetailModal:listManualReviews')(err);
        setLinkedReviews([]);
      })
      .finally(() => setReviewsLoading(false));
  }, [message.execution_id, message.persona_id]);

  useEffect(() => {
    reloadReviews();
  }, [reloadReviews]);

  const handleResolveReview = useCallback(async (
    review: PersonaManualReview,
    status: 'approved' | 'rejected',
  ) => {
    if (resolvingReviewId) return;
    setResolvingReviewId(review.id);
    try {
      await updateManualReviewStatus(review.id, status);
      reloadReviews();
    } catch (err) {
      toastCatch('Failed to update review')(err);
    } finally {
      setResolvingReviewId(null);
    }
  }, [resolvingReviewId, reloadReviews]);

  // -- Content action buttons ------------------------------------------

  const handleExportPdf = useCallback(() => {
    // Tauri's webview doesn't reliably honour `window.open('', '_blank')` —
    // it either returns null or routes the URL to the system browser
    // (where the empty-document path can't be written to). The reliable
    // alternative is an off-screen iframe with `srcdoc`: the iframe lives
    // inside the current webview, so we can call `.contentWindow.print()`
    // on it and the OS print dialog opens against that document.
    const personaName = message.persona_name || t.overview.messages_view.unknown_persona;
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const safeTitle = escape(message.title || t.overview.messages_view.message_label);
    const safeBody = escape(msgContent || '');
    const safePersona = escape(personaName);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    iframe.srcdoc = `<!doctype html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111; line-height: 1.7; max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; border-bottom: 1px solid #ddd; padding-bottom: 1rem; }
  pre, code { background: #f5f5f5; padding: 0.1rem 0.35rem; border-radius: 3px; font-family: ui-monospace, monospace; }
  pre { padding: 0.75rem; overflow-x: auto; }
  blockquote { border-left: 3px solid #ccc; margin: 1rem 0; padding-left: 1rem; color: #444; }
  .body { white-space: pre-wrap; }
  @page { margin: 1.5cm; }
</style></head>
<body>
  <h1>${safeTitle}</h1>
  <div class="meta">From ${safePersona} · ${new Date(message.created_at).toLocaleString()}</div>
  <div class="body">${safeBody}</div>
</body></html>`;

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) return;
      // Tear-down on afterprint (modern browsers fire this on Save-as-PDF
      // success AND cancel). Belt-and-braces timeout in case afterprint
      // doesn't reach us.
      const cleanup = () => {
        try { iframe.remove(); } catch { /* already removed */ }
      };
      win.addEventListener('afterprint', cleanup, { once: true });
      window.setTimeout(cleanup, 120_000);
      // Print dialog must be invoked synchronously from the iframe's
      // window context — calling print() on the host page would print the
      // app, not the message.
      win.focus();
      win.print();
    };

    document.body.appendChild(iframe);
  }, [message.persona_name, message.title, message.created_at, msgContent, t]);

  const handlePlayInChat = useCallback(() => {
    if (!message.execution_id) return;

    // 1. Compose the contextual cockpit spec that supplements the chat.
    const spec: CompanionCockpitSpecBody = {
      title: `Context: ${message.title || t.overview.messages_view.message_label}`,
      widgets: [
        {
          id: 'w-msg',
          kind: 'message_summary',
          span: 12,
          config: { messageId: message.id, snapshot: message },
        },
        {
          id: 'w-facts',
          kind: 'execution_facts',
          span: 6,
          config: { executionId: message.execution_id, personaId: message.persona_id },
        },
        {
          id: 'w-decisions',
          kind: 'linked_decisions',
          span: 6,
          config: { executionId: message.execution_id, personaId: message.persona_id },
        },
        {
          id: 'w-mem',
          kind: 'linked_memories',
          span: 12,
          config: { executionId: message.execution_id },
        },
      ],
    };
    useSystemStore.getState().setContextualCockpit({
      source: {
        kind: 'message',
        messageId: message.id,
        messageTitle: message.title ?? '',
      },
      spec,
    });

    // 2. Navigate to Home > Cockpit so the contextual view fills the page.
    useSystemStore.getState().setSidebarSection('home');
    useSystemStore.getState().setHomeTab('cockpit');

    // 3. Seed companion + auto-send + open the chat panel.
    useCompanionStore.getState().setPendingPrompt({
      text: buildSummariseChatPrompt(message, linkedReviews),
      autoSend: true,
    });
    useCompanionStore.getState().setState('open');

    // 4. Close the message modal so chat + cockpit own the screen.
    onClose();
  }, [message, linkedReviews, onClose, t]);

  // -- Title / chrome ---------------------------------------------------

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

  // Persona-name → Agent detail: split the localized "From {name}" string
  // around the {name} placeholder so we can wrap just the name in a button
  // without baking presentation into the locale entry.
  const personaName = message.persona_name || t.overview.messages_view.unknown_persona;
  const fromTemplate = t.overview.messages_view.from_label;
  const [fromBefore, fromAfter] = fromTemplate.split('{name}');
  const openPersonaDetail = () => {
    if (!message.persona_id) return;
    useAgentStore.getState().selectPersona(message.persona_id);
    useSystemStore.getState().setSidebarSection('personas');
    onClose();
  };

  const subtitleNode = (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span>{fromBefore ?? ''}</span>
      <button
        type="button"
        data-testid="msg-detail-persona-link"
        onClick={openPersonaDetail}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 -mx-0.5 rounded-input typo-body font-medium text-primary hover:text-primary/80 hover:bg-primary/[0.08] transition-colors focus-ring"
        title={t.overview.messages_view.persona_link_title}
      >
        {personaName}
        <ExternalLink className="w-3 h-3 opacity-70" />
      </button>
      <span>{(fromAfter ?? '').trim()} · {formatRelativeTime(message.created_at)}</span>
    </span>
  );

  return (
    <DetailModal
      title={titleNode}
      subtitle={subtitleNode}
      onClose={onClose}
      actions={
        <>
          <div className="flex items-center gap-4 typo-body text-foreground mr-auto">
            <button
              onClick={(e) => { e.stopPropagation(); copyId(msgId); }}
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
          className="w-full"
        >
          {/* I. Content — large reading surface */}
          <section className="mb-10">
            <SectionMark index="I" label={t.overview.messages_view.content_label} />
            <article className="rounded-3xl bg-[color-mix(in_srgb,var(--color-background),var(--color-foreground)_3.5%)] px-8 py-7 shadow-elevation-1">
              <MarkdownRenderer
                content={msgContent}
                className={[
                  'typo-body-lg leading-[1.8] text-foreground',
                  '[&_p]:mb-5 [&_p:last-child]:mb-0',
                  '[&_p:first-of-type:first-letter]:float-left',
                  '[&_p:first-of-type:first-letter]:text-5xl',
                  '[&_p:first-of-type:first-letter]:leading-[0.9]',
                  '[&_p:first-of-type:first-letter]:font-semibold',
                  '[&_p:first-of-type:first-letter]:text-foreground/45',
                  '[&_p:first-of-type:first-letter]:pr-2',
                  '[&_p:first-of-type:first-letter]:pt-1',
                  '[&_p:first-of-type:first-letter]:font-serif',
                  '[&_h1]:mt-0 [&_h1]:typo-heading-lg [&_h1]:font-semibold [&_h1]:text-foreground',
                  '[&_h2]:mt-7 [&_h2]:typo-heading [&_h2]:font-semibold [&_h2]:text-foreground',
                  '[&_h3]:mt-5 [&_h3]:typo-label [&_h3]:text-foreground/80',
                  '[&_ul]:my-4 [&_ol]:my-4 [&_li]:mb-1.5',
                  '[&_pre]:my-5 [&_pre]:rounded-2xl',
                  '[&_code]:bg-foreground/[0.06] [&_code]:px-1.5 [&_code]:rounded',
                  '[&_blockquote]:my-5 [&_blockquote]:not-italic [&_blockquote]:text-foreground/85',
                  '[&_blockquote]:border-l-[3px] [&_blockquote]:border-primary/40',
                  '[&_blockquote]:bg-transparent [&_blockquote]:px-5',
                  '[&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/40',
                ].join(' ')}
              />
            </article>

            <div
              data-testid="msg-detail-content-actions"
              className="flex flex-wrap items-center gap-2 mt-3 pl-1"
            >
              <ContentActionButton
                onClick={handleExportPdf}
                icon={<Printer className="w-3.5 h-3.5" />}
                label={t.overview.messages_view.action_export_pdf}
                testId="msg-detail-action-export-pdf"
              />
              {companionEnabled && (
                <ContentActionButton
                  onClick={handlePlayInChat}
                  icon={<MessageCircle className="w-3.5 h-3.5" />}
                  label={t.overview.messages_view.action_play_in_chat}
                  testId="msg-detail-action-play-in-chat"
                  highlight
                />
              )}
            </div>
          </section>

          {/* II. Editor's note — feedback panel + star rating */}
          <section className="mb-10">
            <SectionMark index="II" label={t.overview.messages_view.improve_agent} muted />

            <StarRatingRow
              value={rating}
              onChange={handleRate}
              saving={ratingSaving}
              disabled={!message.execution_id}
              t={t}
              tx={tx}
            />

            {improving === 'sent' ? (
              <div className="flex items-center gap-3 px-5 py-4 mt-3 rounded-2xl bg-emerald-500/[0.08] border-l-[3px] border-emerald-400/70">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <span className="typo-body-lg text-emerald-300 font-medium">
                  {t.overview.messages_view.improvement_started}
                </span>
              </div>
            ) : !showFeedback ? (
              <button
                type="button"
                onClick={() => setShowFeedback(true)}
                className="group inline-flex items-center gap-3 px-5 py-4 mt-3 w-full text-left rounded-2xl border-l-[3px] border-amber-400/60 bg-amber-500/[0.05] hover:bg-amber-500/[0.08] transition-colors"
              >
                <Wand2 className="w-4 h-4 text-amber-400/85 flex-shrink-0 group-hover:text-amber-300 transition-colors" />
                <span className="typo-body-lg text-foreground/85 italic">
                  {t.overview.messages_view.what_could_be_better}
                </span>
                <span className="ml-auto typo-label text-amber-400/75">
                  {t.overview.messages_view.improve_agent}
                </span>
              </button>
            ) : (
              <div className="rounded-2xl border-l-[3px] border-amber-400/60 bg-amber-500/[0.05] px-5 py-4 mt-3">
                <p className="typo-label text-amber-300/85 mb-3">
                  {t.overview.messages_view.what_could_be_better}
                </p>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder={t.overview.messages_view.improve_placeholder}
                  rows={3}
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-amber-400/15 bg-background/30 typo-body-lg leading-relaxed text-foreground placeholder-foreground/35 resize-none outline-none focus-visible:border-amber-400/40 focus-visible:bg-background/55 transition-colors"
                />
                <div className="flex items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handleImprove}
                    disabled={!feedbackText.trim() || improving === 'loading'}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-card typo-caption font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 transition-colors"
                  >
                    {improving === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    {improving === 'loading' ? t.overview.messages_view.starting : t.overview.messages_view.submit_improvement}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowFeedback(false); setFeedbackText(''); }}
                    className="px-3 py-2 typo-caption text-foreground/65 hover:text-foreground/85 transition-colors"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* III. Delivery — colophon row */}
          <section className="mb-10">
            <SectionMark
              index="III"
              label={t.overview.messages_view.delivery_status}
              icon={<Send className="w-3 h-3.5 text-foreground/45" />}
              muted
            />
            {deliveriesLoading ? null : deliveries.length === 0 ? (
              <p className="typo-body text-foreground/55 italic">
                {t.overview.messages_view.no_channels}
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                {deliveries.map((d) => {
                  const defaultStatus = deliveryStatusConfig.pending!;
                  const statusCfg = deliveryStatusConfig[d.status] ?? defaultStatus;
                  const StatusIcon = statusCfg.icon;
                  return (
                    <div key={d.id} className="inline-flex items-center gap-2 typo-body">
                      <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusCfg.color}`} />
                      <span className="text-foreground/90 font-medium">
                        {channelLabels[d.channel_type] ?? d.channel_type}
                      </span>
                      <span className={`typo-caption font-semibold ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                      {d.delivered_at && (
                        <span className="typo-caption text-foreground/45 tabular-nums">
                          · {formatRelativeTime(d.delivered_at)}
                        </span>
                      )}
                      {d.error_message && (
                        <span
                          className="typo-caption text-red-400/80 truncate max-w-[220px]"
                          title={d.error_message}
                        >
                          · {d.error_message}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* IV. Pending decisions — manual reviews linked to this execution */}
          <section data-testid="msg-detail-pending-decisions">
            <SectionMark
              index="IV"
              label={t.overview.messages_view.section_pending_decisions}
              icon={<ShieldCheck className="w-3 h-3.5 text-foreground/45" />}
              muted
            />
            {reviewsLoading ? null : linkedReviews.length === 0 ? (
              <p className="typo-body text-foreground/55 italic">
                {t.overview.messages_view.pending_decisions_empty}
              </p>
            ) : (
              <div className="space-y-3">
                {linkedReviews.map((r) => (
                  <PendingDecisionCard
                    key={r.id}
                    review={r}
                    resolving={resolvingReviewId === r.id}
                    onApprove={() => handleResolveReview(r, 'approved')}
                    onReject={() => handleResolveReview(r, 'rejected')}
                    onOpenInApprovals={() => {
                      useOverviewStore.getState().setOverviewTab('manual-review');
                      onClose();
                    }}
                    t={t}
                  />
                ))}
              </div>
            )}
          </section>
        </motion.div>
      </AnimatePresence>
    </DetailModal>
  );
}

// ---------------------------------------------------------------------------
// Star rating row
// ---------------------------------------------------------------------------

function StarRatingRow({
  value, onChange, saving, disabled, t, tx,
}: {
  value: number;
  onChange: (stars: number) => void;
  saving: boolean;
  disabled: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  tx: ReturnType<typeof useTranslation>['tx'];
}) {
  const [hover, setHover] = useState<number>(0);
  const display = hover || value;

  return (
    <div
      data-testid="msg-detail-rating"
      className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-secondary/[0.05] border border-primary/10"
    >
      <span className="typo-label text-foreground/70 flex-shrink-0">
        {t.overview.messages_view.rating_label}
      </span>
      <div
        className="inline-flex items-center gap-0.5"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= display;
          return (
            <button
              key={n}
              type="button"
              data-testid={`msg-detail-rating-star-${n}`}
              data-rating-value={n}
              onMouseEnter={() => setHover(n)}
              onClick={() => onChange(n)}
              disabled={disabled || saving}
              aria-label={tx(t.overview.messages_view.rating_star_aria, { value: n })}
              className={`p-1 rounded-card transition-transform ${
                disabled ? 'cursor-not-allowed opacity-40' :
                saving ? 'cursor-wait' :
                'hover:scale-110'
              }`}
            >
              <Star
                className={`w-5 h-5 transition-colors ${
                  filled
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-foreground/25'
                }`}
              />
            </button>
          );
        })}
      </div>
      {value > 0 && (
        <span
          data-testid="msg-detail-rating-saved"
          data-rating-saved={value}
          className="typo-caption text-foreground/60 ml-auto"
        >
          {saving
            ? <Loader2 className="inline w-3 h-3 animate-spin" />
            : tx(t.overview.messages_view.rating_saved, { stars: value })}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending decision card — reuses Manual Review visual primitives
// ---------------------------------------------------------------------------

function PendingDecisionCard({
  review, resolving, onApprove, onReject, onOpenInApprovals, t,
}: {
  review: PersonaManualReview;
  resolving: boolean;
  onApprove: () => void;
  onReject: () => void;
  onOpenInApprovals: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  // Multi-decision payloads live inside `context_data.decisions[]`. When
  // present, we render each child as its own FocusedDecisionCard — the
  // same primitive sub_manual-review uses — so the parent acts like a
  // group header with the children rendered inline. Per-decision verdicts
  // are tracked locally so the user can sweep through them; the parent's
  // Approve/Reject still resolves the whole review (single status on the
  // backend), but the local verdicts capture intent so the user can see
  // a coherent decision summary before they commit.
  const { decisions, contextText } = useMemo(
    () => parseDecisions(review.context_data),
    [review.context_data],
  );
  const hasChildren = decisions.length > 0;
  const [childVerdicts, setChildVerdicts] = useState<Record<string, DecisionVerdict>>({});

  const setVerdict = useCallback((id: string, v: 'accept' | 'reject') => {
    setChildVerdicts((prev) => ({ ...prev, [id]: prev[id] === v ? undefined : v }));
  }, []);

  // When the user accepts everything we offer a fast "Approve all", and
  // when they reject anything we offer "Reject all" — the per-decision
  // verdicts inform a quick parent action. Without verdicts these stay
  // as the default buttons.
  const allAccepted = hasChildren && decisions.every((d) => childVerdicts[d.id] === 'accept');
  const anyRejected = hasChildren && decisions.some((d) => childVerdicts[d.id] === 'reject');

  return (
    <div
      data-testid={`pending-review-row-${review.id}`}
      className="rounded-2xl border border-primary/10 bg-secondary/[0.04] px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <SeverityIndicator severity={review.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="typo-body-lg font-medium text-foreground break-words">
              {review.title}
            </p>
            {hasChildren && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input typo-caption font-semibold text-primary/85 bg-primary/10 border border-primary/15"
                data-testid={`pending-review-decisions-count-${review.id}`}
              >
                {decisions.length} decisions
              </span>
            )}
          </div>
          {review.description && (
            <p className="typo-body text-foreground/75 leading-relaxed mb-2">
              {review.description}
            </p>
          )}
          {contextText && (
            <p className="typo-body text-foreground/70 leading-relaxed mb-2 whitespace-pre-wrap">
              {contextText}
            </p>
          )}
          {!hasChildren && review.context_data && (
            <div className="mt-2 px-3 py-2 rounded-card bg-background/30 border border-primary/[0.06]">
              <ContextDataPreview raw={review.context_data} />
            </div>
          )}
        </div>
        <span className="typo-caption text-foreground/45 tabular-nums flex-shrink-0">
          {formatRelativeTime(review.created_at)}
        </span>
      </div>

      {hasChildren && (
        <div
          className="mt-3 space-y-2 pl-3 border-l border-primary/10"
          data-testid={`pending-review-decisions-${review.id}`}
        >
          {decisions.map((decision) => (
            <FocusedDecisionCard
              key={decision.id}
              decision={decision}
              verdict={childVerdicts[decision.id]}
              onDecide={(v) => setVerdict(decision.id, v)}
              imageUrl={getDecisionImage(decision)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          data-testid={`pending-review-approve-${review.id}`}
          onClick={onApprove}
          disabled={resolving || (hasChildren && anyRejected)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-card typo-caption font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
          title={hasChildren && anyRejected ? 'Clear rejections before approving the whole review' : undefined}
        >
          {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
          {hasChildren
            ? allAccepted
              ? t.overview.messages_view.pending_decisions_approve_all
              : t.overview.messages_view.pending_decisions_approve
            : t.overview.messages_view.pending_decisions_approve}
        </button>
        <button
          type="button"
          data-testid={`pending-review-reject-${review.id}`}
          onClick={onReject}
          disabled={resolving}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-card typo-caption font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition-colors"
        >
          {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
          {hasChildren && anyRejected
            ? t.overview.messages_view.pending_decisions_reject_all
            : t.overview.messages_view.pending_decisions_reject}
        </button>
        <button
          type="button"
          onClick={onOpenInApprovals}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-2 typo-caption text-foreground/55 hover:text-foreground/85 transition-colors"
        >
          <ShieldAlert className="w-3 h-3" />
          {t.overview.messages_view.pending_decisions_view_all}
        </button>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Content action button (Export PDF / Play in chat)
// ---------------------------------------------------------------------------

function ContentActionButton({
  onClick, icon, label, testId, highlight = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
  highlight?: boolean;
}) {
  const baseCls =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption font-medium transition-colors';
  const toneCls = highlight
    ? 'text-primary bg-primary/[0.08] hover:bg-primary/[0.14] border border-primary/15'
    : 'text-foreground/75 bg-secondary/[0.05] hover:bg-secondary/[0.1] border border-primary/10';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`${baseCls} ${toneCls}`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SectionMark — Roman-numeral display + tracked label + hairline rule.
// ---------------------------------------------------------------------------

function SectionMark({
  index, label, icon, muted = false,
}: {
  index: string;
  label: string;
  icon?: React.ReactNode;
  muted?: boolean;
}) {
  const numeralTone = muted ? 'text-foreground/30' : 'text-primary/55';
  const labelTone   = muted ? 'text-foreground/55' : 'text-foreground/75';
  const ruleTone    = muted ? 'bg-foreground/10'   : 'bg-primary/20';
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span className={`font-serif text-4xl font-light leading-none ${numeralTone}`}>
        {index}
      </span>
      {icon}
      <span className={`typo-label ${labelTone}`}>
        {label}
      </span>
      <span className={`flex-1 h-px ${ruleTone}`} aria-hidden="true" />
    </div>
  );
}
