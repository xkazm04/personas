import { useCallback, useRef, useState, type RefObject } from 'react';
import { toCredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';
import * as credApi from '@/api/vault/credentials';
import type { CredentialMetadata } from '@/lib/types/types';
import { silentCatch } from '@/lib/silentCatch';

export interface UseCredentialRenameResult {
  isEditingName: boolean;
  editName: string;
  nameInputRef: RefObject<HTMLInputElement | null>;
  setEditName: (name: string) => void;
  startEditing: () => void;
  cancelEditing: () => void;
  saveName: () => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Shared inline credential-rename UX: trim/no-op-on-unchanged, persist via
 * `credApi.updateCredential`, and patch `useVaultStore` on success. Extracted
 * from `VectorKbModal` / `PlaygroundHeader`, which both carried an identical
 * copy of this `isEditingName`/`editName`/`saveName` block.
 */
export function useCredentialRename(credential: CredentialMetadata, logContext: string): UseCredentialRenameResult {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(credential.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    setEditName(credential.name);
    setIsEditingName(true);
  }, [credential.name]);

  const cancelEditing = useCallback(() => {
    setIsEditingName(false);
    setEditName(credential.name);
  }, [credential.name]);

  const saveName = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === credential.name) {
      setIsEditingName(false);
      setEditName(credential.name);
      return;
    }
    try {
      const updatedRaw = await credApi.updateCredential(credential.id, {
        name: trimmed,
        serviceType: null,
        encryptedData: null,
        iv: null,
        metadata: null,
        sessionEncryptedData: null,
      });
      const updated = toCredentialMetadata(updatedRaw);
      useVaultStore.setState((s) => ({
        credentials: s.credentials.map((c) => (c.id === credential.id ? updated : c)),
      }));
    } catch (err) {
      silentCatch(logContext)(err);
    }
    setIsEditingName(false);
  }, [credential.id, credential.name, editName, logContext]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void saveName();
    if (e.key === 'Escape') cancelEditing();
  }, [saveName, cancelEditing]);

  return { isEditingName, editName, nameInputRef, setEditName, startEditing, cancelEditing, saveName, handleKeyDown };
}
