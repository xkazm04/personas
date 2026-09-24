/**
 * The layer the Mirror lives in: full width, full height below the title bar,
 * over the entire app including the sidebar.
 *
 * It IS a dialog, so it owes the keyboard what every dialog here owes it
 * (`useDialogKeyboard`, the primitive extracted from BaseModal): focus moves
 * in, Tab cannot walk out into the page underneath, Escape closes, and focus
 * returns to whatever summoned it. It sits on the full-screen rung, below
 * BaseModal's, so a modal raised from inside still takes Escape first.
 *
 * Portalled to <body>: the Twin pages animate their entrance with a transform,
 * and a transformed ancestor turns `position: fixed` into "fixed to that
 * ancestor" — an overlay the size of the page it was opened from rather than
 * the window.
 */

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { useDialogKeyboard } from '@/lib/keyboard/useDialogKeyboard';
import './mirror.css';

interface MirrorShellProps {
  onClose: () => void;
  /** Id of the heading that names the layer. */
  labelledBy: string;
  children: ReactNode;
}

export function MirrorShell({ onClose, labelledBy, children }: MirrorShellProps) {
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
      data-testid="mirror-experience"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="mr-root mr-field fixed inset-x-0 bottom-0 top-[var(--titlebar-height,40px)] z-50 flex flex-col text-foreground overflow-hidden"
    >
      {children}
    </motion.div>,
    document.body,
  );
}

export default MirrorShell;
