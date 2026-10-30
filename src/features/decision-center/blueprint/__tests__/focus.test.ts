// @vitest-environment node
/**
 * The shared focus, follower side (spark roadmap S6):
 *  - the port of bp's session/focus.ts keeps bp's follow rules: a follower never applies its own write, a rev it has
 *    applied or a reader it does not follow; `sameSpot` compares the level and the hash's place too (bp 0a9cbef);
 *    `readFocusPlace` refuses what bp refuses. Until bp's shared-focus golden lands (S2) these cases are the hold;
 *  - every row of the place table lands on the right node of the Kettle plan, and an id the plan does not draw holds
 *    still (bp docs/concepts/one-morning-brief/personas.md section 3.2).
 */
import { describe, expect, it } from 'vitest';
import focusSource from '../model/focus.ts?raw';
import { followingWords, levelOf, readFocusPlace, sameSpot, toApply, type SharedView } from '../model/focus';
import { placeMove } from '../model/focusPlace';
import { buildPlan } from '../model/plan';
import { kettleData } from '../fixture/kettle';

const view = (rev: number, reader: string, place = { product: 'kettle' }): SharedView => ({
  rev, shared: { place, reader, surface: 'web', label: 'Web', at: '2026-10-30T10:00:00.000Z' }, readers: [],
});

describe('the focus port', () => {
  it('names the bp commit and file hash it was ported from', () => {
    expect(focusSource).toMatch(/^\/\/ PORTED from bp packages\/core\/src\/session\/focus\.ts @ 51e193e sha256:[0-9a-f]{64}$/m);
  });

  it('applies a newer place from whoever it follows, never its own write or an applied rev', () => {
    expect(toApply(view(3, 'web:1'), 'personas:main', '*', 2)).toEqual({ product: 'kettle' });
    expect(toApply(view(3, 'web:1'), 'personas:main', '*', 3)).toBeNull();
    expect(toApply(view(3, 'personas:main'), 'personas:main', '*', 0)).toBeNull();
    expect(toApply(view(3, 'web:1'), 'personas:main', 'vr:table', 0)).toBeNull();
    expect(toApply(view(3, 'web:1'), 'personas:main', undefined, 0)).toBeNull();
  });

  it('sameSpot compares the level and the hash place where both say them (bp 0a9cbef)', () => {
    const a = { product: 'kettle', target: { kind: 'room' as const, id: 'booking' } };
    expect(sameSpot(a, { ...a, say: 'other words' })).toBe(true);
    expect(sameSpot({ ...a, level: 'L2' }, { ...a, level: 'L3' })).toBe(false);
    expect(sameSpot({ ...a, hash: '#at=bay-1' }, { ...a, hash: '#at=bay-2' })).toBe(false);
    expect(sameSpot({ ...a, hash: '#at=bay-1' }, a)).toBe(true);
  });

  it('reads a place the way bp does, and refuses what bp refuses', () => {
    expect(readFocusPlace({ product: 'kettle', target: { kind: 'feature', id: 'book-a-class' }, hash: '#lens=perf', junk: 1 }))
      .toEqual({ product: 'kettle', target: { kind: 'feature', id: 'book-a-class' }, hash: '#lens=perf' });
    expect(typeof readFocusPlace({ product: 'Kettle' })).toBe('string');
    expect(typeof readFocusPlace({ product: 'kettle', target: { kind: 'bay', id: 'x' } })).toBe('string');
    expect(typeof readFocusPlace({ product: 'kettle', level: 'L5' })).toBe('string');
    expect(levelOf({ product: 'kettle', target: { kind: 'room', id: 'x' } })).toBe('L2');
    expect(followingWords(view(3, 'web:1'), '*', Date.parse('2026-10-30T10:00:12.000Z'))).toBe('Following Web, 12 s ago');
  });
});

describe('a bp place on the Kettle plan', () => {
  const data = kettleData();
  const plan = buildPlan(data.structure, data.events);
  const L = plan.L;
  const bay = L.bays[0]!, wing = L.wings[0]!, tile = L.tiles[0]!, room = L.rooms[0]!;
  const at = (kind: 'site' | 'wing' | 'room' | 'feature', id: string, hash?: string) =>
    placeMove({ product: 'kettle', target: { kind, id }, ...(hash ? { hash } : {}) }, plan);

  it('site, or no target: the whole site', () => {
    expect(placeMove({ product: 'kettle' }, plan)).toEqual({ kind: 'site' });
    expect(at('site', 'x')).toEqual({ kind: 'site' });
  });

  it('a wing `0:<domainId>` is the wing; a bare domain id is the wing its room sits in', () => {
    expect(wing.id).toMatch(/^0:/);
    expect(at('wing', wing.id)).toEqual({ kind: 'wing', id: wing.id });
    expect(at('wing', room.id)).toEqual({ kind: 'wing', id: room.wing.id });
  });

  it('a room is a capability since bp 57ee810: a Personas bay; a bp bay `<cap>.<kind>` lands on its capability', () => {
    expect(at('room', bay.id)).toEqual({ kind: 'bay', id: bay.id });
    expect(at('room', bay.id + '.screens')).toEqual({ kind: 'bay', id: bay.id });
    expect(at('room', room.id)).toEqual({ kind: 'wing', id: room.wing.id });
  });

  it('a feature opens its sheet, on the lens the hash names when the plan knows it', () => {
    expect(at('feature', tile.id)).toEqual({ kind: 'feature', fid: tile.id });
    expect(at('feature', tile.id, '#at=x&lens=performance')).toEqual({ kind: 'feature', fid: tile.id, lens: 'performance' });
    expect(at('feature', tile.id, '#lens=no-such-lens')).toEqual({ kind: 'feature', fid: tile.id });
  });

  it('an id the plan does not draw holds still and says what it was', () => {
    expect(at('feature', 'ghost')).toEqual({ kind: 'missing', what: 'feature', id: 'ghost' });
    expect(at('room', 'ghost.core')).toEqual({ kind: 'missing', what: 'room', id: 'ghost.core' });
    expect(at('wing', '1:ghost')).toEqual({ kind: 'missing', what: 'wing', id: '1:ghost' });
  });
});
