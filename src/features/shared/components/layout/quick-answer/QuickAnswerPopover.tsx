// QuickAnswerPopover — lightweight header surface to answer pending build /
// adoption questions and human reviews without leaving the current screen.
//
// Sibling to the full-screen PersonaMonitor: this is the fast "a question is
// waiting — answer it and keep working" path. Mounted from
// ProcessActivityIndicator when headerOverlay === 'quick-answer'.

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePendingInteractions } from './usePendingInteractions';
import { QuickAnswerBody } from './QuickAnswerBody';

interface QuickAnswerPopoverProps {
  onClose: () => void;
  onOpenMonitor: () => void;
}

export function QuickAnswerPopover({ onClose, onOpenMonitor }: QuickAnswerPopoverProps) {
  const { t, tx } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  // Just the count for the header chip — the body owns the full data itself.
  const { total } = usePendingInteractions();

  // Esc closes; click-outside closes. (Route nav / Back already clear the
  // header overlay centrally in uiSlice.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Ignore clicks on the titlebar trigger — it toggles the overlay itself,
      // so closing here would race the re-click into a close-then-reopen.
      if (target?.closest?.('[data-quick-answer-trigger]')) return;
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
          {total > 0 && <span className="typo-caption text-foreground tabular-nums">{total}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenMonitor}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/15 bg-secondary/20 typo-caption text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
            data-testid="quick-answer-open-monitor"
          >
            <Activity className="w-3.5 h-3.5" />
            {t.monitor.quick_open_monitor}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.monitor.quick_close}
            className="p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        <QuickAnswerBody onAfterBuilderNav={onClose} />
      </div>
    </motion.div>
  );
}

export default QuickAnswerPopover;
