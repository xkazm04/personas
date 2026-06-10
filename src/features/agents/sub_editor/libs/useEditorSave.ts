import { useCallback, useMemo, useRef } from 'react';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from '@/stores/toastStore';
import { capturePersonaToken } from '@/lib/personas/personaToken';
import { type PersonaDraft, draftChanged, SETTINGS_KEYS, MODEL_KEYS } from './PersonaDraft';
import { OLLAMA_CLOUD_BASE_URL, getOllamaPreset } from '../../sub_model_config/libs/OllamaCloudPresets';
import { useTabSection } from './useTabSection';
import { useDebouncedSaveGroup } from './useDebouncedSaveGroup';
import { useEditorHistory, type UndoEntry } from './EditorDocument';
import type { PersonaOperation } from '@/api/agents/personas';

/** Pick a subset of fields from a draft, returned as a typed partial. Used to
 *  derive setBaseline payloads from the same key arrays that drive dirty
 *  detection — keeping field lists in lockstep with PersonaDraft via the
 *  exhaustiveness check on SETTINGS_KEYS / MODEL_KEYS. */
function pickKeys<K extends keyof PersonaDraft>(d: PersonaDraft, keys: readonly K[]): Pick<PersonaDraft, K> {
  const out = {} as Pick<PersonaDraft, K>;
  for (const k of keys) out[k] = d[k];
  return out;
}

/** Build the UpdateSettings op from a draft. Shared by the debounced save and
 *  by undo/redo so a restore persists exactly the way a normal save does. */
function buildSettingsOp(d: PersonaDraft): PersonaOperation {
  return {
    kind: 'UpdateSettings',
    name: d.name,
    description: d.description || null,
    icon: d.icon || null,
    color: d.color || null,
    max_concurrent: d.maxConcurrent,
    timeout_ms: d.timeout,
    enabled: d.enabled,
    sensitive: d.sensitive,
    cli_awareness_enabled: d.cliAwarenessEnabled,
  };
}

/** Build the SwitchModel op (incl. serialised model_profile) from a draft.
 *  Shared by the debounced save and by undo/redo. */
function buildModelOp(d: PersonaDraft): PersonaOperation {
  let profile: string | null;
  const cachePolicy = d.promptCachePolicy !== 'none' ? d.promptCachePolicy : undefined;
  const ollamaPreset = getOllamaPreset(d.selectedModel);
  if (ollamaPreset) {
    // Ollama Cloud presets need the user's API key to authenticate — serialise
    // draft.authToken or the just-typed key is dropped and execution 401s.
    profile = JSON.stringify({
      model: ollamaPreset.modelId,
      provider: 'ollama',
      base_url: OLLAMA_CLOUD_BASE_URL,
      auth_token: d.authToken || undefined,
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
  return {
    kind: 'SwitchModel',
    model_profile: profile,
    max_budget_usd: d.maxBudget === '' ? null : d.maxBudget,
    max_turns: d.maxTurns === '' ? null : d.maxTurns,
  };
}

interface UseEditorSaveOptions {
  draft: PersonaDraft;
  baseline: PersonaDraft;
  setDraft: React.Dispatch<React.SetStateAction<PersonaDraft>>;
  setBaseline: React.Dispatch<React.SetStateAction<PersonaDraft>>;
  pendingPersonaId: string | null;
  /** When true, the model-fields debounced auto-save is paused. Used when
   *  the persisted model_profile JSON is corrupt — saving the reset state
   *  would overwrite the still-recoverable original. The user must
   *  explicitly re-select a model to unblock. */
  suppressModelSave?: boolean;
}

export function useEditorSave({ draft, baseline, setDraft, setBaseline, pendingPersonaId, suppressModelSave = false }: UseEditorSaveOptions) {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const selectedPersonaId = selectedPersona?.id;
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const { pushUndo } = useEditorHistory();

  // Keep latest draft/baseline in refs so save callbacks never capture stale state
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const settingsDirty = draftChanged(draft, baseline, SETTINGS_KEYS);
  const modelDirty = draftChanged(draft, baseline, MODEL_KEYS);

  /** Build an undo entry that restores draft+baseline to `prev` for the given keys,
   *  and can re-apply the forward state (`next`) on redo.
   *
   *  Tagged with the personaId at capture time. The setDraft/setBaseline
   *  setters are persona-agnostic — they always mutate the currently-selected
   *  persona. Without the personaId guard, pressing Ctrl+Z after switching
   *  personas (and before the persona-reset effect's clearHistory commits)
   *  would write persona A's old field values into persona B's draft+baseline,
   *  silently corrupting B and lying that "All saved" while disk holds the
   *  original values. */
  const makeUndoEntry = useCallback(
    (
      buildOp: (d: PersonaDraft) => PersonaOperation,
      prev: PersonaDraft,
      next: PersonaDraft,
      keys: readonly (keyof PersonaDraft)[],
    ): UndoEntry => {
      const personaId = selectedPersonaId ?? null;
      const token = capturePersonaToken(personaId);
      // Undo/redo must be a real persistence round-trip, not just an in-memory
      // draft+baseline swap. Moving baseline alone made settingsDirty false, so
      // the debounced autosave never reconciled disk with the undone state — the
      // DB silently kept the post-save value while the header read "All saved",
      // and the undo was discarded on the next reload. Persist first, then move
      // baseline; on failure leave the tab dirty and surface the error.
      const applyState = async (target: PersonaDraft) => {
        if (!token.isStillCurrent() || !personaId) return;
        const patch: Partial<PersonaDraft> = {};
        for (const k of keys) (patch as Record<string, unknown>)[k] = target[k];
        try {
          await applyPersonaOp(personaId, buildOp(target));
        } catch (err) {
          useToastStore.getState().addToast(
            `Undo failed to save: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          );
          return;
        }
        // Re-check after the IPC await — the user may have switched personas.
        if (!token.isStillCurrent()) return;
        setDraft((d) => ({ ...d, ...patch }));
        setBaseline((b) => ({ ...b, ...patch }));
      };
      return {
        operation: buildOp(next),
        restore: () => applyState(prev),
        reapply: () => applyState(next),
      };
    },
    [selectedPersonaId, applyPersonaOp, setDraft, setBaseline],
  );

  const performSettingsSave = useCallback(async (d: PersonaDraft) => {
    if (!selectedPersonaId) return;
    // Name is the one required field — never autosave an empty name (it would
    // persist a nameless persona that renders blank in the sidebar/header/resume
    // row). Skip the save; the tab stays dirty so the user fixes it first.
    if (d.name.trim() === '') return;
    const savePersonaId = selectedPersonaId;
    const prevBaseline = { ...baselineRef.current };
    const op = buildSettingsOp(d);
    await applyPersonaOp(savePersonaId, op);
    // Guard: bail if persona switched during the IPC await. The setBaseline /
    // pushUndo setters are persona-agnostic — they always mutate the currently-
    // selected persona's editor state. Without this guard, persona A's old
    // draft fields would silently overwrite persona B's freshly-loaded baseline,
    // and the undo entry would attach to B's history.
    if (useAgentStore.getState().selectedPersona?.id !== savePersonaId) return;
    setBaseline((prev) => ({ ...prev, ...pickKeys(d, SETTINGS_KEYS) }));
    pushUndo(makeUndoEntry(buildSettingsOp, prevBaseline, { ...d } as PersonaDraft, SETTINGS_KEYS));
  }, [selectedPersonaId, applyPersonaOp, setBaseline, pushUndo, makeUndoEntry]);

  const performModelSave = useCallback(async (d: PersonaDraft) => {
    if (!selectedPersonaId) return;
    const savePersonaId = selectedPersonaId;
    const prevBaseline = { ...baselineRef.current };
    const op = buildModelOp(d);
    await applyPersonaOp(savePersonaId, op);
    // Guard: bail if persona switched during the IPC await — see performSettingsSave.
    if (useAgentStore.getState().selectedPersona?.id !== savePersonaId) return;
    setBaseline((prev) => ({ ...prev, ...pickKeys(d, MODEL_KEYS) }));
    pushUndo(makeUndoEntry(buildModelOp, prevBaseline, { ...d } as PersonaDraft, MODEL_KEYS));
  }, [selectedPersonaId, applyPersonaOp, setBaseline, pushUndo, makeUndoEntry]);

  const handleSaveSettings = useDebouncedSaveGroup({
    draftRef,
    keys: SETTINGS_KEYS,
    performSave: performSettingsSave,
  });

  const saveModelSettings = useDebouncedSaveGroup({
    draftRef,
    keys: MODEL_KEYS,
    performSave: performModelSave,
  });

  const { isSaving: isSavingSettings, lastError: settingsError } = useTabSection({
    tab: 'settings',
    isDirty: settingsDirty,
    save: handleSaveSettings,
    mode: 'debounced',
    delay: 800,
    deps: SETTINGS_KEYS.map((k) => draft[k]),
    enabled: !!selectedPersonaId && !pendingPersonaId,
  });

  const { isSaving: isSavingModel, lastError: modelError } = useTabSection({
    tab: 'model',
    isDirty: modelDirty,
    save: saveModelSettings,
    mode: 'debounced',
    delay: 800,
    deps: MODEL_KEYS.map((k) => draft[k]),
    enabled: !!selectedPersonaId && !pendingPersonaId && !suppressModelSave,
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
