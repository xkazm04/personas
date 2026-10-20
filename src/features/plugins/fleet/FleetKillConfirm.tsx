import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  /** Session label shown under the title so the operator sees which one ends. */
  label: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Confirmation in front of ending a LIVE Claude session. Kill is irreversible
 * (hibernate is the reversible alternative); a tombstone dismiss stays one
 * click and never reaches this dialog.
 *
 * @catalog Confirm dialog for killing a live fleet session.
 */
export function FleetKillConfirm({ label, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      title={t.plugins.fleet.kill_session}
      body={label}
      danger
      confirmLabel={t.plugins.fleet.kill_session}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
