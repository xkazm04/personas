import { describe, expect, it } from 'vitest';

import { briefExcerpt, headAndRest, perimeterDash } from '../cardsModel';

describe('briefExcerpt', () => {
  it('strips markdown and collapses whitespace', () => {
    expect(briefExcerpt('# Goal\n\n**Ship** the  _thing_\n- one')).toBe('Goal Ship the thing one');
  });

  it('answers null for a body with no words', () => {
    expect(briefExcerpt('')).toBeNull();
    expect(briefExcerpt('  \n\n ')).toBeNull();
  });

  it('keeps a short body whole', () => {
    expect(briefExcerpt('short brief', 140)).toBe('short brief');
  });

  it('cuts a long body on a word boundary with an ellipsis', () => {
    const body = 'alpha beta gamma delta epsilon zeta eta theta';
    const out = briefExcerpt(body, 20)!;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out).toBe('alpha beta gamma…');
  });

  it('hard-cuts a single unbroken word', () => {
    expect(briefExcerpt('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`);
  });
});

describe('headAndRest', () => {
  it('splits at the limit and counts the rest', () => {
    expect(headAndRest([1, 2, 3, 4, 5, 6], 4)).toEqual({ head: [1, 2, 3, 4], rest: 2 });
  });

  it('reports no rest when everything fits', () => {
    expect(headAndRest([1, 2], 4)).toEqual({ head: [1, 2], rest: 0 });
  });
});

describe('perimeterDash', () => {
  it('has no fill for an unmeasured milestone', () => {
    expect(perimeterDash(null)).toBeNull();
  });

  it('is the percent of a 100-unit perimeter', () => {
    expect(perimeterDash(0)).toBe('0 100');
    expect(perimeterDash(42)).toBe('42 100');
    expect(perimeterDash(100)).toBe('100 100');
  });

  it('clamps out-of-range input', () => {
    expect(perimeterDash(-5)).toBe('0 100');
    expect(perimeterDash(140)).toBe('100 100');
  });
});
