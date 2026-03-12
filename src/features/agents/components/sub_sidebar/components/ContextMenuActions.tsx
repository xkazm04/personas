import { useCallback, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import type { DbPersona } from '@/lib/types/types';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { profileToDropdownValue, OLLAMA_CLOUD_PRESETS, OLLAMA_CLOUD_BASE_URL } from '@/features/agents/sub_model_config/OllamaCloudPresets';

// ── Quick-switch model definitions ────────────────────────────────────

export interface QuickModel {
  value: string;
  label: string;
  provider: string;
}

export const QUICK_MODELS: QuickModel[] = [
  { value: 'opus', label: 'Opus', provider: 'Anthropic' },
  { value: 'sonnet', label: 'Sonnet', provider: 'Anthropic' },
  { value: 'haiku', label: 'Haiku', provider: 'Anthropic' },
  ...OLLAMA_CLOUD_PRESETS.map((p) => ({
    value: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'Ollama',
  })),
];

/** Build model_profile JSON string from a quick model value. */
export function quickModelToProfile(value: string): string | null {
  // Ollama cloud preset
  if (value.startsWith('ollama:')) {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.value === value);
    if (preset) {
      return JSON.stringify({
        model: preset.modelId,
        provider: 'ollama',
        base_url: OLLAMA_CLOUD_BASE_URL,
      } satisfies ModelProfile);
    }
  }
  // Standard Anthropic model (opus, sonnet, haiku)
  return JSON.stringify({
    model: value,
    provider: 'anthropic',
  } satisfies ModelProfile);
}

/** Read the current dropdown value from a persona's model_profile JSON. */
export function currentModelValue(persona: DbPersona): string {
  if (!persona.model_profile) return 'opus';
  try {
    const mp: ModelProfile = JSON.parse(persona.model_profile);
    return profileToDropdownValue(mp);
  } catch {
    return '';
  }
}

/** Hook providing all context menu action handlers. */
export function useContextMenuActions(personaId: string, enabled: boolean, onClose: () => void) {
  const applyPersonaOp = usePersonaStore((s) => s.applyPersonaOp);
  const duplicatePersona = usePersonaStore((s) => s.duplicatePersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const deletePersona = usePersonaStore((s) => s.deletePersona);
  const addToast = useToastStore((s) => s.addToast);

  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleModelSwitch = useCallback(async (value: string) => {
    const profile = quickModelToProfile(value);
    try {
      await applyPersonaOp(personaId, { kind: 'SwitchModel', model_profile: profile });
    } catch {
      addToast('Failed to switch model', 'error');
    }
    onClose();
  }, [personaId, applyPersonaOp, onClose, addToast]);

  const handleToggleEnabled = useCallback(async () => {
    try {
      await applyPersonaOp(personaId, { kind: 'ToggleEnabled', enabled: !enabled });
    } catch {
      addToast('Failed to toggle agent', 'error');
    }
    onClose();
  }, [personaId, enabled, applyPersonaOp, onClose]);

  const handleDuplicate = useCallback(async () => {
    try {
      const newPersona = await duplicatePersona(personaId);
      addToast(`Duplicated as "${newPersona.name}"`, 'success');
      selectPersona(newPersona.id);
    } catch {
      addToast('Failed to duplicate agent', 'error');
    }
    onClose();
  }, [personaId, duplicatePersona, selectPersona, addToast, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deletePersona(personaId);
    onClose();
  }, [confirmDelete, personaId, deletePersona, onClose]);

  const createExposedResource = usePersonaStore((s) => s.createExposedResource);
  const fetchExposedResources = usePersonaStore((s) => s.fetchExposedResources);
  const exportBundle = usePersonaStore((s) => s.exportBundle);

  const handleExportPersona = useCallback(async () => {
    try {
      const savePath = await save({
        defaultPath: `${personaId}.persona`,
        filters: [{ name: 'Persona Bundle', extensions: ['persona'] }],
      });
      if (!savePath) { onClose(); return; }

      // Ensure persona is exposed, then find its exposure ID
      let exposureId: string;
      try {
        const resource = await createExposedResource({
          resource_type: 'persona',
          resource_id: personaId,
          display_name: personaId,
          fields_exposed: [],
          access_level: 'read',
          requires_auth: false,
          tags: [],
        });
        exposureId = resource.id;
      } catch {
        // Already exposed — find existing
        await fetchExposedResources();
        const existing = usePersonaStore.getState().exposedResources
          .find((r) => r.resource_type === 'persona' && r.resource_id === personaId);
        if (!existing) throw new Error('Could not find or create exposure');
        exposureId = existing.id;
      }

      await exportBundle([exposureId], savePath);
      addToast('Persona exported as .persona bundle', 'success');
    } catch {
      addToast('Failed to export persona', 'error');
    }
    onClose();
  }, [personaId, createExposedResource, fetchExposedResources, exportBundle, addToast, onClose]);

  return { confirmDelete, setConfirmDelete, handleModelSwitch, handleToggleEnabled, handleDuplicate, handleDelete, handleExportPersona };
}
