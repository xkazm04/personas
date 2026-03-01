import { useCallback, useMemo } from 'react';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { usePersonaStore } from '@/stores/personaStore';
import { useDebouncedSave } from '@/hooks';
import { type PersonaDraft, draftChanged, SETTINGS_KEYS, MODEL_KEYS } from './PersonaDraft';
import { OLLAMA_CLOUD_BASE_URL, getOllamaPreset } from './sub_model_config/OllamaCloudPresets';
import { useEditorDirty } from './EditorDocument';

interface UseEditorSaveOptions {
  draft: PersonaDraft;
  baseline: PersonaDraft;
  setBaseline: React.Dispatch<React.SetStateAction<PersonaDraft>>;
  pendingPersonaId: string | null;
}

export function useEditorSave({ draft, baseline, setBaseline, pendingPersonaId }: UseEditorSaveOptions) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const applyPersonaOp = usePersonaStore((s) => s.applyPersonaOp);

  const settingsDirty = draftChanged(draft, baseline, SETTINGS_KEYS);
  const modelDirty = draftChanged(draft, baseline, MODEL_KEYS);

  const handleSaveSettings = useCallback(async () => {
    if (!selectedPersona) return;
    await applyPersonaOp(selectedPersona.id, {
      kind: 'UpdateSettings',
      name: draft.name,
      description: draft.description || null,
      icon: draft.icon || null,
      color: draft.color || null,
      max_concurrent: draft.maxConcurrent,
      timeout_ms: draft.timeout,
      enabled: draft.enabled,
    });
    setBaseline((prev) => ({ ...prev, name: draft.name, description: draft.description, icon: draft.icon, color: draft.color, maxConcurrent: draft.maxConcurrent, timeout: draft.timeout, enabled: draft.enabled }));
  }, [selectedPersona, applyPersonaOp, draft, setBaseline]);

  const saveModelSettings = useCallback(async () => {
    if (!selectedPersona) return;

    let profile: string | null = null;
    const ollamaPreset = getOllamaPreset(draft.selectedModel);

    if (ollamaPreset) {
      profile = JSON.stringify({
        model: ollamaPreset.modelId,
        provider: 'ollama',
        base_url: OLLAMA_CLOUD_BASE_URL,
      } satisfies ModelProfile);
    } else if (draft.selectedModel === 'custom') {
      profile = JSON.stringify({
        model: draft.customModelName || undefined,
        provider: draft.selectedProvider,
        base_url: draft.baseUrl || undefined,
        auth_token: draft.authToken || undefined,
      } satisfies ModelProfile);
    } else if (draft.selectedModel !== '') {
      profile = JSON.stringify({
        model: draft.selectedModel,
        provider: 'anthropic',
      } satisfies ModelProfile);
    }

    await applyPersonaOp(selectedPersona.id, {
      kind: 'SwitchModel',
      model_profile: profile,
      max_budget_usd: draft.maxBudget === '' ? null : draft.maxBudget,
      max_turns: draft.maxTurns === '' ? null : draft.maxTurns,
    });
    setBaseline((prev) => ({ ...prev, selectedModel: draft.selectedModel, selectedProvider: draft.selectedProvider, baseUrl: draft.baseUrl, authToken: draft.authToken, customModelName: draft.customModelName, maxBudget: draft.maxBudget, maxTurns: draft.maxTurns }));
  }, [selectedPersona, applyPersonaOp, draft, setBaseline]);

  const { isSaving: isSavingSettings, cancel: cancelSettingsSave } = useDebouncedSave(
    handleSaveSettings,
    settingsDirty && !!selectedPersona && !pendingPersonaId,
    [draft.name, draft.description, draft.icon, draft.color, draft.maxConcurrent, draft.timeout, draft.enabled],
    800,
  );
  const { isSaving: isSavingModel, cancel: cancelModelSave } = useDebouncedSave(
    saveModelSettings,
    modelDirty && !!selectedPersona && !pendingPersonaId,
    [draft.selectedModel, draft.selectedProvider, draft.baseUrl, draft.authToken, draft.customModelName, draft.maxBudget, draft.maxTurns],
    800,
  );

  useEditorDirty('settings', settingsDirty, handleSaveSettings, cancelSettingsSave);
  useEditorDirty('model', modelDirty, saveModelSettings, cancelModelSave);

  const isSaving = isSavingSettings || isSavingModel;

  return useMemo(() => ({
    settingsDirty,
    modelDirty,
    isSaving,
  }), [settingsDirty, modelDirty, isSaving]);
}
