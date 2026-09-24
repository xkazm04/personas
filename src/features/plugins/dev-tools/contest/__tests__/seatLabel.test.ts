import { describe, expect, it } from 'vitest';

import { modelDisplayName, seatLabel } from '../model/seatCatalog';

describe('seatLabel', () => {
  it('reads a full spec as model + effort + engine', () => {
    expect(seatLabel('claude:claude-opus-5-5@xhigh')).toEqual({ model: 'Opus 5.5', effort: 'xhigh', engine: 'claude', label: null });
    expect(seatLabel('codex:gpt-6-sol@high#second')).toEqual({ model: 'GPT-6 Sol', effort: 'high', engine: 'codex', label: 'second' });
  });

  it('names the catalog models', () => {
    expect(modelDisplayName('claude-fable-5-1')).toBe('Fable 5.1');
    expect(modelDisplayName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelDisplayName('gpt-6-sol')).toBe('GPT-6 Sol');
    expect(modelDisplayName('gpt-6-astra')).toBe('GPT-6 Astra');
    expect(modelDisplayName('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
    expect(modelDisplayName('grok-4.6')).toBe('Grok 4.6');
    expect(modelDisplayName('opus')).toBe('Opus');
  });

  it('a bare model id has no effort or engine', () => {
    expect(seatLabel('claude-fable-5-1')).toEqual({ model: 'Fable 5.1', effort: null, engine: null, label: null });
    expect(seatLabel('gpt-6-sol').model).toBe('GPT-6 Sol');
    expect(seatLabel('grok-4.6').model).toBe('Grok 4.6');
  });

  it('an unknown model falls back to the raw id, never mangled', () => {
    for (const raw of ['llama3-70b-instruct', 'mistral_large', 'gpt', 'foo-bar-2', 'x/y']) {
      expect(modelDisplayName(raw)).toBe(raw);
    }
    expect(seatLabel('not a spec').model).toBe('not a spec');
    expect(seatLabel('claude:llama3-70b@high').model).toBe('llama3-70b');
  });
});
