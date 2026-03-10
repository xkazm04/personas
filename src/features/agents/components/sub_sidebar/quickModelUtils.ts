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
