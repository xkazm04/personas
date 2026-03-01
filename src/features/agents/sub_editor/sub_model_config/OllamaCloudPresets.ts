import type { ModelProfile } from '@/lib/types/frontendTypes';

// ── Ollama Cloud model presets ──────────────────────────────────────────

export const OLLAMA_CLOUD_BASE_URL = 'https://api.ollama.com';
export const OLLAMA_API_KEY_SETTING = 'ollama_api_key';

export interface OllamaCloudPreset {
  /** Value used in the <select> dropdown */
  value: string;
  /** User-facing label */
  label: string;
  /** Model ID sent to the Ollama API */
  modelId: string;
}

export const OLLAMA_CLOUD_PRESETS: OllamaCloudPreset[] = [
  { value: 'ollama:qwen3-coder', label: 'Qwen3 Coder (free, Ollama Cloud)', modelId: 'qwen3-coder-next' },
  { value: 'ollama:glm-5', label: 'GLM-5 (free, Ollama Cloud)', modelId: 'glm-5' },
  { value: 'ollama:kimi-k2.5', label: 'Kimi K2.5 (free, Ollama Cloud)', modelId: 'kimi-k2.5' },
];

/** Reverse-map a stored ModelProfile back to a dropdown value. */
export function profileToDropdownValue(mp: ModelProfile): string {
  // Check if it matches an Ollama Cloud preset
  if (mp.provider === 'ollama' && mp.base_url === OLLAMA_CLOUD_BASE_URL && mp.model) {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.modelId === mp.model);
    if (preset) return preset.value;
  }
  // Standard Anthropic models
  if (!mp.provider || mp.provider === 'anthropic') {
    if (mp.model === 'haiku') return 'haiku';
    if (mp.model === 'sonnet') return 'sonnet';
    if (mp.model === 'opus') return 'opus';
    if (!mp.model) return '';
  }
  return 'custom';
}

/** Check if a dropdown value is an Ollama Cloud preset. */
export function isOllamaCloudValue(value: string): boolean {
  return value.startsWith('ollama:');
}

/** Get the preset for a dropdown value, or undefined. */
export function getOllamaPreset(value: string): OllamaCloudPreset | undefined {
  return OLLAMA_CLOUD_PRESETS.find((p) => p.value === value);
}
