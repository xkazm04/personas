/**
 * Confirmation dialog for disconnecting a persona from an event.
 *
 * Rendered on the modal host (BaseModal) so it inherits stack depth, Escape
 * arbitration, the focus trap and focus restore.
 */
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/features/shared/components/modals';
import { Button } from '@/features/shared/components/buttons';

const TITLE_ID = 'disconnect-persona-dialog-title';

interface Props {
  open: boolean;
  personaName: string;
  eventLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DisconnectDialog({ open, personaName, eventLabel, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();

  return (
    <BaseModal
      isOpen={open}
      onClose={onCancel}
      titleId={TITLE_ID}
      maxWidthClass="max-w-[380px]"
      panelClassName="rounded-2xl bg-card border border-primary/15 shadow-elevation-4 overflow-hidden"
      staggerChildren={false}
    >
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="w-9 h-9 rounded-modal flex items-center justify-center bg-status-error/10 flex-shrink-0">
          <AlertTriangle className="w-4.5 h-4.5 text-status-error" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 id={TITLE_ID} className="typo-heading text-foreground mb-1">{t.triggers.disconnect_persona_title}</h3>
          <p className="typo-caption text-foreground">
            <span className="font-medium text-foreground">{personaName}</span> {t.triggers.disconnect_will_no_longer}{' '}
            <span className="font-medium text-foreground">{eventLabel}</span> {t.triggers.disconnect_events_reconnect}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label={t.common.close} className="flex-shrink-0">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/10 bg-secondary/20">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button variant="accent" tone="error" size="sm" onClick={onConfirm}>
          {t.triggers.disconnect_confirm}
        </Button>
      </div>
    </BaseModal>
  );
}
