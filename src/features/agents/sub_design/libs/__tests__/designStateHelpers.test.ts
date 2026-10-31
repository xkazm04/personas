import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PersonaWithDetails } from '@/lib/types/types';
import { useSavedDesignResult } from '../designStateHelpers';

// Cast: only `last_design_result` is read by the hook under test; the rest of
// the persona shape is irrelevant here.
function persona(result: string | null): PersonaWithDetails {
  return { last_design_result: result } as unknown as PersonaWithDetails;
}

function run(result: string | null) {
  return renderHook(() => useSavedDesignResult(persona(result))).result.current;
}

describe('useSavedDesignResult', () => {
  it('returns null when there is no saved result or it does not parse', () => {
    expect(run(null)).toBeNull();
    expect(run('{not json')).toBeNull();
  });

  it('stamps oauth_type google on Google connectors that lack one', () => {
    const out = run(
      JSON.stringify({
        suggested_connectors: [{ name: 'gmail' }, { name: 'google_calendar' }, { name: 'google_drive' }],
      }),
    );
    expect(out?.suggested_connectors?.map((c) => c.oauth_type)).toEqual(['google', 'google', 'google']);
  });

  it('keeps an explicit oauth_type on a Google connector', () => {
    const out = run(JSON.stringify({ suggested_connectors: [{ name: 'gmail', oauth_type: 'custom' }] }));
    expect(out?.suggested_connectors?.[0]?.oauth_type).toBe('custom');
  });

  it('leaves a non-Google connector untouched', () => {
    const out = run(JSON.stringify({ suggested_connectors: [{ name: 'slack' }] }));
    expect(out?.suggested_connectors?.[0]).toEqual({ name: 'slack' });
  });
});
