// The strip's per-viewer layout preference, and its fallback: a stored value
// that is not one of the live variants (a retired prototype, a stray string)
// has to open on `classic`, never on a switch whose value is not one of its tabs.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_USAGE_VARIANT, USAGE_VARIANTS, USAGE_VARIANT_KEY, isUsageVariant, readUsageVariant, writeUsageVariant,
} from '../usageVariant';

beforeEach(() => { localStorage.clear(); });

describe('usage variant', () => {
  it('is classic plus the four prototypes, classic first and default', () => {
    expect([...USAGE_VARIANTS]).toEqual(['classic', 'lanes', 'horizon', 'cockpit', 'ledger']);
    expect(DEFAULT_USAGE_VARIANT).toBe('classic');
    expect(USAGE_VARIANT_KEY).toBe('monitor.usage.variant');
  });

  it('reads classic when nothing is stored', () => {
    expect(readUsageVariant()).toBe('classic');
  });

  it('falls back to classic for an unknown stored value', () => {
    localStorage.setItem(USAGE_VARIANT_KEY, 'dials');
    expect(readUsageVariant()).toBe('classic');
    expect(isUsageVariant('dials')).toBe(false);
    expect(isUsageVariant(3)).toBe(false);
  });

  it('round-trips every live value', () => {
    for (const v of USAGE_VARIANTS) {
      writeUsageVariant(v);
      expect(readUsageVariant()).toBe(v);
      expect(localStorage.getItem(USAGE_VARIANT_KEY)).toBe(v);
    }
  });
});
