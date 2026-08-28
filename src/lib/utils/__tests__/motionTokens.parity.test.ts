/**
 * The motion ladder is written down three times, and nothing compared them.
 *
 *   1. `src/styles/globals.css:396` — `--duration-instant|fast|normal|slow`,
 *      the values the browser actually animates with.
 *   2. `src/lib/utils/designTokens.ts` — `MOTION.duration`, described in its own
 *      comment as "the JS counterpart of the CSS custom properties", four
 *      numbers re-typed by hand.
 *   3. `src/lib/utils/animation/animationPresets.ts` — `MOTION_PRESETS`, the
 *      Framer twins, which USED to be four more numbers re-typed by hand in
 *      SECONDS and now read `MOTION.duration` through a `/1000` conversion.
 *
 * Three copies, three naming systems (instant/fast/normal/slow ·
 * snap/flow/ease · snappy/smooth/gentle), and no parity check: editing the CSS
 * token silently desynchronised the two JS copies, and the failure mode is not
 * a crash but a UI where a CSS transition and its Framer sibling animate the
 * same gesture at two different speeds. `animationPresets.ts` records that this
 * has already happened once, on the `EASE` rung.
 *
 * Copy 3 is now derived rather than re-typed, so the Framer assertion below can
 * only fail through copy 2 — but it is kept, not deleted: it is what would
 * catch a future hand-typed rung sneaking back in, and it is the only thing
 * asserting the seconds/milliseconds conversion is the ONLY difference.
 *
 * This test is the missing comparison. It also caught the drift that was live
 * when it was written: `globals.css` wrote `var(--duration-normal, 200ms)`
 * twice, a fallback disagreeing with the 250ms the token declares.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MOTION } from '../designTokens';
import {
  MOTION_PRESETS,
  MOTION_TIMING,
  MOTION_SPRING,
  CSS_DURATION_CLASS,
} from '../animation/animationPresets';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

// Resolved from the vitest root rather than `import.meta.url`, which is not a
// file: URL under this repo's vite transform.
const globalsCss = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf-8');

/** `--duration-<rung>: <n>ms;` as declared in the stylesheet. */
const declared = new Map<string, number>();
for (const match of globalsCss.matchAll(/^\s*--duration-([a-z]+):\s*(\d+)ms;/gm)) {
  declared.set(match[1]!, Number(match[2]));
}

/** Which Framer preset is the twin of which CSS rung. */
const FRAMER_TWINS = [
  ['snappy', 'fast'],
  ['smooth', 'normal'],
  ['gentle', 'slow'],
] as const;

describe('motion token parity', () => {
  it('reads a four-rung ladder out of globals.css', () => {
    // Guards the guard: if the stylesheet is renamed or the declaration style
    // changes, this test would otherwise pass by comparing two empty sets.
    expect([...declared.keys()].sort()).toEqual(['fast', 'instant', 'normal', 'slow']);
  });

  it('keeps MOTION.duration equal to the CSS custom properties', () => {
    expect(MOTION.duration).toEqual(Object.fromEntries(declared));
  });

  it('keeps every Framer preset on its CSS rung, to the millisecond', () => {
    for (const [preset, rung] of FRAMER_TWINS) {
      expect(
        Math.round(MOTION_PRESETS[preset].framer.duration * 1000),
        `${preset} vs --duration-${rung}`,
      ).toBe(declared.get(rung));
    }
  });

  it('keeps MOTION_TIMING pointing at the presets rather than re-typing them', () => {
    expect(MOTION_TIMING.SNAP).toBe(MOTION_PRESETS.snappy.framer);
    expect(MOTION_TIMING.FLOW).toBe(MOTION_PRESETS.smooth.framer);
    expect(MOTION_TIMING.EASE).toBe(MOTION_PRESETS.gentle.framer);
  });

  it('names only duration classes that globals.css actually defines', () => {
    for (const [rung, classes] of Object.entries(CSS_DURATION_CLASS)) {
      const durationClass = classes.split(' ')[0]!;
      expect(globalsCss, `${rung} -> .${durationClass}`).toContain(`.${durationClass}`);
    }
  });

  it('never falls back to a number the token itself disagrees with', () => {
    // `var(--x, fallback)` reads as a safety net and behaves as a second
    // declaration: it is what renders anywhere the custom property is not in
    // scope, so a fallback that disagrees is a silent fork of the ladder.
    const mismatched: string[] = [];
    for (const match of globalsCss.matchAll(/var\(--duration-([a-z]+),\s*(\d+)ms\)/g)) {
      const rung = match[1]!;
      const fallback = Number(match[2]);
      if (declared.get(rung) !== fallback) {
        mismatched.push(`var(--duration-${rung}, ${fallback}ms) but the token is ${declared.get(rung)}ms`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});

/**
 * The spring ladder, which had the same problem as the timed one and none of
 * the same guards.
 *
 * `MOTION_SPRING` and `useMotion`'s `FULL_MOTION.spring` were byte-identical
 * declarations of `{ stiffness: 300, damping: 25 }` in two files that cannot
 * import each other (animationPresets imports useMotion), and the rAF engine
 * ran 50/15 under a comment claiming it matched "the previous framer-motion
 * config" — six times stiffer than what that comment pointed at. Three
 * declarations, one of them a duplicate and one of them a divergence with a
 * false justification, and nothing said which pairs were meant to agree.
 *
 * Both now read `MOTION.spring`, so the question "are these the same spring?"
 * has an answer in the source. These cases are what keeps it answered.
 */
describe('spring token parity', () => {
  it('gives the Framer spring preset and the useMotion spring one set of numbers', () => {
    const { result } = renderHook(() => useMotion());
    expect(result.current.spring).toEqual(MOTION_SPRING);
  });

  it('keeps the default spring on the snappy token', () => {
    expect(MOTION_SPRING).toEqual({ type: 'spring', ...MOTION.spring.snappy });
  });

  it('keeps the rAF engine on the soft readout spring, not a fourth set of numbers', () => {
    // The engine's constants are module-private by design, so this reads the
    // source: the assertion is that the numbers are DERIVED, which is the whole
    // property at issue — a re-typed `const STIFFNESS = 50` would satisfy any
    // value-level check while re-opening the drift.
    const engine = readFileSync(
      resolve(process.cwd(), 'src/lib/utils/rafAnimationEngine.ts'),
      'utf-8',
    );
    expect(engine.length, 'rafAnimationEngine.ts is empty or missing').toBeGreaterThan(200);
    expect(engine).toContain('MOTION.spring.soft');
    expect(engine, 'the spring constants are re-typed rather than derived')
      .not.toMatch(/const (STIFFNESS|DAMPING|MASS) = \d/);
  });

  it('keeps the two springs genuinely distinct, so naming them was worth it', () => {
    // If these ever converge, the two names are a lie and one of them should go.
    expect(MOTION.spring.soft.stiffness).toBeLessThan(MOTION.spring.snappy.stiffness);
    expect(MOTION.spring.soft.damping).toBeLessThan(MOTION.spring.snappy.damping);
  });
});
