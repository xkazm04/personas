// QuickAnswerPopover — lightweight header surface to answer pending build /
// adoption questions and human reviews without leaving the current screen.
//
// Sibling to the full-screen PersonaMonitor: this is the fast "a question is
// waiting — answer it and keep working" path. Mounted from
// ProcessActivityIndicator when headerOverlay === 'quick-answer'.

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Activity, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePendingInteractions } from './usePendingInteractions';
import { QuickAnswerQuestionGroup } from './QuickAnswerQuestionGroup';
import { QuickAnswerReviewStepper } from './QuickAnswerReviewStepper';

interface QuickAnswerPopoverProps {
  onClose: () => void;
  onOpenMonitor: () => void;
}

/** Deep-link to a persona's builder surface (the C-ready seam for complex
 *  questions), mirroring the Monitor's process navigation. */
function openBuilder(personaId: string, close: () => void) {
  const system = useSystemStore.getState();
  system.setSidebarSection('personas');
  system.setEditorTab('matrix' as Parameters<typeof system.setEditorTab>[0]);
  useAgentStore.getState().selectPersona(personaId);
  close();
}

export function QuickAnswerPopover({ onClose, onOpenMonitor }: QuickAnswerPopoverProps) {
  const { t, tx } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    questionGroups, reviews, total, isProcessing,
    submitQuestionAnswers, handleReviewAction,
  } = usePendingInteractions();

  // Esc closes; click-outside closes. (Route nav / Back already clear the
  // header overlay centrally in uiSlice.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Defer click-outside so the opening click on the titlebar button doesn't
    // immediately close the just-opened popover.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.14 }}
      aria-label={tx(t.monitor.quick_aria, { count: total })}
      data-testid="quick-answer-popover"
      className="fixed top-[var(--titlebar-height,40px)] right-2 z-50 w-[576px] max-w-[calc(100vw-1rem)] max-h-[80vh] flex flex-col rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 h-12 border-b border-primary/10 bg-secondary/15">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="typo-heading-lg font-semibold text-foreground">{t.monitor.quick_title}</span>
          {total > 0 && <span className="typo-caption text-foreground/50 tabular-nums">{total}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenMonitor}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/15 bg-secondary/20 typo-caption text-foreground/80 hover:text-foreground hover:bg-secondary/40 transition-colors"
            data-testid="quick-answer-open-monitor"
          >
            <Activity className="w-3.5 h-3.5" />
            {t.monitor.quick_open_monitor}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.monitor.quick_close}
            className="p-1.5 rounded-modal border border-primary/15 text-foreground/70 hover:text-foreground hover:bg-secondary/30 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-400/80" />
            <span className="typo-body-lg font-medium text-foreground">{t.monitor.quick_empty_title}</span>
            <span className="typo-body text-foreground/60 max-w-[300px]">{t.monitor.quick_empty_body}</span>
          </div>
        ) : (
          <>
            {questionGroups.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <span className="typo-label font-bold uppercase tracking-[0.16em] text-foreground/55">
                  {t.monitor.quick_questions_header}
                </span>
                {questionGroups.map((g) => (
                  <QuickAnswerQuestionGroup
                    key={g.sessionId}
                    group={g}
                    busy={isProcessing}
                    onSubmit={submitQuestionAnswers}
                    onOpenBuilder={(pid) => openBuilder(pid, onClose)}
                  />
                ))}
              </section>
            )}
            {reviews.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <span className="typo-label font-bold uppercase tracking-[0.16em] text-foreground/55">
                  {t.monitor.quick_reviews_header}
                </span>
                {/* One decision at a time, full description + the suggested
                    actions as clickable triage branches. */}
                <QuickAnswerReviewStepper
                  reviews={reviews}
                  busy={isProcessing}
                  onAction={handleReviewAction}
                />
              </section>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

export default QuickAnswerPopover;
