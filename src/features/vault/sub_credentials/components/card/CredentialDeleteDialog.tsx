import { useMemo } from 'react';
import { useBlastRadius } from '@/features/shared/components/display/BlastRadiusPanel';
import { ConfirmDestructiveModal } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { getCredentialBlastRadius } from '@/api/vault/credentials';
import type { CredentialMetadata } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

export interface DeleteConfirmState {
  credential: CredentialMetadata;
  eventCount: number;
  eventCountVerified?: boolean;
}

export interface CredentialDeleteDialogProps {
  deleteConfirm: DeleteConfirmState | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

export function CredentialDeleteDialog({
  deleteConfirm,
  onConfirmDelete,
  onCancelDelete,
}: CredentialDeleteDialogProps) {
  const { t } = useTranslation();
  const credentialId = deleteConfirm?.credential?.id ?? '';
  const { items: blastItems, loading: blastLoading } = useBlastRadius(
    () => getCredentialBlastRadius(credentialId),
    !!deleteConfirm && !!credentialId,
  );

  const config = useMemo(() => {
    if (!deleteConfirm) return null;
    return {
      title: t.vault.delete_dialog.title,
      message: t.vault.delete_dialog.cannot_undo,
      details: [
        { label: t.vault.delete_dialog.label_name, value: deleteConfirm.credential.name },
        { label: t.vault.delete_dialog.label_type, value: deleteConfirm.credential.service_type },
      ],
      blastRadiusItems: blastItems,
      blastRadiusLoading: blastLoading,
      warningMessage: deleteConfirm.eventCountVerified === false
        ? t.vault.delete_dialog.unverified_warning
        : undefined,
      onConfirm: onConfirmDelete,
      onCancel: onCancelDelete,
    };
  }, [deleteConfirm, blastItems, blastLoading, onConfirmDelete, onCancelDelete]);

  return (
    <ConfirmDestructiveModal
      open={!!deleteConfirm}
      config={config}
    />
  );
}
