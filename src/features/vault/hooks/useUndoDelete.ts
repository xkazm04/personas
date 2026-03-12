import { useState, useCallback, useRef, useEffect } from 'react';
import type { DeleteConfirmState, UndoToastState } from '@/features/vault/sub_card/CredentialDeleteDialog';
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
  const pendingDeleteRef = useRef<{ credentialId: string; credentialName: string } | null>(null);

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const requestDelete = useCallback(async (credential: CredentialMetadata) => {
    try {
      const events = await api.listCredentialEvents(credential.id);
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

    const previousPending = pendingDeleteRef.current;
    if (previousPending) {
      // User confirmed a second deletion while one countdown was active.
      // Commit the older confirmed deletion immediately before replacing toast state.
      onDelete(previousPending.credentialId).catch((err: unknown) => {
        onError(err instanceof Error ? err.message : 'Failed to delete credential');
      });
      pendingDeleteRef.current = null;
    }

    // Cancel any in-flight timer BEFORE resetting the flag. This prevents a
    // racing interval tick from seeing undoCancelledRef as false and firing
    // onDelete for the previous credential.
    undoCancelledRef.current = true;
    clearUndoTimer();
    undoCancelledRef.current = false;

    let remaining = 5;
    pendingDeleteRef.current = { credentialId: credential.id, credentialName: credential.name };
    setUndoToast({ credentialId: credential.id, credentialName: credential.name, remaining });
    undoTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0 || undoCancelledRef.current) {
        clearUndoTimer();
        if (!undoCancelledRef.current) {
          onDelete(credential.id).catch((err: unknown) => {
            onError(err instanceof Error ? err.message : 'Failed to delete credential');
          });
        }
        pendingDeleteRef.current = null;
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
    pendingDeleteRef.current = null;
    setUndoToast(null);
  }, [clearUndoTimer]);

  // Cleanup timer on unmount -- mark cancelled so a racing interval tick won't fire onDelete
  useEffect(() => {
    return () => {
      undoCancelledRef.current = true;
      pendingDeleteRef.current = null;
      clearUndoTimer();
    };
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
