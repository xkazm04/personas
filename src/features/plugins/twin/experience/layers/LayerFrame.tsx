/**
 * A LAYER: the one shape everything heavy in the Mirror takes.
 *
 * The lane never grows a panel. When the person wants what the twin knows,
 * what to train on, its voice, or every field at once, that arrives as a layer
 * docked to the right edge, over a scrim that dims the lane behind it. One act
 * at a time, and the act you left is still visibly there to go back to.
 *
 * It is a dialog in its own right, so it takes the keyboard above the shell
 * that hosts it (`OVERLAY_DISMISS_PRIORITY` > `FULLSCREEN_LAYER_PRIORITY`):
 * Escape closes the LAYER, not the whole experience, and Tab stays inside it
 * while it is open.
 */

import { useId, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { OVERLAY_DISMISS_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { useDialogKeyboard } from '@/lib/keyboard/useDialogKeyboard';
import { useTranslation } from '@/i18n/useTranslation';
import { layerVariants } from '../cardMotion';

interface LayerFrameProps {
  open: boolean;
  onClose: () => void;
  icon: ReactNode;
  title: string;
  hint?: string;
  /** Rendered in the header, right of the hint — a count, a control, nothing. */
  aside?: ReactNode;
  /** `wide` for the fields editor, which is a grid; `lane` for the rest. */
  width?: 'lane' | 'wide';
  testId: string;
  children: ReactNode;
}

const WIDTH = { lane: 'w-[min(34rem,94%)]', wide: 'w-[min(60rem,96%)]' } as const;

export function LayerFrame({
  open,
  onClose,
  icon,
  title,
  hint,
  aside,
  width = 'lane',
  testId,
  children,
}: LayerFrameProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = `mr-layer-${useId()}`;
  useDialogKeyboard(ref, onClose, { enabled: open, priority: OVERLAY_DISMISS_PRIORITY });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            key="scrim"
            type="button"
            aria-label={t.common.close}
            tabIndex={-1}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-10 cursor-default bg-background/70"
            data-testid={`${testId}-scrim`}
          />
          <motion.aside
            key="layer"
            ref={ref}
            // eslint-disable-next-line custom/enforce-base-modal -- a drawer docked to the edge of the layer that hosts it, not a centred modal: BaseModal's panel cannot be edge-docked inside a parent, and this one deliberately dims only the lane rather than the app. Focus trap, Escape and focus restore come from useDialogKeyboard, the primitive extracted FROM BaseModal.
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid={testId}
            variants={layerVariants(reduced)}
            initial="enter"
            animate="rest"
            exit="gone"
            className={`absolute inset-y-0 right-0 z-20 flex flex-col border-l border-primary/15 bg-background shadow-elevation-4 ${WIDTH[width]}`}
          >
            <header className="flex-shrink-0 flex items-start gap-3 px-5 py-3.5 border-b border-primary/10">
              <span aria-hidden className="mt-0.5 text-primary">
                {icon}
              </span>
              <div className="min-w-0 flex-1">
                <h3 id={titleId} className="typo-section-title">
                  {title}
                </h3>
                {hint && <p className="typo-caption">{hint}</p>}
              </div>
              {aside}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label={t.common.close}
                data-testid={`${testId}-close`}
                icon={<X className="w-4 h-4" />}
              />
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default LayerFrame;
