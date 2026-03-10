import { Hash, Send, Mail } from 'lucide-react';
import type { ModelProfile, NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';
import type { ModelTestConfig } from '@/api/agents/tests';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_model_config/OllamaCloudPresets';

// ── Model helpers ───────────────────────────────────────────────────

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: '__default__', label: 'Default', provider: '' },
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet' },
  { id: 'opus', label: 'Opus', provider: 'anthropic' },
  ...OLLAMA_CLOUD_PRESETS.map((p) => ({
    id: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'ollama',
    model: p.modelId,
    base_url: OLLAMA_CLOUD_BASE_URL,
  })),
];

/** Override-only model options (no __default__ entry) -- used for grouped dropdown. */
export const OVERRIDE_OPTIONS = MODEL_OPTIONS.filter((o) => o.id !== '__default__');

function isMatchingProvider(option: ModelOption, profile: ModelProfile): boolean {
  return option.provider === profile.provider || (!profile.provider && option.provider === 'anthropic');
}

export function profileToOptionId(mp: ModelProfile | undefined): string {
  if (!mp) return '__default__';
  const match = MODEL_OPTIONS.find(
    (o) => o.id !== '__default__' && o.model === mp.model && isMatchingProvider(o, mp),
  );
  return match?.id ?? '__default__';
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
    return { id: preset?.value || mp.model || 'ollama', provider: 'ollama', model: mp.model, base_url: mp.base_url || OLLAMA_CLOUD_BASE_URL, auth_token: mp.auth_token };
  }
  return { id: mp.model || 'custom', provider: mp.provider, model: mp.model, base_url: mp.base_url, auth_token: mp.auth_token };
}

// ── Model resolution ────────────────────────────────────────────────

export type ModelSource = 'override' | 'persona' | 'default';

const DEFAULT_PROFILE: ModelProfile = { model: 'sonnet', provider: 'anthropic' };

export interface ResolvedModel {
  profile: ModelProfile;
  config: ModelTestConfig | null;
  label: string;
  source: ModelSource;
}

/**
 * Resolve the effective model for a use case by cascading:
 *   1. use_case.model_override
 *   2. persona.model_profile (JSON string)
 *   3. hardcoded sonnet/anthropic default
 */
export function resolveEffectiveModel(
  useCaseOverride: ModelProfile | undefined,
  personaModelProfile: string | null | undefined,
): ResolvedModel {
  if (useCaseOverride) {
    return {
      profile: useCaseOverride,
      config: profileToModelConfig(useCaseOverride),
      label: profileToLabel(useCaseOverride),
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
    } catch {
      // intentional: non-critical — JSON parse fallback
    }
  }
  return {
    profile: DEFAULT_PROFILE,
    config: profileToModelConfig(DEFAULT_PROFILE),
    label: profileToLabel(DEFAULT_PROFILE),
    source: 'default',
  };
}

// ── Channel helpers ─────────────────────────────────────────────────

export const CHANNEL_TYPES: { type: NotificationChannelType; label: string; Icon: typeof Hash }[] = [
  { type: 'slack', label: 'Slack', Icon: Hash },
  { type: 'telegram', label: 'Telegram', Icon: Send },
  { type: 'email', label: 'Email', Icon: Mail },
];

export function channelSummary(channels: NotificationChannel[]): string {
  const enabled = channels.filter((c) => c.enabled);
  if (enabled.length === 0) return 'None';
  return enabled.map((c) => c.type.charAt(0).toUpperCase() + c.type.slice(1)).join(', ');
}
