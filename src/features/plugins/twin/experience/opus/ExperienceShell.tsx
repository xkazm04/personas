/**
 * The layer the whole Twin experience lives in: full width, full height below
 * the title bar, over the entire app including the sidebar.
 *
 * It IS a dialog, so it owes the keyboard what every dialog here owes it
 * (`useDialogKeyboard`, the primitive extracted from BaseModal): focus moves
 * in, Tab cannot walk out into the page underneath, Escape closes, and focus
 * goes back to whatever summoned it. It sits on the full-screen rung, below
 * BaseModal's, so a modal raised from inside still takes Escape first.
 *
 * Portalled to <body>: the Twin pages animate their entrance with a
 * transform, and a transformed ancestor would turn `position: fixed` into
 * "fixed to that ancestor" — an overlay the size of the page it was opened
 * from rather than the window.
 */

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { useDialogKeyboard } from '@/lib/keyboard/useDialogKeyboard';
import './experience.css';

interface ExperienceShellProps {
  onClose: () => void;
  /** Id of the heading that names the layer. */
  labelledBy: string;
  children: ReactNode;
}

export function ExperienceShell({ onClose, labelledBy, children }: ExperienceShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useDialogKeyboard(ref, onClose, { priority: FULLSCREEN_LAYER_PRIORITY });

  return createPortal(
    <motion.div
      ref={ref}
      // eslint-disable-next-line custom/enforce-base-modal -- a full-screen layer, not a centred modal: BaseModal's panel cannot fill the window. Focus trap, Escape and focus restore come from useDialogKeyboard, the primitive extracted FROM BaseModal (as FullScreenOverlay does).
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      data-testid="twin-experience"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="xo-root xo-felt fixed inset-x-0 bottom-0 top-[var(--titlebar-height,40px)] z-50 flex flex-col text-foreground overflow-hidden"
    >
      {children}
    </motion.div>,
    document.body,
  );
}

export default ExperienceShell;
