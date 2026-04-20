import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { ModeComparisonCard } from './ModeComparisonCard';

/**
 * Confirmation modal shown when a Simple-mode user clicks "Switch to Power"
 * in `SimpleHomeShell`. Renders the Power `ModeComparisonCard` (compact) as a
 * preview of what the user is graduating into, alongside Confirm / Cancel
 * buttons.
 *
 * The Settings gear in SimpleHomeShell intentionally does NOT open this modal
 * — users can always reach settings without a confirmation gate. Only the
 * violet "Switch to Power mode" pill is gated behind this modal.
 *
 * Phase 12 (onboarding-graduate). The Phase 13 `ModeComparisonCard` preview
 * bullets do the heavy lifting of explaining what Power mode includes.
 */
export interface GraduateToPowerModalProps {
  isOpen: boolean;
  /** Parent handles `setViewMode(TIERS.TEAM) + setSidebarSection('home')` and closes the modal. */
  onConfirm: () => void;
  /** Parent closes the modal without changing view mode. */
  onCancel: () => void;
}

export function GraduateToPowerModal({ isOpen, onConfirm, onCancel }: GraduateToPowerModalProps) {
  const { t } = useTranslation();
  const g = t.simple_mode.graduate;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onCancel}
      titleId="graduate-to-power-title"
      maxWidthClass="max-w-md"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
      portal
    >
      <div className="p-6 space-y-4">
        <div>
          <h2 id="graduate-to-power-title" className="typo-heading-lg simple-display text-foreground">
            {g.title}
          </h2>
          <p className="typo-body text-foreground/70 mt-1">{g.subtitle}</p>
        </div>

        <ModeComparisonCard mode="team" isActive={false} onSelect={onConfirm} compact />

        <div className="flex items-center gap-2 justify-end pt-2 border-t border-primary/10">
          <Button variant="ghost" onClick={onCancel}>
            {g.cancel}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {g.confirm}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
