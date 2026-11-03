// @vitest-environment node
/**
 * The shared focus's port (model/focus.ts), held by bp's own golden: every input of bp's
 * packages/schema/golden/shared-focus.json, run through the port, must give bp's answer (readFocusPlace, sameSpot,
 * levelOf, a morning of focusStep moves with the view after each, toApply, followingWords), and the whole document must
 * come out byte for byte as bp's scripts/focus-golden.ts writes it. When bp changes focus.ts, the golden changes in the
 * same commit (bp's check:shared-focus refuses otherwise); re-copy the golden, update GOLDEN_PIN, re-port, and this stays
 * red until the port follows. The pins are what bp's scripts/personas-drift.mjs reads.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import goldenRaw from '../standard/shared-focus.golden.json?raw';
import focusSource from '../model/focus.ts?raw';
import {
  EMPTY_RECORD, focusStep, followingWords, levelOf, readFocusPlace, sameSpot, toApply, viewOf,
  type FocusMove, type FocusPlace, type SharedView,
} from '../model/focus';

/** bp's golden as copied: its path in bp, the bp commit it was copied at, and the sha256 of its LF bytes. */
const GOLDEN_PIN = {
  path: 'packages/schema/golden/shared-focus.json',
  commit: 'c16732c',
  sha256: '88041abd77f5d3ca91ea3a5ff50a083cb600a698bbf271ed82329c7b1fc3f489',
} as const;
const PORT_PIN = /^\/\/ PORTED from bp packages\/core\/src\/session\/focus\.ts @ ([0-9a-f]{7,40}) sha256:([0-9a-f]{64})$/m;

interface Golden {
  note: string;
  readFocusPlace: { name: string; body: unknown; answer: FocusPlace | string }[];
  sameSpot: { name: string; a: FocusPlace | null; b: FocusPlace | null; same: boolean }[];
  levelOf: { place: FocusPlace; level: string }[];
  focusStep: { name: string; at: string; move: FocusMove; status: number; error?: string; moved: boolean; view: SharedView }[];
  toApply: { name: string; view: SharedView; me: string; follows: string | null; appliedRev: number; place: FocusPlace | null }[];
  followingWords: { name: string; view: SharedView; follows: string | null; now: string; words: string | null }[];
}

const lf = (t: string) => t.replace(/\r\n/g, '\n');
// Invariant that makes this cast safe: the file is bp's golden copied byte for byte (the sha256 test below holds it), and
// bp writes it from typed values (scripts/focus-golden.ts).
const golden = JSON.parse(lf(goldenRaw)) as Golden;
const opt = <T,>(v: T | null): T | undefined => (v === null ? undefined : v);

/** The golden document as the port computes it, built the way bp's scripts/focus-golden.ts builds it from the same inputs. */
function portGolden(): string {
  const read = golden.readFocusPlace.map(({ name, body }) => ({ name, body, answer: readFocusPlace(body) }));
  const same = golden.sameSpot.map(({ name, a, b }) => ({ name, a, b, same: sameSpot(opt(a), opt(b)) }));
  const levels = golden.levelOf.map(({ place }) => ({ place, level: levelOf(place) }));
  let r = EMPTY_RECORD;
  const steps = golden.focusStep.map(({ name, at, move }) => {
    const now = Date.parse(at), s = focusStep(r, move, now);
    r = s.record;
    return { name, at, move, status: s.status, ...(s.error ? { error: s.error } : {}), moved: s.moved, view: viewOf(r, now) };
  });
  const apply = golden.toApply.map(({ name, view, me, follows, appliedRev }) => ({ name, view, me, follows, appliedRev, place: toApply(view, me, opt(follows), appliedRev) }));
  const words = golden.followingWords.map(({ name, view, follows, now }) => ({ name, view, follows, now, words: followingWords(view, opt(follows), Date.parse(now)) }));
  return JSON.stringify({ note: golden.note, readFocusPlace: read, sameSpot: same, levelOf: levels, focusStep: steps, toApply: apply, followingWords: words }, null, 2) + '\n';
}

describe('the shared focus port, held by bp golden', () => {
  it('is the golden bp pinned (sha256 of the copied file)', () => {
    expect(createHash('sha256').update(lf(goldenRaw)).digest('hex')).toBe(GOLDEN_PIN.sha256);
  });

  it('names the bp commit and the file hash it was ported from, at the golden commit', () => {
    const m = PORT_PIN.exec(focusSource);
    expect(m?.[1]).toBe(GOLDEN_PIN.commit);
    expect(m?.[2]).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(golden.readFocusPlace.map((c) => [c.name, c] as const))('readFocusPlace: %s', (_n, c) => {
    expect(readFocusPlace(c.body)).toEqual(c.answer);
  });

  it.each(golden.sameSpot.map((c) => [c.name, c] as const))('sameSpot: %s', (_n, c) => {
    expect(sameSpot(opt(c.a), opt(c.b))).toBe(c.same);
  });

  it('runs the morning of moves to the same view after every step', () => {
    let r = EMPTY_RECORD;
    for (const c of golden.focusStep) {
      const now = Date.parse(c.at), s = focusStep(r, c.move, now);
      r = s.record;
      expect({ name: c.name, status: s.status, moved: s.moved, view: viewOf(r, now) }).toEqual({ name: c.name, status: c.status, moved: c.moved, view: c.view });
    }
  });

  it.each(golden.toApply.map((c) => [c.name, c] as const))('toApply: %s', (_n, c) => {
    expect(toApply(c.view, c.me, opt(c.follows), c.appliedRev)).toEqual(c.place);
  });

  it.each(golden.followingWords.map((c) => [c.name, c] as const))('followingWords: %s', (_n, c) => {
    expect(followingWords(c.view, opt(c.follows), Date.parse(c.now))).toBe(c.words);
  });

  it('reproduces the whole golden byte for byte', () => {
    expect(portGolden()).toBe(lf(goldenRaw));
  });
});
