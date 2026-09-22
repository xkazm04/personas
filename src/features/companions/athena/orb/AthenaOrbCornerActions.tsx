/**
 * The two corner affordances that hang off the orb: quick-input and dismiss.
 *
 * Both stop pointer events from reaching the orb underneath — otherwise the
 * orb's own down/move/up gesture recogniser would treat the press as the start
 * of a drag (or a hold that arms the mic) and the button would never fire.
 */

import { Keyboard, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from '../companionStore';

export function AthenaOrbCornerActions({
  quickInputOpen,
  onToggleQuickInput,
}: {
  quickInputOpen: boolean;
  onToggleQuickInput: () => void;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const quickLabel = quickInputOpen ? c.orb_quick_input_close : c.orb_quick_input_open;

  return (
    <>
      {/* Quick-message toggle → the compact input bar the LAYER renders (outside
          this transformed wrapper, so its `fixed` positioning resolves against
          the viewport). Hover-revealed like dismiss, but stays visible while the
          bar is open so it doubles as its discoverable close twin. */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleQuickInput();
        }}
        data-testid="companion-orb-quick-input-toggle"
        aria-pressed={quickInputOpen}
        className={`pointer-events-auto absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-primary/20 bg-background text-foreground shadow-elevation-2 transition-opacity hover:bg-secondary focus:opacity-100 ${
          quickInputOpen ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100'
        }`}
        title={quickLabel}
        aria-label={quickLabel}
      >
        <Keyboard className="w-3 h-3" />
      </button>

      {/* Dismiss → hide the orb entirely (collapsed). Hover-revealed. */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          useCompanionStore.getState().setState('collapsed');
        }}
        data-testid="companion-orb-dismiss"
        className="pointer-events-auto absolute -top-1 -right-1 w-5 h-5 rounded-full bg-background border border-primary/20 text-foreground hover:bg-secondary flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shadow-elevation-2"
        title={c.orb_dismiss}
        aria-label={c.orb_dismiss}
      >
        <X className="w-3 h-3" />
      </button>
    </>
  );
}
