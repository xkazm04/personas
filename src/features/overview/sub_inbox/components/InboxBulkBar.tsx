/**
 * InboxBulkBar — floating bulk-action toolbar that slides up when one or
 * more inbox rows are selected. Mirrors the DataGrid bulk-action toolbar
 * pattern so the visual language is consistent across the app, but the
 * action set is inbox-specific (Resolve / Snooze / Clear).
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Clock, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

const EASE_CURVE = [0.22, 1, 0.36, 1] as [number, number, number, number];

interface Props {
  count: number;
  onResolveAll: () => void;
  onSnoozeAll: () => void;
  onClear: () => void;
}

export function InboxBulkBar({ count, onResolveAll, onSnoozeAll, onClear }: Props) {
  const { t, tx } = useTranslation();
  const r = t.overview.inbox_triage;
  const { shouldAnimate } = useMotion();

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          key="inbox-bulk-bar"
          role="toolbar"
          aria-label={r.bulk_toolbar_aria}
          initial={shouldAnimate ? { y: 12, opacity: 0 } : { opacity: 1 }}
          animate={{ y: 0, opacity: 1 }}
          exit={shouldAnimate ? { y: 12, opacity: 0 } : { opacity: 0 }}
          transition={shouldAnimate ? { duration: 0.22, ease: EASE_CURVE } : { duration: 0.01 }}
          className="pointer-events-none absolute left-1/2 bottom-4 z-30 -translate-x-1/2"
        >
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-modal border border-primary/20 bg-secondary/85 shadow-elevation-3 backdrop-blur-md">
            <span className="typo-body text-foreground font-medium px-2">
              {tx(r.bulk_selected, { count })}
            </span>
            <div className="w-px h-5 bg-primary/15" />
            <button
              type="button"
              onClick={onResolveAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-label text-emerald-400 hover:bg-emerald-500/15 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              {r.bulk_resolve_all}
            </button>
            <button
              type="button"
              onClick={onSnoozeAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-label text-foreground hover:bg-secondary/60 transition-colors"
            >
              <Clock className="w-3.5 h-3.5" />
              {r.bulk_snooze_all}
            </button>
            <div className="w-px h-5 bg-primary/15" />
            <button
              type="button"
              onClick={onClear}
              aria-label={r.bulk_clear}
              className="p-1.5 rounded-card text-foreground hover:bg-secondary/60 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
