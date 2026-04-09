import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_model_config/OllamaCloudPresets';
import type { ModelTestConfig } from '@/api/agents/tests';
import { en, type Translations } from '@/i18n/en';

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
}

export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku' },    // i18n: models.haiku
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet' }, // i18n: models.sonnet
  { id: 'opus', label: 'Opus', provider: 'anthropic', model: 'opus' },       // i18n: models.opus
];

/** i18n key map for Anthropic model labels. Use with `t.models[key]` in components. */
export const MODEL_I18N_KEYS: Record<string, string> = {
  haiku: 'models.haiku',
  sonnet: 'models.sonnet',
  opus: 'models.opus',
};

/** Resolve Anthropic model options with translated labels. Defaults to English. */
export function getAnthropicModels(t: Translations = en): ModelOption[] {
  return ANTHROPIC_MODELS.map((m) => {
    const key = m.id as keyof Translations['models'];
    return {
      ...m,
      label: (t.models[key] as string) ?? m.label,
    };
  });
}

/** Resolve all model options with translated Anthropic labels. Defaults to English. */
export function getAllModels(t: Translations = en): ModelOption[] {
  return [...getAnthropicModels(t), ...OLLAMA_MODELS];
}

export const OLLAMA_CLOUD_MODELS: ModelOption[] = OLLAMA_CLOUD_PRESETS.map((p) => ({
  id: p.value,
  label: p.label,
  provider: 'ollama',
  model: p.modelId,
  base_url: OLLAMA_CLOUD_BASE_URL,
}));

/** Local Ollama models — run on the user's machine via native HTTP path. */
export const OLLAMA_LOCAL_MODELS: ModelOption[] = [
  { id: 'ollama:gemma4', label: 'Gemma 4 (local)', provider: 'ollama', model: 'gemma4', base_url: 'http://localhost:11434' },
  { id: 'ollama:qwen3.5', label: 'Qwen 3.5 (local)', provider: 'ollama', model: 'qwen3.5', base_url: 'http://localhost:11434' },
];

export const OLLAMA_MODELS: ModelOption[] = [...OLLAMA_LOCAL_MODELS, ...OLLAMA_CLOUD_MODELS];

export const ALL_MODELS: ModelOption[] = [...ANTHROPIC_MODELS, ...OLLAMA_MODELS];

/**
 * Claude reasoning effort levels.
 *
 * Personas pins the backend default to "medium" via `prompt::DEFAULT_EFFORT`
 * to avoid the CLI 2.1.94 silent default change for API-key/Bedrock/Vertex/
 * Foundry/Team/Enterprise users. Lab panels expose effort as a second
 * experimentation dimension alongside model selection.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const DEFAULT_EFFORT: EffortLevel = 'medium';

export interface EffortOption {
  id: EffortLevel;
  label: string;
}

export const EFFORT_OPTIONS: EffortOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

/**
 * Map a set of selected model ids to backend test configs (one config per
 * model, no effort variation). Existing call sites get pre-effort behavior.
 */
export function selectedModelsToConfigs(selectedModels: Set<string>): ModelTestConfig[] {
  return [...selectedModels]
    .map((id) => {
      const opt = ALL_MODELS.find((m) => m.id === id);
      if (!opt) return null;
      return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
    })
    .filter(Boolean) as ModelTestConfig[];
}

/**
 * Cartesian product of selected models × selected effort levels.
 *
 * Each (model, effort) pair becomes a single backend `ModelTestConfig`.
 * The lab uses this to vary effort across cells alongside model.
 *
 * - When `selectedEfforts` is empty, falls back to `[DEFAULT_EFFORT]`
 *   so the result is identical to `selectedModelsToConfigs`.
 * - When more than one effort is selected, the synthetic id becomes
 *   `${modelId}-${effort}` so result tables can group / label cells
 *   distinctly without colliding on bare model id.
 */
export function selectedModelsAndEffortsToConfigs(
  selectedModels: Set<string>,
  selectedEfforts: Set<EffortLevel>,
): ModelTestConfig[] {
  const efforts: EffortLevel[] =
    selectedEfforts.size === 0 ? [DEFAULT_EFFORT] : ([...selectedEfforts] as EffortLevel[]);
  const multipleEfforts = efforts.length > 1;

  const configs: ModelTestConfig[] = [];
  for (const modelId of selectedModels) {
    const opt = ALL_MODELS.find((m) => m.id === modelId);
    if (!opt) continue;
    for (const effort of efforts) {
      configs.push({
        id: multipleEfforts ? `${opt.id}-${effort}` : opt.id,
        provider: opt.provider,
        model: opt.model,
        base_url: opt.base_url,
        effort,
      });
    }
  }
  return configs;
}