import { useCallback, useMemo, useRef } from 'react';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { useAgentStore } from "@/stores/agentStore";
import { type PersonaDraft, draftChanged, SETTINGS_KEYS, MODEL_KEYS } from './PersonaDraft';
import { OLLAMA_CLOUD_BASE_URL, getOllamaPreset } from '../../sub_model_config/OllamaCloudPresets';
import { useTabSection } from './useTabSection';
import { useDebouncedSaveGroup } from './useDebouncedSaveGroup';
import { useEditorHistory, type UndoEntry } from './EditorDocument';
import type { PersonaOperation } from '@/api/agents/personas';

interface UseEditorSaveOptions {
  draft: PersonaDraft;
  baseline: PersonaDraft;
  setDraft: React.Dispatch<React.SetStateAction<PersonaDraft>>;
  setBaseline: React.Dispatch<React.SetStateAction<PersonaDraft>>;
  pendingPersonaId: string | null;
}

export function useEditorSave({ draft, baseline, setDraft, setBaseline, pendingPersonaId }: UseEditorSaveOptions) {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const { pushUndo } = useEditorHistory();

  // Keep latest draft/baseline in refs so save callbacks never capture stale state
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const settingsDirty = draftChanged(draft, baseline, SETTINGS_KEYS);
  const modelDirty = draftChanged(draft, baseline, MODEL_KEYS);

  /** Build an undo entry that restores draft+baseline to `prev` for the given keys. */
  const makeUndoEntry = useCallback(
    (op: PersonaOperation, prev: PersonaDraft, keys: readonly (keyof PersonaDraft)[]): UndoEntry => ({
      operation: op,
      restore: async () => {
        const patch: Partial<PersonaDraft> = {};
        for (const k of keys) (patch as Record<string, unknown>)[k] = prev[k];
        setDraft((d) => ({ ...d, ...patch }));
        setBaseline((b) => ({ ...b, ...patch }));
      },
    }),
    [setDraft, setBaseline],
  );

  const performSettingsSave = useCallback(async (d: PersonaDraft) => {
    if (!selectedPersona) return;
    const prevBaseline = { ...baselineRef.current };
    const op: PersonaOperation = {
      kind: 'UpdateSettings',
      name: d.name,
      description: d.description || null,
      icon: d.icon || null,
      color: d.color || null,
      max_concurrent: d.maxConcurrent,
      timeout_ms: d.timeout,
      enabled: d.enabled,
      sensitive: d.sensitive,
    };
    await applyPersonaOp(selectedPersona.id, op);
    setBaseline((prev) => ({ ...prev, name: d.name, description: d.description, icon: d.icon, color: d.color, maxConcurrent: d.maxConcurrent, timeout: d.timeout, enabled: d.enabled, sensitive: d.sensitive }));
    pushUndo(makeUndoEntry(op, prevBaseline, SETTINGS_KEYS));
  }, [selectedPersona, applyPersonaOp, setBaseline, pushUndo, makeUndoEntry]);

  const performModelSave = useCallback(async (d: PersonaDraft) => {
    if (!selectedPersona) return;
    const prevBaseline = { ...baselineRef.current };

    let profile: string | null;
    const cachePolicy = d.promptCachePolicy !== 'none' ? d.promptCachePolicy : undefined;
    const ollamaPreset = getOllamaPreset(d.selectedModel);
    if (ollamaPreset) {
      profile = JSON.stringify({
        model: ollamaPreset.modelId,
        provider: 'ollama',
        base_url: OLLAMA_CLOUD_BASE_URL,
        prompt_cache_policy: cachePolicy,
      } satisfies ModelProfile);
    } else if (d.selectedModel === 'custom') {
      profile = JSON.stringify({
        model: d.customModelName || undefined,
        provider: d.selectedProvider,
        base_url: d.baseUrl || undefined,
        auth_token: d.authToken || undefined,
        prompt_cache_policy: cachePolicy,
      } satisfies ModelProfile);
    } else {
      profile = JSON.stringify({
        model: d.selectedModel,
        provider: 'anthropic',
        prompt_cache_policy: cachePolicy,
      } satisfies ModelProfile);
    }

    const op: PersonaOperation = {
      kind: 'SwitchModel',
      model_profile: profile,
      max_budget_usd: d.maxBudget === '' ? null : d.maxBudget,
      max_turns: d.maxTurns === '' ? null : d.maxTurns,
    };
    await applyPersonaOp(selectedPersona.id, op);
    setBaseline((prev) => ({ ...prev, selectedModel: d.selectedModel, selectedProvider: d.selectedProvider, baseUrl: d.baseUrl, authToken: d.authToken, customModelName: d.customModelName, maxBudget: d.maxBudget, maxTurns: d.maxTurns, promptCachePolicy: d.promptCachePolicy }));
    pushUndo(makeUndoEntry(op, prevBaseline, MODEL_KEYS));
  }, [selectedPersona, applyPersonaOp, setBaseline, pushUndo, makeUndoEntry]);

  const handleSaveSettings = useDebouncedSaveGroup({
    draftRef,
    baselineRef,
    keys: SETTINGS_KEYS,
    performSave: performSettingsSave,
  });

  const saveModelSettings = useDebouncedSaveGroup({
    draftRef,
    baselineRef,
    keys: MODEL_KEYS,
    performSave: performModelSave,
  });

  const { isSaving: isSavingSettings, lastError: settingsError } = useTabSection({
    tab: 'settings',
    isDirty: settingsDirty,
    save: handleSaveSettings,
    mode: 'debounced',
    delay: 800,
    deps: [draft.name, draft.description, draft.icon, draft.color, draft.maxConcurrent, draft.timeout, draft.enabled, draft.sensitive],
    enabled: !!selectedPersona && !pendingPersonaId,
  });

  const { isSaving: isSavingModel, lastError: modelError } = useTabSection({
    tab: 'model',
    isDirty: modelDirty,
    save: saveModelSettings,
    mode: 'debounced',
    delay: 800,
    deps: [draft.selectedModel, draft.selectedProvider, draft.baseUrl, draft.authToken, draft.customModelName, draft.maxBudget, draft.maxTurns, draft.promptCachePolicy],
    enabled: !!selectedPersona && !pendingPersonaId,
  });

  const isSaving = isSavingSettings || isSavingModel;
  const saveError = settingsError || modelError;

  return useMemo(() => ({
    settingsDirty,
    modelDirty,
    isSaving,
    saveError,
  }), [settingsDirty, modelDirty, isSaving, saveError]);
}
