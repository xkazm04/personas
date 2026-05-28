import { describe, it, expect } from 'vitest';
import { band, cap, computeVerdict, RANK } from '../../scripts/test/lib/eval/verdict.mjs';

describe('band', () => {
  it('health gate fails → BROKEN regardless of score', () => {
    expect(band(100, 100, true, false)).toBe('BROKEN');
  });
  it('PRODUCTION requires team>=80 AND minPersona>=60 AND autonomyOk', () => {
    expect(band(80, 60, true, true)).toBe('PRODUCTION');
    expect(band(79, 60, true, true)).toBe('PROMISING'); // team < 80
    expect(band(80, 59, true, true)).toBe('PROMISING'); // minPersona < 60
    expect(band(80, 60, false, true)).toBe('PROMISING'); // autonomy not ok
  });
  it('PROMISING band at team>=60', () => {
    expect(band(60, 0, true, true)).toBe('PROMISING');
    expect(band(59, 100, true, true)).toBe('NOT-READY');
  });
  it('duplicated NOT-READY floor preserved: 30 and 29 both NOT-READY', () => {
    expect(band(30, 0, true, true)).toBe('NOT-READY');
    expect(band(29, 0, true, true)).toBe('NOT-READY');
    expect(band(0, 0, true, true)).toBe('NOT-READY');
  });
});

describe('cap', () => {
  it('lowers only when the current verdict outranks max', () => {
    expect(cap('PRODUCTION', 'NOT-READY')).toBe('NOT-READY');
    expect(cap('PROMISING', 'PROMISING')).toBe('PROMISING');
  });
  it('never raises a verdict', () => {
    expect(cap('NOT-READY', 'PRODUCTION')).toBe('NOT-READY');
    expect(cap('BROKEN', 'PRODUCTION')).toBe('BROKEN');
  });
  it('RANK orders worst→best', () => {
    expect(RANK.BROKEN).toBeLessThan(RANK['NOT-READY']);
    expect(RANK['NOT-READY']).toBeLessThan(RANK.PROMISING);
    expect(RANK.PROMISING).toBeLessThan(RANK.PRODUCTION);
  });
});

describe('computeVerdict (the collapsed cap fold)', () => {
  it('worst-wins across multiple active caps', () => {
    const caps = [
      { when: true, to: 'PROMISING' },
      { when: true, to: 'NOT-READY' },
    ];
    expect(computeVerdict('PRODUCTION', caps)).toBe('NOT-READY');
  });
  it('is order-independent (cap is min-by-rank)', () => {
    const caps = [
      { when: true, to: 'PROMISING' },
      { when: true, to: 'NOT-READY' },
    ];
    expect(computeVerdict('PRODUCTION', caps)).toBe(computeVerdict('PRODUCTION', [...caps].reverse()));
  });
  it('ignores inactive caps', () => {
    expect(computeVerdict('PRODUCTION', [{ when: false, to: 'BROKEN' }])).toBe('PRODUCTION');
  });
  it('cert-3 shape: PROMISING base + cascade-stall cap → NOT-READY', () => {
    const base = band(63, 60, true, true); // PROMISING (team 63)
    expect(base).toBe('PROMISING');
    expect(computeVerdict(base, [{ when: true, to: 'NOT-READY' }])).toBe('NOT-READY');
  });
  it('cert-2 shape: PRODUCTION base + self-veto cap → PROMISING', () => {
    const base = band(100, 100, true, true); // PRODUCTION (team 100)
    expect(base).toBe('PRODUCTION');
    expect(computeVerdict(base, [{ when: true, to: 'PROMISING' }])).toBe('PROMISING');
  });
});
