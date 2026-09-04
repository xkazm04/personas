import type { ModelProfile } from '@/lib/types/frontendTypes';
import type { ModelTestConfig } from '@/api/agents/tests';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_model_config/libs/OllamaCloudPresets';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Effective-model resolution for one capability (charter or legacy use case).
 *
 * Extracted verbatim from the retired
 * `agents/sub_use_cases/libs/useCaseDetailHelpers.ts` when `sub_use_cases` was
 * deleted (agent-manifest-rebase WP5). The channel helpers that lived beside it
 * (`CHANNEL_TYPES`, `channelSummary`) went with the dropdown that was their only
 * consumer; the model half survives because the Lab reads it.
 */

export interface CapabilityModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
}

export const MODEL_OPTIONS: CapabilityModelOption[] = [
  { id: '__default__', label: 'Default', provider: '' },
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet' },
  { id: 'opus', label: 'Opus', provider: 'anthropic', model: 'opus' },
  // Qwen remote engine (Phase 1 split engine) — text-only capabilities run on
  // Qwen Cloud via the HTTP engine instead of the local Claude CLI. base_url is
  // omitted so the engine uses the configured `qwen_base_url` setting / default.
  { id: 'qwen-coder', label: 'Qwen Coder', provider: 'qwen', model: 'qwen3-coder-plus' },
  { id: 'qwen-max', label: 'Qwen Max', provider: 'qwen', model: 'qwen3-max' },
  ...OLLAMA_CLOUD_PRESETS.map((p) => ({
    id: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'ollama',
    model: p.modelId,
    base_url: OLLAMA_CLOUD_BASE_URL,
  })),
];

function isMatchingProvider(option: CapabilityModelOption, profile: ModelProfile): boolean {
  return option.provider === profile.provider || (!profile.provider && option.provider === 'anthropic');
}

export function profileToLabel(mp: ModelProfile | undefined): string {
  if (!mp) return 'Default';
  const opt = MODEL_OPTIONS.find(
    (o) => o.id !== '__default__' && o.model === mp.model && isMatchingProvider(o, mp),
  );
  return opt?.label ?? mp.model ?? 'Custom';
}

export function profileToModelConfig(mp: ModelProfile): ModelTestConfig | null {
  if (!mp.model && !mp.provider) return null;
  if (!mp.provider || mp.provider === 'anthropic') {
    return { id: mp.model || 'sonnet', provider: 'anthropic', model: mp.model };
  }
  if (mp.provider === 'ollama') {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.modelId === mp.model);
    return {
      id: preset?.value || mp.model || 'ollama',
      provider: 'ollama',
      model: mp.model,
      base_url: mp.base_url || OLLAMA_CLOUD_BASE_URL,
      auth_token: mp.auth_token,
    };
  }
  return {
    id: mp.model || 'custom',
    provider: mp.provider,
    model: mp.model,
    base_url: mp.base_url,
    auth_token: mp.auth_token,
  };
}

export type ModelSource = 'override' | 'persona' | 'default';

const DEFAULT_PROFILE: ModelProfile = { model: 'sonnet', provider: 'anthropic' };

export interface ResolvedModel {
  profile: ModelProfile;
  config: ModelTestConfig | null;
  label: string;
  source: ModelSource;
}

/**
 * Resolve the effective model for a capability by cascading:
 *   1. the capability's own model override
 *   2. persona.model_profile (JSON string)
 *   3. hardcoded sonnet/anthropic default
 */
export function resolveEffectiveModel(
  capabilityOverride: ModelProfile | undefined,
  personaModelProfile: string | null | undefined,
): ResolvedModel {
  if (capabilityOverride) {
    return {
      profile: capabilityOverride,
      config: profileToModelConfig(capabilityOverride),
      label: profileToLabel(capabilityOverride),
      source: 'override',
    };
  }
  if (personaModelProfile) {
    try {
      const parsed = JSON.parse(personaModelProfile) as ModelProfile;
      return {
        profile: parsed,
        config: profileToModelConfig(parsed),
        label: profileToLabel(parsed),
        source: 'persona',
      };
    } catch (err) {
      silentCatch('lib/personas/modelResolution:parsePersonaProfile')(err);
    }
  }
  return {
    profile: DEFAULT_PROFILE,
    config: profileToModelConfig(DEFAULT_PROFILE),
    label: profileToLabel(DEFAULT_PROFILE),
    source: 'default',
  };
}
