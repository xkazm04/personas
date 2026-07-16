import { useCallback, useMemo } from 'react';
import { BlastRadiusPanel, useBlastRadius } from '@/features/overview/components/BlastRadiusPanel';
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
  // Memoized: useBlastRadius keys its fetch effect on the fetcher identity, so
  // an inline arrow here refetched the blast radius in an infinite IPC loop for
  // as long as the dialog stayed open.
  const fetchBlastRadius = useCallback(() => getCredentialBlastRadius(credentialId), [credentialId]);
  const { items: blastItems, loading: blastLoading } = useBlastRadius(
    fetchBlastRadius,
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
      blastRadius: <BlastRadiusPanel items={blastItems} loading={blastLoading} />,
      warningMessage: deleteConfirm.eventCountVerified === false
        ? t.vault.delete_dialog.unverified_warning
        : undefined,
      onConfirm: onConfirmDelete,
      onCancel: onCancelDelete,
    };
  }, [deleteConfirm, t.vault.delete_dialog.title, t.vault.delete_dialog.cannot_undo, t.vault.delete_dialog.label_name, t.vault.delete_dialog.label_type, t.vault.delete_dialog.unverified_warning, blastItems, blastLoading, onConfirmDelete, onCancelDelete]);

  return (
    <ConfirmDestructiveModal
      open={!!deleteConfirm}
      config={config}
    />
  );
}
