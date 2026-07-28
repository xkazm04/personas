import { describe, it, expect } from 'vitest';
import { formatTrustScore } from '../ArenaPanelColosseum';

describe('formatTrustScore — no fabricated 0 for a never-scored/no-selection persona', () => {
  it('regression: null renders as an em dash, not a worst-on-scale 0', () => {
    expect(formatTrustScore(null)).toBe('—');
  });

  it('a real score (including a genuine 0) renders as its own number', () => {
    expect(formatTrustScore(0)).toBe('0');
    expect(formatTrustScore(72)).toBe('72');
  });
});
