/**
 * generateWhatChanged used to return nine English sentence templates from a .ts
 * module the JSX lint cannot see, so the "what changed" panel stayed English in
 * all 14 locales. It now returns typed tokens; the component localizes them.
 */
import { describe, it, expect } from 'vitest';
import { generateWhatChanged } from '../comparisonHelpers';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

function exec(over: Partial<PersonaExecution>): PersonaExecution {
  // Only the fields generateWhatChanged reads; the rest of the row is irrelevant here.
  return {
    input_tokens: 100, output_tokens: 100, cost_usd: 1, duration_ms: 1000,
    status: 'completed', retry_count: 0, tool_steps: null, model_used: 'm1',
    ...over,
  } as unknown as PersonaExecution;
}

describe('generateWhatChanged returns language-free tokens', () => {
  it('reports no differences as a single none token', () => {
    expect(generateWhatChanged(exec({}), exec({}))).toEqual([{ kind: 'none', retry: 0, vars: {} }]);
  });

  it('carries numbers and the retry index, never prose', () => {
    const items = generateWhatChanged(
      exec({}),
      exec({ input_tokens: 50, output_tokens: 50, retry_count: 2, duration_ms: 4000, status: 'failed' }),
    );
    expect(items.map((i) => i.kind)).toEqual(['tokens_fewer', 'slower', 'status']);
    expect(items[0]).toEqual({ kind: 'tokens_fewer', retry: 2, vars: { pct: '50' } });
    expect(items[1]!.vars).toEqual({ ratio: '4.0' });
    expect(items[2]!.vars).toEqual({ from: 'completed', to: 'failed' });
  });

  it('flags a model change', () => {
    const items = generateWhatChanged(exec({}), exec({ model_used: 'm2' }));
    expect(items).toEqual([{ kind: 'model', retry: 0, vars: { from: 'm1', to: 'm2' } }]);
  });
});
