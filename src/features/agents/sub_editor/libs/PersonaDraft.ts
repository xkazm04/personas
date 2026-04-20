import type { ModelProfile, ModelProvider, PromptCachePolicy } from '@/lib/types/frontendTypes';
import { profileToDropdownValue } from '@/features/agents/sub_model_config/OllamaCloudPresets';

/**
 * Default execution timeout for a new persona, in milliseconds.
 * 3 minutes — chosen to catch hung model calls / runaway tool loops early
 * without killing legitimate long-running reasoning. The previous default of
 * 1_000_000 ms (~16.6 min) was effectively "no timeout" and was a top source
 * of unexpected cloud bills.
 */
export const DEFAULT_PERSONA_TIMEOUT_MS = 180_000;
/** Lower UI bound — anything faster is almost certainly a misconfiguration. */
export const MIN_PERSONA_TIMEOUT_MS = 10_000;
/** Upper UI bound matching the engine hard ceiling (30 min). */
export const MAX_PERSONA_TIMEOUT_MS = 1_800_000;

// -- Draft type for all editable persona fields --

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
  promptCachePolicy: PromptCachePolicy;
}

// -- Key groups for dirty detection --

/** Fields that belong to the Settings tab (name, appearance, limits). */
export const SETTINGS_KEYS = [
  'name', 'description', 'icon', 'color', 'maxConcurrent', 'timeout', 'enabled', 'sensitive',
] as const satisfies readonly (keyof PersonaDraft)[];

/** Fields that belong to the Model / Provider tab. */
export const MODEL_KEYS = [
  'selectedModel', 'selectedProvider', 'baseUrl', 'authToken', 'customModelName',
  'maxBudget', 'maxTurns', 'promptCachePolicy',
] as const satisfies readonly (keyof PersonaDraft)[];

// -- Compile-time exhaustiveness check --
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
  let promptCachePolicy: PromptCachePolicy = 'none';
  try {
    const mp: ModelProfile = persona.model_profile ? JSON.parse(persona.model_profile) : {};
    selectedModel = profileToDropdownValue(mp);
    provider = (mp.provider as ModelProvider) || 'anthropic';
    baseUrl = mp.base_url || '';
    authToken = mp.auth_token || '';
    if (selectedModel === 'custom' && mp.model) {
      customModelName = mp.model;
    }
    if (mp.prompt_cache_policy === 'short' || mp.prompt_cache_policy === 'long') {
      promptCachePolicy = mp.prompt_cache_policy;
    }
  } catch (err) {
    // Silent fallback is dangerous here — it resets the dropdown to the
    // anthropic default and, without guards, the debounced auto-save would
    // then persist that reset over the real config. Callers should check
    // checkModelProfileIntegrity() before accepting a model-fields save.
    const rawLen = persona.model_profile ? persona.model_profile.length : 0;
    // eslint-disable-next-line no-console
    console.warn(
      '[PersonaDraft] model_profile JSON parse failed — fields reset; auto-save of model fields will be blocked until re-selected',
      { rawLength: rawLen, error: err instanceof Error ? err.message : String(err) },
    );
  }
  return {
    name: persona.name,
    description: persona.description || '',
    icon: persona.icon || '',
    color: persona.color || '#8b5cf6',
    maxConcurrent: persona.max_concurrent ?? 1,
    // 3 minutes. Previous default was ~16.6 min (1_000_000 ms), which was
    // effectively "no timeout" — hung model calls or runaway tool loops held
    // a concurrency slot for the full window and produced no visible
    // feedback. See DEFAULT_PERSONA_TIMEOUT_MS.
    timeout: persona.timeout_ms ?? DEFAULT_PERSONA_TIMEOUT_MS,
    enabled: persona.enabled,
    sensitive: persona.sensitive ?? false,
    selectedModel,
    selectedProvider: provider,
    baseUrl,
    authToken,
    customModelName,
    maxBudget: persona.max_budget_usd ?? '',
    maxTurns: persona.max_turns ?? '',
    promptCachePolicy,
  };
}

/**
 * Integrity check for a persisted `model_profile` JSON blob. Used by the
 * editor to:
 *   1. Display a partial-load warning when the stored config cannot be
 *      parsed (so the user knows why their dropdown "reset").
 *   2. Suppress auto-save of MODEL_KEYS until the user explicitly re-selects
 *      a model — preventing the reset state from silently clobbering the
 *      real config on disk.
 * Returns `{ ok: true }` for null / empty (treated as "no profile yet").
 */
export function checkModelProfileIntegrity(
  raw: string | null | undefined,
): { ok: true } | { ok: false; rawLength: number; message: string } {
  if (!raw) return { ok: true };
  try {
    JSON.parse(raw);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      rawLength: raw.length,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
