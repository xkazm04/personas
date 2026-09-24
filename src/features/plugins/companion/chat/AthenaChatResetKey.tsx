/**
 * AthenaChatResetKey — the Reset key both chat headers carry.
 *
 * Reset wipes the SQL transcript with no undo anywhere in the product, and the
 * key sits among cheap, reversible toggles, so it asks first — through the
 * shared `ConfirmPopover`, the same anchored confirmation the sleep-cycle key
 * uses, not a centred modal.
 */

import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ConfirmPopover } from '@/features/shared/components/feedback/ConfirmPopover';
import type { HeaderKeyLook } from './AthenaAutonomyOption';
import { resetConversation } from './athenaChatActions';

export function AthenaChatResetKey({ look }: { look: HeaderKeyLook }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Tooltip content={c.reset} placement={open ? 'top' : 'bottom'}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={c.reset}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="companion-reset"
          className={`grid place-items-center shrink-0 transition-colors focus-ring ${look.button} ${
            open ? look.active : ''
          }`}
        >
          <RotateCcw className={look.icon} strokeWidth={look.stroke} />
        </button>
      </Tooltip>
      <ConfirmPopover
        open={open}
        anchorRef={triggerRef}
        tone="danger"
        title={c.reset_confirm_title}
        detail={c.reset_confirm_body}
        confirmLabel={c.reset_confirm_action}
        confirmIcon={<RotateCcw className="w-3.5 h-3.5" />}
        onConfirm={async () => {
          await resetConversation();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
        testId="companion-reset-confirm"
        confirmTestId="companion-reset-confirm-action"
      />
    </>
  );
}
