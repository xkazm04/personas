import { describe, it, expect } from 'vitest';
import { colorWithAlpha } from '../colorWithAlpha';

describe('colorWithAlpha', () => {
  it('expands 3-digit hex', () => {
    expect(colorWithAlpha('#abc', 0.5)).toBe('rgba(170,187,204,0.5)');
  });

  it('reads 6- and 8-digit hex', () => {
    expect(colorWithAlpha('#aabbcc', 1)).toBe('rgba(170,187,204,1)');
    expect(colorWithAlpha('#aabbccdd', 0.25)).toBe('rgba(170,187,204,0.25)');
  });

  it('clamps opacity into 0–1', () => {
    expect(colorWithAlpha('#000000', -3)).toBe('rgba(0,0,0,0)');
    expect(colorWithAlpha('#000000', 7)).toBe('rgba(0,0,0,1)');
  });

  // Regression guard. `parseInt(s, 16)` stops at the first invalid character
  // rather than rejecting, so '#1z2z3z' parsed as rgb(1,2,3) — a near-black that
  // looks like a real colour. Colours come from stored data, so a corrupted
  // value has to fall back visibly, not mutate into a plausible one.
  it('rejects partially-hex input instead of parsing a prefix', () => {
    expect(colorWithAlpha('#1z2z3z', 0.5)).toBe('#1z2z3z');
    expect(colorWithAlpha('#gg0000', 0.5)).toBe('#gg0000');
    expect(colorWithAlpha('#12', 0.5)).toBe('#12');
    expect(colorWithAlpha('#12345', 0.5)).toBe('#12345');
    expect(colorWithAlpha('#1234567', 0.5)).toBe('#1234567');
    expect(colorWithAlpha('', 0.5)).toBe('');
    expect(colorWithAlpha('var(--accent)', 0.5)).toBe('var(--accent)');
  });

  // Regression guard. Math.max/Math.min propagate NaN, so a NaN opacity emitted
  // the literal string 'rgba(r,g,b,NaN)' — invalid CSS the browser drops silently.
  it('never emits a non-finite alpha channel', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const out = colorWithAlpha('#aabbcc', bad);
      expect(out).not.toContain('NaN');
      expect(out).not.toContain('Infinity');
      expect(out).toBe('rgba(170,187,204,1)');
    }
  });
});
