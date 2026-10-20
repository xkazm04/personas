import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCredentialImport } from '../useCredentialImport';

// Placeholder values only; nothing here is a real secret.
const ENV = ['OPENAI_API_KEY=placeholder-openai', 'GITHUB_TOKEN=placeholder-github'].join('\n');

function parsed() {
  const h = renderHook(() => useCredentialImport());
  act(() => h.result.current.selectSource('env_file'));
  act(() => h.result.current.setRawInput(ENV));
  act(() => h.result.current.parse());
  return h;
}

describe('credential import carries parsed values and every service group', () => {
  it('yields one batch per detected service, each with its values keyed by field', () => {
    const h = parsed();
    const batches = h.result.current.buildBatches();
    expect(batches).toHaveLength(2);
    const byField = Object.assign({}, ...batches.map((b) => b.values));
    expect(byField).toEqual({ OPENAI_API_KEY: 'placeholder-openai', GITHUB_TOKEN: 'placeholder-github' });
    for (const b of batches) {
      expect(b.result.connector.fields.map((f) => f.key).sort()).toEqual(Object.keys(b.values).sort());
    }
  });

  it('keeps the groups not yet loaded selected after one is taken', () => {
    const h = parsed();
    const [first, second] = h.result.current.buildBatches();
    act(() => h.result.current.deselectIds(first!.secretIds));
    const rest = h.result.current.buildBatches();
    expect(rest).toHaveLength(1);
    expect(rest[0]!.values).toEqual(second!.values);
  });

  it('never puts a value into the design result itself', () => {
    const h = parsed();
    const json = JSON.stringify(h.result.current.buildResults());
    expect(json).not.toContain('placeholder-');
  });
});
