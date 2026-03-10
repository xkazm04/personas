import { useState, useEffect, useRef, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import {
  migratePromptToStructured,
  parseStructuredPrompt,
  createEmptyStructuredPrompt,
} from '@/lib/personas/promptMigration';
import type { StructuredPrompt } from '@/lib/personas/promptMigration';

/**
 * Encapsulates structured-prompt hydration, persona-switch detection,
 * external-update detection, and baseline tracking.
 */
export function useStructuredPromptSync() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);

  const [sp, setSp] = useState<StructuredPrompt>(createEmptyStructuredPrompt());
  const [baseline, setBaseline] = useState<StructuredPrompt>(sp);

  const personaIdRef = useRef<string | null>(null);
  const spRef = useRef(sp);
  spRef.current = sp;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const lastLoadedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedPersona) {
      const empty = createEmptyStructuredPrompt();
      setSp(empty);
      setBaseline(empty);
      personaIdRef.current = null;
      lastLoadedPromptRef.current = null;
      return;
    }
    const currentPromptRaw = selectedPersona.structured_prompt ?? null;
    const isNewPersona = personaIdRef.current !== selectedPersona.id;
    const isExternalUpdate =
      !isNewPersona &&
      currentPromptRaw !== lastLoadedPromptRef.current &&
      currentPromptRaw !== JSON.stringify(baselineRef.current);
    if (!isNewPersona && !isExternalUpdate) return;
    personaIdRef.current = selectedPersona.id;
    lastLoadedPromptRef.current = currentPromptRaw;
    const parsed = parseStructuredPrompt(currentPromptRaw);
    if (parsed) {
      setSp(parsed);
      setBaseline(parsed);
      return;
    }
    if (selectedPersona.system_prompt) {
      const migrated = migratePromptToStructured(selectedPersona.system_prompt);
      setSp(migrated);
      setBaseline(migrated);
      return;
    }
    const empty = createEmptyStructuredPrompt();
    setSp(empty);
    setBaseline(empty);
  }, [selectedPersona]);

  const markSaved = useCallback((saved: StructuredPrompt) => {
    setBaseline(saved);
    lastLoadedPromptRef.current = JSON.stringify(saved);
  }, []);

  return {
    selectedPersona,
    sp,
    setSp,
    baseline,
    markSaved,
    personaIdRef,
    spRef,
    baselineRef,
  };
}
