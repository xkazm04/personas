import { useState, useCallback, useRef, useEffect } from 'react';
import type { DeleteConfirmState, UndoToastState } from '@/features/vault/components/CredentialDeleteDialog';
import * as api from '@/api/tauriApi';
import type { CredentialMetadata } from '@/lib/types/types';

interface UseUndoDeleteOptions {
  onDelete: (credentialId: string) => Promise<void>;
  onError: (message: string) => void;
}

export interface UndoDeleteState {
  deleteConfirm: DeleteConfirmState | null;
  undoToast: UndoToastState | null;
  requestDelete: (credential: CredentialMetadata) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  undo: () => void;
}

export function useUndoDelete({ onDelete, onError }: UseUndoDeleteOptions): UndoDeleteState {
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToastState | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const undoCancelledRef = useRef(false);

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const requestDelete = useCallback(async (credential: CredentialMetadata) => {
    try {
      const events = await api.listCredentialEvents(credential.id);
      setDeleteConfirm({ credential, eventCount: events.length });
    } catch {
      setDeleteConfirm({ credential, eventCount: 0 });
    }
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteConfirm) return;
    const { credential } = deleteConfirm;
    setDeleteConfirm(null);
    undoCancelledRef.current = false;

    let remaining = 5;
    setUndoToast({ credentialId: credential.id, credentialName: credential.name, remaining });

    clearUndoTimer();
    undoTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0 || undoCancelledRef.current) {
        clearUndoTimer();
        if (!undoCancelledRef.current) {
          onDelete(credential.id).catch((err: unknown) => {
            onError(err instanceof Error ? err.message : 'Failed to delete credential');
          });
        }
        setUndoToast(null);
      } else {
        setUndoToast((prev) => prev ? { ...prev, remaining } : null);
      }
    }, 1000);
  }, [deleteConfirm, onDelete, onError, clearUndoTimer]);

  const cancelDelete = useCallback(() => {
    setDeleteConfirm(null);
  }, []);

  const undo = useCallback(() => {
    undoCancelledRef.current = true;
    clearUndoTimer();
    setUndoToast(null);
  }, [clearUndoTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { clearUndoTimer(); };
  }, [clearUndoTimer]);

  return {
    deleteConfirm,
    undoToast,
    requestDelete,
    confirmDelete,
    cancelDelete,
    undo,
  };
}
