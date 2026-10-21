import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CLAIMS,
  READ_ONLY,
  checkClaims,
  countCodegenTasks,
  countTestCalls,
  judge,
} from '../../../scripts/docs/check-doc-counts.mjs';

/**
 * The numbers the docs quote ("130+ built-in connectors", "14 languages") are
 * facts an agent reads as truth. `scripts/docs/check-doc-counts.mjs` measures each
 * one against the tree; this test runs it over every file an agent may edit, so a
 * connector added or a locale dropped without the prose following fails `npm test`.
 * `.claude/CLAUDE.md` is read-only to agent lanes, so its quoted counts are reported
 * by the script for a human and are not gated here.
 */
const REPO = resolve(__dirname, '../../..');

type Result = { file: string; line: number; quoted: string; verdict: string; actual?: number };

describe('quoted counts in the docs', () => {
  it('judges a floor claim N+ true only while N <= actual < 2N', () => {
    expect(judge(130, true, 130)).toBe('ok');
    expect(judge(130, true, 259)).toBe('ok');
    expect(judge(130, true, 129)).toBe('overstated');
    expect(judge(130, true, 260)).toBe('understated');
  });

  it('judges an exact claim true only on equality', () => {
    expect(judge(14, false, 14)).toBe('ok');
    expect(judge(14, false, 17)).toBe('wrong');
  });

  it('counts the codegen TASKS map and test call sites from source text', () => {
    const runner = 'const TASKS = {\n  commands:  "scripts/a.mjs",\n  // note\n  "i18n-split": "scripts/b.mjs",\n};\nconst X = { y: "scripts/c.mjs" };\n';
    expect(countCodegenTasks(runner)).toBe(2);
    expect(countCodegenTasks('no map here')).toBe(0);
    const spec = 'describe("x", () => {\n  it("a", () => {});\n  it.each([1, 2])("b %i", () => {});\n  test.skip("c", () => {});\n  // it("commented out") is not counted\n});\n';
    expect(countTestCalls(spec)).toBe(3);
  });

  const editable = [...new Set(CLAIMS.map((c: { file: string }) => c.file))].filter((f) => !READ_ONLY.has(f));

  it('checks at least one editable file (a check over nothing is not a pass)', () => {
    expect(editable).toEqual(expect.arrayContaining(['README.md', 'CONTRIBUTING.md']));
  });

  it('every count quoted in an editable doc still matches the tree', () => {
    const results: Result[] = checkClaims({ root: REPO, files: editable });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.filter((r) => r.verdict !== 'ok').map((r) => `${r.file}:${r.line} "${r.quoted}" -> ${r.verdict} (measured ${r.actual})`),
      'a doc quotes a count the tree no longer has: fix the prose, or CLAIMS in scripts/docs/check-doc-counts.mjs if the sentence moved',
    ).toEqual([]);
  });
});
