import { describe, it, expect } from 'vitest';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { rowAccentTone } from '../PersonaOverviewBadges';

const health = (status: string) => ({ status } as unknown as PersonaHealth);

describe('rowAccentTone', () => {
  it('maps health when the persona is neither building nor a draft', () => {
    expect(rowAccentTone(false, false, undefined)).toBe('healthy');
    expect(rowAccentTone(false, false, health('healthy'))).toBe('healthy');
    expect(rowAccentTone(false, false, health('degraded'))).toBe('degraded');
    expect(rowAccentTone(false, false, health('failing'))).toBe('failing');
  });

  it('lets building win over everything, then draft over health', () => {
    // The priority order is the rule the grid and the card had each written
    // by hand; this is the one place it is stated.
    expect(rowAccentTone(true, true, health('failing'))).toBe('building');
    expect(rowAccentTone(false, true, health('failing'))).toBe('draft');
    expect(rowAccentTone(false, true, health('degraded'))).toBe('draft');
  });
});
