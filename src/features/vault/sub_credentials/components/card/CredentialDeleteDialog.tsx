import { useMemo } from 'react';
import { useBlastRadius } from '@/features/shared/components/display/BlastRadiusPanel';
import { ConfirmDestructiveModal } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { getCredentialBlastRadius } from '@/api/vault/credentials';
import type { CredentialMetadata } from '@/lib/types/types';

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
  const credentialId = deleteConfirm?.credential?.id ?? '';
  const { items: blastItems, loading: blastLoading } = useBlastRadius(
    () => getCredentialBlastRadius(credentialId),
    !!deleteConfirm && !!credentialId,
  );

  const config = useMemo(() => {
    if (!deleteConfirm) return null;
    return {
      title: 'Delete Credential',
      message: 'This action cannot be undone.',
      details: [
        { label: 'Name', value: deleteConfirm.credential.name },
        { label: 'Type', value: deleteConfirm.credential.service_type },
      ],
      blastRadiusItems: blastItems,
      blastRadiusLoading: blastLoading,
      warningMessage: deleteConfirm.eventCountVerified === false
        ? 'Could not verify all dependencies. Some connected agents or automations may not be shown.'
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
