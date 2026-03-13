import { useCallback, useMemo, useRef } from 'react';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { useAgentStore } from "@/stores/agentStore";
import { type PersonaDraft, draftChanged, SETTINGS_KEYS, MODEL_KEYS } from './PersonaDraft';
import { OLLAMA_CLOUD_BASE_URL, getOllamaPreset } from '../sub_model_config/OllamaCloudPresets';
import { getCopilotPreset } from '../sub_model_config/CopilotPresets';
import { useTabSection } from './useTabSection';

interface UseEditorSaveOptions {
  draft: PersonaDraft;
  baseline: PersonaDraft;
  setBaseline: React.Dispatch<React.SetStateAction<PersonaDraft>>;
  pendingPersonaId: string | null;
}

export function useEditorSave({ draft, baseline, setBaseline, pendingPersonaId }: UseEditorSaveOptions) {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const settingsSaveInFlightRef = useRef<Promise<void> | null>(null);
  const modelSaveInFlightRef = useRef<Promise<void> | null>(null);

  // Keep latest draft/baseline in refs so save callbacks never capture stale state
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const settingsDirty = draftChanged(draft, baseline, SETTINGS_KEYS);
  const modelDirty = draftChanged(draft, baseline, MODEL_KEYS);

  const handleSaveSettings = useCallback(async () => {
    while (settingsSaveInFlightRef.current) {
      await settingsSaveInFlightRef.current;
      if (!draftChanged(draftRef.current, baselineRef.current, SETTINGS_KEYS)) return;
    }

    const savePromise = (async () => {
    if (!selectedPersona) return;
    const d = draftRef.current;
    await applyPersonaOp(selectedPersona.id, {
      kind: 'UpdateSettings',
      name: d.name,
      description: d.description || null,
      icon: d.icon || null,
      color: d.color || null,
      max_concurrent: d.maxConcurrent,
      timeout_ms: d.timeout,
      enabled: d.enabled,
      sensitive: d.sensitive,
    });
    setBaseline((prev) => ({ ...prev, name: d.name, description: d.description, icon: d.icon, color: d.color, maxConcurrent: d.maxConcurrent, timeout: d.timeout, enabled: d.enabled, sensitive: d.sensitive }));
    })();

    settingsSaveInFlightRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      if (settingsSaveInFlightRef.current === savePromise) {
        settingsSaveInFlightRef.current = null;
      }
    }
  }, [selectedPersona, applyPersonaOp, setBaseline]);

  const saveModelSettings = useCallback(async () => {
    while (modelSaveInFlightRef.current) {
      await modelSaveInFlightRef.current;
      if (!draftChanged(draftRef.current, baselineRef.current, MODEL_KEYS)) return;
    }

    const savePromise = (async () => {
    if (!selectedPersona) return;
    const d = draftRef.current;

    let profile: string | null;
    const ollamaPreset = getOllamaPreset(d.selectedModel);
    const copilotPreset = getCopilotPreset(d.selectedModel);

    if (ollamaPreset) {
      profile = JSON.stringify({
        model: ollamaPreset.modelId,
        provider: 'ollama',
        base_url: OLLAMA_CLOUD_BASE_URL,
      } satisfies ModelProfile);
    } else if (copilotPreset) {
      profile = JSON.stringify({
        model: copilotPreset.modelId,
        provider: 'copilot',
      } satisfies ModelProfile);
    } else if (d.selectedModel === 'custom') {
      profile = JSON.stringify({
        model: d.customModelName || undefined,
        provider: d.selectedProvider,
        base_url: d.baseUrl || undefined,
        auth_token: d.authToken || undefined,
      } satisfies ModelProfile);
    } else {
      profile = JSON.stringify({
        model: d.selectedModel,
        provider: 'anthropic',
      } satisfies ModelProfile);
    }

    await applyPersonaOp(selectedPersona.id, {
      kind: 'SwitchModel',
      model_profile: profile,
      max_budget_usd: d.maxBudget === '' ? null : d.maxBudget,
      max_turns: d.maxTurns === '' ? null : d.maxTurns,
    });
    setBaseline((prev) => ({ ...prev, selectedModel: d.selectedModel, selectedProvider: d.selectedProvider, baseUrl: d.baseUrl, authToken: d.authToken, customModelName: d.customModelName, maxBudget: d.maxBudget, maxTurns: d.maxTurns }));
    })();

    modelSaveInFlightRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      if (modelSaveInFlightRef.current === savePromise) {
        modelSaveInFlightRef.current = null;
      }
    }
  }, [selectedPersona, applyPersonaOp, setBaseline]);

  const { isSaving: isSavingSettings } = useTabSection({
    tab: 'settings',
    isDirty: settingsDirty,
    save: handleSaveSettings,
    mode: 'debounced',
    delay: 800,
    deps: [draft.name, draft.description, draft.icon, draft.color, draft.maxConcurrent, draft.timeout, draft.enabled, draft.sensitive],
    enabled: !!selectedPersona && !pendingPersonaId,
  });

  const { isSaving: isSavingModel } = useTabSection({
    tab: 'model',
    isDirty: modelDirty,
    save: saveModelSettings,
    mode: 'debounced',
    delay: 800,
    deps: [draft.selectedModel, draft.selectedProvider, draft.baseUrl, draft.authToken, draft.customModelName, draft.maxBudget, draft.maxTurns],
    enabled: !!selectedPersona && !pendingPersonaId,
  });

  const isSaving = isSavingSettings || isSavingModel;

  return useMemo(() => ({
    settingsDirty,
    modelDirty,
    isSaving,
  }), [settingsDirty, modelDirty, isSaving]);
}
