import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_model_config/OllamaCloudPresets';
import type { ModelTestConfig } from '@/api/agents/tests';

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
}

export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet' },
  { id: 'opus', label: 'Opus', provider: 'anthropic', model: 'opus' },
];

export const OLLAMA_MODELS: ModelOption[] = OLLAMA_CLOUD_PRESETS.map((p) => ({
  id: p.value,
  label: p.label,
  provider: 'ollama',
  model: p.modelId,
  base_url: OLLAMA_CLOUD_BASE_URL,
}));

export const ALL_MODELS: ModelOption[] = [...ANTHROPIC_MODELS, ...OLLAMA_MODELS];

export function selectedModelsToConfigs(selectedModels: Set<string>): ModelTestConfig[] {
  return [...selectedModels]
    .map((id) => {
      const opt = ALL_MODELS.find((m) => m.id === id);
      if (!opt) return null;
      return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
    })
    .filter(Boolean) as ModelTestConfig[];
}
