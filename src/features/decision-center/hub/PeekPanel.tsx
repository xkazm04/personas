/* eslint-disable custom/enforce-base-modal --
 * A NON-modal popover anchored under a strip chip, not a centred modal: the
 * board behind it stays live, so BaseModal's backdrop and focus trap would be
 * wrong. Escape, the walk keys and click-outside are owned by the hub
 * (`usePeekKeyboard`, `DecisionHub`). Same call as `QuickEditPopover`. */
/**
 * PeekPanel — the anchored popover both peeks hang in.
 *
 * `role="dialog"` on purpose, beyond semantics: the Monitor's own Escape
 * yields while any `[role="dialog"]` is in the DOM, and a popover a person can
 * act inside is a dialog, not a tooltip. Non-modal — the board stays live.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { MOTION } from '@/lib/utils/designTokens';

/** The peek's width; the hub clamps the anchor so it never leaves the window. */
export const PEEK_WIDTH = 440;

export function PeekPanel({
  label, title, left, onClose, children, testId = 'decision-peek',
}: {
  label: string;
  title: string;
  left: number;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const offset = reduced ? 0 : -6;

  return (
    <motion.div
      role="dialog"
      aria-modal={false}
      aria-label={label}
      data-testid={testId}
      initial={{ opacity: 0, y: offset }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.duration.fast / 1000 }}
      style={{ left, width: PEEK_WIDTH }}
      className="absolute top-full z-30 mt-2 flex max-h-[60vh] flex-col overflow-hidden rounded-card border border-border bg-background shadow-elevation-3"
    >
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="ae-engrave typo-label min-w-0 flex-1 truncate">{title}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t.common.close}
          data-testid={`${testId}-close`}
          icon={<X className="h-3.5 w-3.5" />}
        />
      </div>
      {children}
    </motion.div>
  );
}
