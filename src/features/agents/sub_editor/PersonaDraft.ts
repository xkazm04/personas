import type { ModelProfile, ModelProvider } from '@/lib/types/frontendTypes';
import { profileToDropdownValue } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';

// ── Draft type for all editable persona fields ─────────────────────────

export interface PersonaDraft {
  name: string;
  description: string;
  icon: string;
  color: string;
  maxConcurrent: number;
  timeout: number;
  enabled: boolean;
  selectedModel: string;
  selectedProvider: ModelProvider;
  baseUrl: string;
  authToken: string;
  customModelName: string;
  maxBudget: number | '';
  maxTurns: number | '';
}

export function buildDraft(persona: { name: string; description?: string | null; icon?: string | null; color?: string | null; max_concurrent?: number | null; timeout_ms?: number | null; enabled: boolean; model_profile?: string | null; max_budget_usd?: number | null; max_turns?: number | null }): PersonaDraft {
  let selectedModel = '';
  let provider: ModelProvider = 'anthropic';
  let baseUrl = '';
  let authToken = '';
  let customModelName = '';
  try {
    const mp: ModelProfile = persona.model_profile ? JSON.parse(persona.model_profile) : {};
    selectedModel = profileToDropdownValue(mp);
    provider = (mp.provider as ModelProvider) || 'anthropic';
    baseUrl = mp.base_url || '';
    authToken = mp.auth_token || '';
    if (selectedModel === 'custom' && mp.model) {
      customModelName = mp.model;
    }
  } catch {
    // ignore
  }
  return {
    name: persona.name,
    description: persona.description || '',
    icon: persona.icon || '',
    color: persona.color || '#8b5cf6',
    maxConcurrent: persona.max_concurrent || 1,
    timeout: persona.timeout_ms || 300000,
    enabled: persona.enabled,
    selectedModel,
    selectedProvider: provider,
    baseUrl,
    authToken,
    customModelName,
    maxBudget: persona.max_budget_usd ?? '',
    maxTurns: persona.max_turns ?? '',
  };
}
