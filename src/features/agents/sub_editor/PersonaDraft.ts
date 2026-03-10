import type { ModelProfile, ModelProvider } from '@/lib/types/frontendTypes';
import { profileToDropdownValue } from '@/features/agents/sub_model_config/OllamaCloudPresets';

// ── Draft type for all editable persona fields ─────────────────────────

export interface PersonaDraft {
  name: string;
  description: string;
  icon: string;
  color: string;
  maxConcurrent: number;
  timeout: number;
  enabled: boolean;
  sensitive: boolean;
  selectedModel: string;
  selectedProvider: ModelProvider;
  baseUrl: string;
  authToken: string;
  customModelName: string;
  maxBudget: number | '';
  maxTurns: number | '';
}

// ── Key groups for dirty detection ────────────────────────────────

/** Fields that belong to the Settings tab (name, appearance, limits). */
export const SETTINGS_KEYS = [
  'name', 'description', 'icon', 'color', 'maxConcurrent', 'timeout', 'enabled', 'sensitive',
] as const satisfies readonly (keyof PersonaDraft)[];

/** Fields that belong to the Model / Provider tab. */
export const MODEL_KEYS = [
  'selectedModel', 'selectedProvider', 'baseUrl', 'authToken', 'customModelName',
  'maxBudget', 'maxTurns',
] as const satisfies readonly (keyof PersonaDraft)[];

// ── Compile-time exhaustiveness check ────────────────────────────
// If a new field is added to PersonaDraft but not to SETTINGS_KEYS or
// MODEL_KEYS, this line will produce a TypeScript error.
type _CoveredKeys = (typeof SETTINGS_KEYS)[number] | (typeof MODEL_KEYS)[number];
type _AssertAllCovered = keyof PersonaDraft extends _CoveredKeys ? true : never;
type _AssertNoExtra = _CoveredKeys extends keyof PersonaDraft ? true : never;
const _exhaustiveCheck: _AssertAllCovered & _AssertNoExtra = true;
void _exhaustiveCheck;

/**
 * Returns true if any of the listed keys differ between draft and baseline.
 * Using key arrays means new PersonaDraft fields are only included in dirty
 * detection once explicitly added to SETTINGS_KEYS or MODEL_KEYS.
 */
export function draftChanged(
  draft: PersonaDraft,
  baseline: PersonaDraft,
  keys: readonly (keyof PersonaDraft)[],
): boolean {
  return keys.some((k) => draft[k] !== baseline[k]);
}

export function buildDraft(persona: { name: string; description?: string | null; icon?: string | null; color?: string | null; max_concurrent?: number | null; timeout_ms?: number | null; enabled: boolean; sensitive?: boolean; model_profile?: string | null; max_budget_usd?: number | null; max_turns?: number | null }): PersonaDraft {
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
    // intentional: non-critical — JSON parse fallback
  }
  return {
    name: persona.name,
    description: persona.description || '',
    icon: persona.icon || '',
    color: persona.color || '#8b5cf6',
    maxConcurrent: persona.max_concurrent ?? 1,
    timeout: persona.timeout_ms ?? 1000000,
    enabled: persona.enabled,
    sensitive: persona.sensitive ?? false,
    selectedModel,
    selectedProvider: provider,
    baseUrl,
    authToken,
    customModelName,
    maxBudget: persona.max_budget_usd ?? '',
    maxTurns: persona.max_turns ?? '',
  };
}
