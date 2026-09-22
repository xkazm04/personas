/**
 * AthenaChatJumpToLatest — the "back to the bottom" pill.
 *
 * Only appears once the user has scrolled away from the latest turn (the
 * transcript stops auto-pinning at that point), and fades rather than pops so
 * a brief scroll wobble near the bottom doesn't flash it.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CHAT_EASE } from './athenaChatMorph';

export function AthenaChatJumpToLatest({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key="companion-jump-to-latest"
          type="button"
          onClick={onClick}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.96 }}
          transition={{ duration: 0.18, ease: CHAT_EASE }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 rounded-full bg-secondary/95 border border-foreground/15 shadow-elevation-3 px-3 py-1.5 typo-caption font-medium text-foreground hover:bg-secondary backdrop-blur-sm transition-colors focus-ring"
          data-testid="companion-jump-to-latest"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          {t.plugins.companion.jump_to_latest}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
