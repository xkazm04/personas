import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import * as credApi from '@/api/vault/credentials';
import { toCredentialMetadata, type CredentialMetadata } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import {
  getCredentialTags,
  buildMetadataWithTags,
  SUGGESTED_TAGS,
} from '@/features/vault/utils/credentialTags';

export function useCredentialTags(credential: CredentialMetadata) {
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [copiedCredentialId, setCopiedCredentialId] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const copiedCredentialIdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentTags = useMemo(() => getCredentialTags(credential), [credential]);

  const persistTags = useCallback(async (nextTags: string[]) => {
    const metadata = buildMetadataWithTags(credential, nextTags);
    try {
      const updatedRaw = await credApi.updateCredential(credential.id, {
        name: null,
        service_type: null,
        encrypted_data: null,
        metadata,
      });
      const updated = toCredentialMetadata(updatedRaw);
      usePersonaStore.setState((s) => ({
        credentials: s.credentials.map((c) => (c.id === credential.id ? updated : c)),
      }));
    } catch {
      // intentional: non-critical — tag metadata update is best-effort
    }
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

  const copyCredentialId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(credential.id);
      setCopiedCredentialId(true);
      if (copiedCredentialIdTimerRef.current) clearTimeout(copiedCredentialIdTimerRef.current);
      copiedCredentialIdTimerRef.current = setTimeout(() => setCopiedCredentialId(false), 1500);
    } catch {
      // intentional: non-critical — clipboard copy may be denied by browser
    }
  }, [credential.id]);

  useEffect(() => {
    return () => {
      if (copiedCredentialIdTimerRef.current) clearTimeout(copiedCredentialIdTimerRef.current);
    };
  }, []);

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
