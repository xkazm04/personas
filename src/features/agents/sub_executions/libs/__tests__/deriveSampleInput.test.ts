import { describe, it, expect } from 'vitest';
import { deriveSampleInput } from '../useExecutionList';
import type { DesignUseCase } from '@/lib/types/frontendTypes';

// Test fixture: deriveSampleInput reads only enabled, execution_mode, sample_input and input_schema.
const uc = (over: Partial<DesignUseCase>) => ({ id: 'u', title: 'u', description: '', ...over }) as DesignUseCase;

describe('deriveSampleInput', () => {
  it('is {} when no use case declares an input', () => {
    expect(deriveSampleInput([])).toBe('{}');
    expect(deriveSampleInput([uc({})])).toBe('{}');
  });

  it("uses the first runnable use case's declared sample_input", () => {
    const out = deriveSampleInput([
      uc({ id: 'off', enabled: false, sample_input: { q: 'skipped' } }),
      uc({ id: 'doc', execution_mode: 'non_executable', sample_input: { q: 'skipped too' } }),
      uc({ id: 'ok', sample_input: { q: 'hello' } }),
    ]);
    expect(JSON.parse(out)).toEqual({ q: 'hello' });
  });

  it('falls back to the schema defaults', () => {
    const out = deriveSampleInput([
      uc({
        input_schema: [
          { key: 'city', type: 'text', label: 'City', default: 'Prague' },
          { key: 'days', type: 'number', label: 'Days', default: 3 },
          { key: 'nodefault', type: 'text', label: 'X' },
        ],
      }),
    ]);
    expect(JSON.parse(out)).toEqual({ city: 'Prague', days: 3 });
  });
});
