import { AlertTriangle, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import type { DisableConfirmationState } from '../../libs/useCapabilityToggle';

interface CapabilityDisableDialogProps {
  state: DisableConfirmationState;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modal for disabling a capability.
 *
 * Shown when pausing a capability that owns triggers, event subscriptions,
 * or running automations. Surfaces exact counts so the user understands the
 * cascade before committing.
 *
 * Phase C3. See `docs/concepts/persona-capabilities/02-use-case-as-capability.md`.
 */
export function CapabilityDisableDialog({ state, onConfirm, onCancel }: CapabilityDisableDialogProps) {
  const { useCaseTitle, preview } = state;
  const bits: string[] = [];
  if (preview.triggers_updated > 0)
    bits.push(`${preview.triggers_updated} trigger${preview.triggers_updated === 1 ? '' : 's'}`);
  if (preview.subscriptions_updated > 0)
    bits.push(`${preview.subscriptions_updated} event subscription${preview.subscriptions_updated === 1 ? '' : 's'}`);
  if (preview.automations_updated > 0)
    bits.push(`${preview.automations_updated} running automation${preview.automations_updated === 1 ? '' : 's'}`);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-labelledby="capability-disable-title"
        aria-describedby="capability-disable-description"
        className="w-full max-w-md mx-4 rounded-modal border border-amber-500/30 bg-background shadow-elevation-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 id="capability-disable-title" className="typo-heading text-foreground">
                Pause capability
              </h3>
              <p className="typo-body text-foreground mt-0.5">{useCaseTitle}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label="Dismiss"
            className="w-7 h-7 -mt-1 -mr-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-4 py-3 space-y-2">
          <p id="capability-disable-description" className="typo-body text-foreground">
            Pausing this capability will also pause:
          </p>
          <ul className="typo-body text-foreground/90 space-y-1 pl-4">
            {bits.map((b) => (
              <li key={b} className="list-disc">{b}</li>
            ))}
          </ul>
          <p className="typo-caption text-foreground mt-2">
            The persona&apos;s prompt will no longer list this capability. You can re-activate it at any time.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/10 bg-secondary/20">
          <Button variant="ghost" size="sm" onClick={onCancel} data-testid="capability-disable-cancel">
            Cancel
          </Button>
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            onClick={onConfirm}
            data-testid="capability-disable-confirm"
          >
            Pause capability
          </Button>
        </div>
      </div>
    </div>
  );
}
