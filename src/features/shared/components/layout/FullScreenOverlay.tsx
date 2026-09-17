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
//
// It IS a dialog. It covers everything, so focus must move into it, Tab must
// not walk out of it into the title bar or the page underneath, and closing it
// must put focus back on the control that summoned it. `useDialogKeyboard`
// (extracted from BaseModal) owns all three plus Escape, at the rung BELOW
// BaseModal's, so a modal raised from inside this shell still takes Escape
// first. Until 2026-09-17 there was none of this: no role, no trap, no restore,
// and a window-level `keydown` in the BUBBLE phase despite a comment claiming
// capture.
import { useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { FULLSCREEN_LAYER_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { useDialogKeyboard } from '@/lib/keyboard/useDialogKeyboard';

export function FullScreenOverlay({
  onClose,
  children,
  testId,
  ariaLabel,
}: {
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  /** Accessible name for the dialog (already translated). Name the module. */
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const shellRef = useRef<HTMLDivElement>(null);

  useDialogKeyboard(shellRef, onClose, { priority: FULLSCREEN_LAYER_PRIORITY });

  return (
    <motion.div
      ref={shellRef}
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
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
