import { AlertTriangle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { BlastRadiusPanel, useBlastRadius } from '@/features/shared/components/display/BlastRadiusPanel';
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

  return (
    <BaseModal
      isOpen={!!deleteConfirm}
      onClose={onCancelDelete}
      titleId="delete-dialog-title"
      maxWidthClass="max-w-sm"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden"
    >
      {deleteConfirm && (
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 id="delete-dialog-title" className="text-sm font-semibold text-foreground/90">Delete Credential</h3>
              <p className="text-sm text-muted-foreground/90 mt-1">This action cannot be undone.</p>
            </div>
          </div>

          <div className="bg-secondary/40 border border-primary/10 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-mono uppercase text-muted-foreground/80">Name</span>
              <span className="text-sm text-foreground/80">{deleteConfirm.credential.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-mono uppercase text-muted-foreground/80">Type</span>
              <span className="text-sm font-mono text-muted-foreground/80">{deleteConfirm.credential.service_type}</span>
            </div>
          </div>

          <BlastRadiusPanel items={blastItems} loading={blastLoading} />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onCancelDelete}
              className="px-4 py-2 text-sm text-muted-foreground/80 hover:text-foreground/95 rounded-xl hover:bg-secondary/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmDelete}
              className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </BaseModal>
  );
}
