import { useState, useCallback, useMemo, useRef } from 'react';
import * as credApi from '@/api/vault/credentials';
import { toCredentialMetadata, type CredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import {
  getCredentialTags,
  SUGGESTED_TAGS,
} from '@/features/vault/shared/utils/credentialTags';
import { silentCatch } from '@/lib/silentCatch';


export function useCredentialTags(credential: CredentialMetadata) {
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { copied: copiedCredentialId, copy } = useCopyToClipboard(1500);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const currentTags = useMemo(() => getCredentialTags(credential), [credential]);

  const persistTags = useCallback(async (nextTags: string[]) => {
    // Patch, don't round-trip. This used to call `buildMetadataWithTags`, which
    // parses the WHOLE metadata blob out of the `credential` React prop,
    // replaces `tags`, and writes the whole thing back — a read-modify-write
    // against a possibly-stale client copy. Replaying it against a live 18-key
    // blob lost 3 keys written by the backend since the prop was captured.
    //
    // `patch_metadata_atomic` re-reads and merges inside one transaction, and
    // treats a null value as REMOVE (credentials.rs:719-724) — which is exactly
    // what `buildMetadataWithTags` did with `delete next.tags` on an empty list.
    try {
      const updatedRaw = await credApi.patchCredentialMetadata(credential.id, {
        tags: nextTags.length > 0 ? nextTags : null,
      });
      const updated = toCredentialMetadata(updatedRaw);
      useVaultStore.setState((s) => ({
        credentials: s.credentials.map((c) => (c.id === credential.id ? updated : c)),
      }));
    } catch (err) { silentCatch("features/vault/shared/hooks/useCredentialTags:catch1")(err); }
  }, [credential]);

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || currentTags.includes(trimmed)) return;
    void persistTags([...currentTags, trimmed]);
    setTagInput('');
    setShowSuggestions(false);
  }, [currentTags, persistTags]);

  const removeTag = useCallback((tag: string) => {
    void persistTags(currentTags.filter((t) => t !== tag));
  }, [currentTags, persistTags]);

  const filteredSuggestions = useMemo(
    () => SUGGESTED_TAGS.filter((s) => !currentTags.includes(s) && s.includes(tagInput.toLowerCase())),
    [currentTags, tagInput],
  );

  const startTagInput = useCallback(() => {
    setShowTagInput(true);
    setTimeout(() => tagInputRef.current?.focus(), 0);
  }, []);

  const onTagInputChange = useCallback((value: string) => {
    setTagInput(value);
    setShowSuggestions(true);
  }, []);

  const onTagInputKeyDown = useCallback((key: string) => {
    if (key === 'Enter' && tagInput.trim()) {
      addTag(tagInput);
    }
    if (key === 'Escape') {
      setShowTagInput(false);
      setTagInput('');
      setShowSuggestions(false);
    }
  }, [addTag, tagInput]);

  const onTagInputBlur = useCallback(() => {
    setTimeout(() => {
      setShowTagInput(false);
      setTagInput('');
      setShowSuggestions(false);
    }, 150);
  }, []);

  const copyCredentialId = useCallback(() => {
    copy(credential.id);
  }, [credential.id, copy]);

  // Note: the previous useEffect cleanup of copiedCredentialIdTimerRef is
  // gone — useCopyToClipboard owns unmount cleanup of the reset timer
  // internally.

  return {
    currentTags,
    tagInput,
    showTagInput,
    showSuggestions,
    filteredSuggestions,
    tagInputRef,
    copiedCredentialId,
    addTag,
    removeTag,
    copyCredentialId,
    startTagInput,
    onTagInputChange,
    onTagInputKeyDown,
    onTagInputBlur,
  };
}
