import { describe, expect, it } from 'vitest';
import type { Persona } from '@/lib/bindings/Persona';
import { rosterCount } from '../rosterCount';

const p = (id: string, lifecycle = 'active') => ({ id, lifecycle }) as unknown as Persona;

// Round 2 card 6: the header compared the listed rows with ALL personas,
// archived included, so 2 archived of 12 read "10 of 12" with no filter on.
describe('rosterCount', () => {
  const twelve = [...Array.from({ length: 10 }, (_, i) => p(`a${i}`)), p('x1', 'archived'), p('x2', 'archived')];

  it('says "N personas" for an unfiltered default view with archived personas present', () => {
    expect(rosterCount(twelve, 10, false)).toEqual({ kind: 'all', count: 10 });
  });

  it('counts the archived population in the archived view', () => {
    expect(rosterCount(twelve, 2, true)).toEqual({ kind: 'all', count: 2 });
  });

  it('uses the filtered form only when a filter narrows the population', () => {
    expect(rosterCount(twelve, 3, false)).toEqual({ kind: 'filtered', shown: 3, total: 10 });
  });

  it('no archived personas: unchanged behaviour', () => {
    const plain = [p('a'), p('b')];
    expect(rosterCount(plain, 2, false)).toEqual({ kind: 'all', count: 2 });
  });
});
