import { useTranslation } from '@/i18n/useTranslation';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { AnimatePresence, motion } from 'framer-motion';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { useOverviewStore } from '@/stores/overviewStore';
import { printReport } from '../libs/reportPrint';
import { openReportInChat } from '../libs/openReportInChat';
import {
  useReportDeliveries,
  useReportRating,
  useLinkedReviews,
  useReportFeedback,
} from '../libs/useReportDetail';
import {
  ReportTitle,
  ReportSubtitle,
  ReportModalActions,
  ReportContentSection,
  ReportFeedbackSection,
  ReportDeliverySection,
  ReportDecisionsSection,
} from './ReportDetailSections';
import type { PersonaReport } from '@/lib/types/types';

interface MessageDetailModalProps {
  message: PersonaReport;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
  onNavigate?: (dir: 1 | -1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

/**
 * Message detail modal — editorial reading layout with operational hooks.
 *
 * This component is the SHELL only: chrome, navigation, and the order of the
 * four sections. Every piece of markup lives in `ReportDetailSections.tsx` and
 * every piece of data/IO in `../libs/` — see those files' headers for why the
 * markup is one file rather than nine.
 *
 * Sections:
 *   I.  Content        — large reading surface + per-content actions row
 *                        (Export to PDF, Play in chat).
 *   II. Improve agent  — star rating quick path + free-form feedback.
 *                        Ratings are upserted into the persona's memory
 *                        store so re-rating updates rather than duplicates.
 *   III. Delivery      — row of ChannelDeliveryPill chips (brand icon in a
 *                        status-colored ring + status label + RelativeTime).
 *   IV. Pending decisions — surfaces manual-review rows linked to the
 *                        same execution_id. Inline approve/reject so the
 *                        user can resolve message + review in one stop.
 */
export function ReportDetailModal({
  message, onClose, onDelete, onNavigate, hasPrev, hasNext,
}: MessageDetailModalProps) {
  const { t, tx } = useTranslation();
  const msgId = message.id ?? '';
  const msgContent = message.content ?? '';
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { copied: copiedId, copy: copyId } = useCopyToClipboard();
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markReportAsRead = useOverviewStore((s) => s.markReportAsRead);

  // Plugin gating — Companion plugin must be enabled for "Play in chat".
  const companionEnabled = useSystemStore((s) => s.enabledPlugins.has('companion'));

  const { deliveries, deliveriesLoading } = useReportDeliveries(msgId);
  const { rating, ratingSaving, rate } = useReportRating(message, t, tx);
  const { linkedReviews, reviewsLoading, resolvingReviewId, resolveReview } =
    useLinkedReviews(message);
  const feedback = useReportFeedback(message);
  const resetFeedback = feedback.reset;

  useEffect(() => {
    if (msgId && !message.is_read) {
      markReportAsRead(msgId);
    }
  }, [msgId, message.is_read, markReportAsRead]);

  useEffect(() => {
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, []);

  // Stepping to another report resets every transient control in the modal.
  useEffect(() => {
    resetFeedback();
    setConfirmingDelete(false);
  }, [msgId, resetFeedback]);

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

  const openPersonaDetail = useCallback(() => {
    if (!message.persona_id) return;
    useAgentStore.getState().selectPersona(message.persona_id);
    useSystemStore.getState().setSidebarSection('personas');
    onClose();
  }, [message.persona_id, onClose]);

  const armDelete = useCallback(() => {
    setConfirmingDelete(true);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
  }, []);

  return (
    <DetailModal
      title={
        <ReportTitle
          message={message}
          t={t}
          onNavigate={onNavigate}
          hasPrev={hasPrev}
          hasNext={hasNext}
          go={go}
        />
      }
      subtitle={
        <ReportSubtitle message={message} t={t} onOpenPersona={openPersonaDetail} />
      }
      onClose={onClose}
      actions={
        <ReportModalActions
          message={message}
          msgId={msgId}
          t={t}
          copiedId={copiedId}
          onCopyId={() => copyId(msgId)}
          onOpenExecution={() => {
            useAgentStore.getState().selectPersona(message.persona_id);
            useSystemStore.getState().setEditorTab('use-cases');
          }}
          confirmingDelete={confirmingDelete}
          onArmDelete={armDelete}
          onCancelDelete={() => setConfirmingDelete(false)}
          onConfirmDelete={handleDelete}
        />
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
          <ReportContentSection
            content={msgContent}
            t={t}
            companionEnabled={companionEnabled}
            onExportPdf={() => printReport(message, {
              unknownPersona: t.overview.reports_view.unknown_persona,
              reportLabel: t.overview.reports_view.report_label,
            })}
            onPlayInChat={() => {
              if (!message.execution_id) return;
              openReportInChat(message, linkedReviews, t.overview.reports_view.report_label);
              // Close the message modal so chat + cockpit own the screen.
              onClose();
            }}
          />

          <ReportFeedbackSection
            t={t}
            tx={tx}
            state={{
              rating,
              ratingSaving,
              ratingDisabled: !message.execution_id,
              onRate: rate,
              showFeedback: feedback.showFeedback,
              setShowFeedback: feedback.setShowFeedback,
              feedbackText: feedback.feedbackText,
              setFeedbackText: feedback.setFeedbackText,
              improving: feedback.improving,
              onImprove: feedback.improve,
            }}
          />

          <ReportDeliverySection
            deliveries={deliveries}
            loading={deliveriesLoading}
            t={t}
          />

          <ReportDecisionsSection
            reviews={linkedReviews}
            loading={reviewsLoading}
            resolvingId={resolvingReviewId}
            onApprove={(r) => resolveReview(r, 'approved')}
            onReject={(r) => resolveReview(r, 'rejected')}
            onOpenInApprovals={() => {
              useOverviewStore.getState().setOverviewTab('manual-review');
              onClose();
            }}
            t={t}
          />
        </motion.div>
      </AnimatePresence>
    </DetailModal>
  );
}
