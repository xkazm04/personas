// FullScreenOverlay — the shared "summoned module" shell, mirroring the Persona
// Monitor pattern: a full-screen surface below the title bar that covers the app
// (it does NOT change your underlying navigation), dismissable by the corner
// close button or Escape. Used for the title-bar dock's full-size surfaces
// (Schedules, Goal acceptance) so they read consistently. Notifications and
// Quick Answer stay as partial overlays and do NOT use this.
//
// The shell is deliberately chrome-light: just the container + a slim close bar.
// Each content provides its OWN `ContentBox`/`ContentHeader`, so the shell never
// competes with the module's title.
import { useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

export function FullScreenOverlay({
  onClose,
  children,
  testId,
}: {
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();

  // Escape closes — mirrors the Monitor. Capture phase so it wins over content
  // that also listens for Escape, but only when nothing more local handled it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      data-testid={testId}
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-height,40px)] z-50 bg-background flex flex-col"
    >
      {/* Slim close bar — collision-free spot for the dismiss control, so the
          content's own ContentHeader stays the module's title. */}
      <div className="shrink-0 flex items-center justify-end px-3 pt-2 pb-0.5">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </motion.div>
  );
}
