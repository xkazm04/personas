import { describe, it, expect } from 'vitest';
import { ANTHROPIC_TIERS } from '../compareHelpers';
import {
  OLLAMA_CLOUD_BASE_URL,
  OLLAMA_CLOUD_PRESETS,
  profileToDropdownValue,
  getOllamaPreset,
  UNSET_MODEL_VALUE,
} from '../OllamaCloudPresets';

describe('ANTHROPIC_TIERS', () => {
  it('has unique dropdown values, each priced per million tokens with output dearer than input', () => {
    const values = ANTHROPIC_TIERS.map((tier) => tier.value);
    expect(new Set(values).size).toBe(values.length);
    for (const tier of ANTHROPIC_TIERS) {
      expect(tier.inputPerMTok).toBeGreaterThan(0);
      expect(tier.outputPerMTok).toBeGreaterThan(tier.inputPerMTok);
    }
  });
});

describe('OllamaCloudPresets', () => {
  it('round-trips every preset through the dropdown value', () => {
    for (const preset of OLLAMA_CLOUD_PRESETS) {
      expect(getOllamaPreset(preset.value)).toEqual(preset);
      expect(
        profileToDropdownValue({
          provider: 'ollama',
          model: preset.modelId,
          base_url: OLLAMA_CLOUD_BASE_URL,
        }),
      ).toBe(preset.value);
    }
  });

  it('maps the Anthropic tiers and falls back to custom', () => {
    expect(profileToDropdownValue({ provider: 'anthropic', model: 'haiku' })).toBe('haiku');
    expect(profileToDropdownValue({ provider: 'anthropic', model: 'sonnet' })).toBe('sonnet');
    expect(profileToDropdownValue({ provider: 'anthropic', model: 'opus' })).toBe('opus');
    expect(profileToDropdownValue({ provider: 'litellm', model: 'gpt-4o' })).toBe('custom');
    // A self-hosted Ollama endpoint is NOT one of the cloud presets.
    expect(
      profileToDropdownValue({ provider: 'ollama', model: 'llama3.1:8b', base_url: 'http://localhost:11434' }),
    ).toBe('custom');
  });

  // This returned 'opus' for a persona with no model profile until
  // 2026-08-28, painting the priciest tier as an explicit choice the user
  // never made.
  it('reports a persona with no model as unset, not as a choice of the priciest tier', () => {
    expect(profileToDropdownValue({})).toBe(UNSET_MODEL_VALUE);
    expect(profileToDropdownValue({ provider: 'anthropic' })).toBe(UNSET_MODEL_VALUE);
    expect(UNSET_MODEL_VALUE).toBe('');
    // No tier can match the unset value — nothing paints as selected.
    expect(ANTHROPIC_TIERS.some((tier) => tier.value === UNSET_MODEL_VALUE)).toBe(false);
    // An explicit Opus choice is still Opus, and is distinguishable from it.
    expect(profileToDropdownValue({ provider: 'anthropic', model: 'opus' })).not.toBe(
      UNSET_MODEL_VALUE,
    );
  });
});
