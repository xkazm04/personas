/**
 * The two corner affordances that hang off the orb: quick-input and dismiss.
 *
 * Both stop pointer events from reaching the orb underneath — otherwise the
 * orb's own down/move/up gesture recogniser would treat the press as the start
 * of a drag (or a hold that arms the mic) and the button would never fire.
 */

import { Keyboard, X } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaStore } from '../athenaStore';
import Button from '@/features/shared/components/buttons/Button';

export function AthenaOrbCornerActions({
  quickInputOpen,
  onToggleQuickInput,
}: {
  quickInputOpen: boolean;
  onToggleQuickInput: () => void;
}) {
  const { t } = useTranslation();
  const c = t.athena;
  const quickLabel = quickInputOpen ? c.orb_quick_input_close : c.orb_quick_input_open;

  return (
    <>
      {/* Quick-message toggle → the compact input bar the LAYER renders (outside
          this transformed wrapper, so its `fixed` positioning resolves against
          the viewport). Hover-revealed like dismiss, but stays visible while the
          bar is open so it doubles as its discoverable close twin. */}
      <Tooltip content={quickLabel}>
        <Button
          variant="ghost"
          size="icon-xs"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleQuickInput();
          }}
          data-testid="companion-orb-quick-input-toggle"
          aria-label={quickLabel}
          className="pointer-events-auto absolute -bottom-1 -right-1"
          pressed={quickInputOpen}
        >
          <Keyboard className="w-3 h-3" />
        </Button>
      </Tooltip>

      {/* Dismiss → hide the orb entirely (collapsed). Hover-revealed. */}
      <Tooltip content={c.orb_dismiss}>
        <Button
          variant="ghost"
          size="icon-xs"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            useAthenaStore.getState().setState('collapsed');
          }}
          data-testid="companion-orb-dismiss"
          aria-label={c.orb_dismiss}
          className="pointer-events-auto absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <X className="w-3 h-3" />
        </Button>
      </Tooltip>
    </>
  );
}
