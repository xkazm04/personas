import { useState, useCallback } from 'react';
import type { DeleteConfirmState } from '@/features/vault/sub_credentials/components/card/CredentialDeleteDialog';
import { listCredentialEvents } from "@/api/vault/credentials";

import type { CredentialMetadata } from '@/lib/types/types';

interface UseUndoDeleteOptions {
  onDelete: (credentialId: string) => Promise<void>;
  onError: (message: string) => void;
}

export interface UndoDeleteState {
  deleteConfirm: DeleteConfirmState | null;
  requestDelete: (credential: CredentialMetadata) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
}

export function useUndoDelete({ onDelete, onError }: UseUndoDeleteOptions): UndoDeleteState {
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);

  const requestDelete = useCallback(async (credential: CredentialMetadata) => {
    try {
      const events = await listCredentialEvents(credential.id);
      setDeleteConfirm({ credential, eventCount: events.length, eventCountVerified: true });
    } catch {
      // intentional: non-critical -- event count preload failed, show dialog with unverified count
      setDeleteConfirm({ credential, eventCount: 0, eventCountVerified: false });
    }
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirm) return;
    const { credential } = deleteConfirm;
    setDeleteConfirm(null);
    onDelete(credential.id).catch((err: unknown) => {
      onError(err instanceof Error ? err.message : 'Failed to delete credential');
    });
  }, [deleteConfirm, onDelete, onError]);

  const cancelDelete = useCallback(() => {
    setDeleteConfirm(null);
  }, []);

  return {
    deleteConfirm,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
