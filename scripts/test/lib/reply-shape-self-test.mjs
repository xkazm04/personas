/**
 * Unit-style self-check of the replyShape counters (WP4, spark
 * athena-layered-voice) — 5 fixture strings with hand-derived expected
 * counts, run with NO model spawn and NO validator binary. Two callers:
 *   - `node scripts/test/athena-model-bench.mjs --self-test` (the bench
 *     harness's acceptance-criterion flag)
 *   - `src/__tests__/companion/replyShape.test.ts` via a thin vitest wrapper,
 *     so the same fixtures run under `npm run test` too.
 * Each fixture is picked to isolate one rule of the contract: a plain
 * two-sentence reply, a well-formed ref link (handle excluded from the id
 * count), an id inside INLINE code (Director amendment, 2026-09-23: counted
 * — only a fenced code block or a ref-link handle is exempt), the same id
 * inside a FENCED code block (excluded), a bare prefixed id in plain prose
 * (counted), and a <=3-item list (counted as one sentence).
 */
import { replyShape } from './reply-shape.mjs';

export const FIXTURES = [
  {
    name: 'two-sentence plain reply',
    text: 'Good morning! Ready when you are.',
    expect: { sentences: 2, bareIds: 0, refLinkCount: 0 },
  },
  {
    name: 'well-formed ref link — handle excluded from bareId count',
    text: 'The pumper session shows [three commits landed](ref:session/sess_4b1d0a92) since this morning.',
    expect: { sentences: 1, bareIds: 0, refLinkCount: 1, refsMalformed: 0 },
  },
  {
    name: 'uuid in INLINE code — counted (Director amendment, 2026-09-23)',
    text: 'Run `id=550e8400-e29b-41d4-a716-446655440000` to check.',
    expect: { sentences: 1, bareIds: 1, bareIdsStrict: 0, refLinkCount: 0 },
  },
  {
    name: 'uuid in a FENCED code block — excluded',
    text: "Here's the id:\n```\n550e8400-e29b-41d4-a716-446655440000\n```\nAll set.",
    expect: { bareIds: 0, bareIdsStrict: 0, refLinkCount: 0 },
  },
  {
    name: 'bare prefixed id in plain prose — counted',
    text: 'The approval appr_9f2a1c7e is waiting.',
    expect: { sentences: 1, bareIds: 1, bareIdsStrict: 1, refLinkCount: 0 },
  },
  {
    name: '<=3-item list counts as one sentence',
    text: "Here's what changed:\n- Fixed the retry bug\n- Updated the docs\n- Shipped the patch",
    expect: { sentences: 2, bareIds: 0, refLinkCount: 0 },
  },
];

/** Runs all fixtures, prints PASS/FAIL per fixture and a summary line, and
 *  returns true iff every fixture matched every expected field. */
export function selfTest() {
  let bad = 0;
  for (const f of FIXTURES) {
    const shape = replyShape(f.text);
    const mismatches = Object.entries(f.expect).filter(([k, v]) => shape[k] !== v);
    if (mismatches.length) {
      bad++;
      console.error(`  ✗ ${f.name}: ${mismatches.map(([k, v]) => `${k} expected ${v} got ${shape[k]}`).join(', ')}`);
    } else {
      console.log(`  ✓ ${f.name} (sentences=${shape.sentences} bareIds=${shape.bareIds} refLinks=${shape.refLinkCount})`);
    }
  }
  console.log(`replyShape self-test: ${FIXTURES.length - bad}/${FIXTURES.length} fixtures OK`);
  return bad === 0;
}
