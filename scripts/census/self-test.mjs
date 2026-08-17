#!/usr/bin/env node
/**
 * Self-test for the census runner.
 *
 * A gate you cannot trust is worse than no gate, so this file answers one
 * question: **if the runner stopped detecting, would anything tell us?**
 *
 * It runs the REAL engine (`lib/engine.mjs`) and the REAL runner entry point
 * (`run-census.mjs`'s `runCensus`) over `__fixtures__/tree/`, a small corpus
 * with hand-counted violations, and asserts:
 *
 *   1. exact counts per rule — a matcher that silently stops matching fails here
 *   2. every fail-loud assertion actually fires (floor, zero-match,
 *      stale exclude, baseline rise, baseline drop)
 *   3. the two matcher bugs found while building this thing stay dead:
 *      end-of-line tokens, and CRLF line mapping
 *   4. registry validation rejects a malformed rule instead of scanning nothing
 *
 * No test framework — same posture as `scripts/docs/__tests__/check-doc-sync.test.mjs`.
 *
 *   node scripts/census/self-test.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertRule, isCommentOnlyLine, patternToRegExp, scanRule, validateRule } from './lib/engine.mjs';
import { runCensus } from './run-census.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '__fixtures__');
const FIXTURE_RULES = resolve(FIXTURES, 'rules.fixture.json');

// ---------------------------------------------------------------- harness ---
const tests = [];
let passed = 0;
const failures = [];

const test = (name, fn) => tests.push([name, fn]);

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function ok(cond, what) {
  if (!cond) throw new Error(`expected truthy: ${what}`);
}
/** Assert a problem with `code` was raised, and return it. */
function expectProblem(problems, code, kind) {
  const found = problems.find((p) => p.code === code);
  if (!found) {
    throw new Error(
      `expected a "${code}" problem, got [${problems.map((p) => p.code).join(', ') || 'none'}]`,
    );
  }
  if (kind) eq(found.kind, kind, `problem "${code}" kind`);
  return found;
}

const baseRule = (over = {}) => ({
  id: 'tmp',
  goldenPath: 'fixture',
  roots: ['tree'],
  extensions: ['.tsx'],
  signal: { pattern: 'animate-spin', flags: 'g', description: 'fixture', ignoreCommentLines: true },
  exclude: [],
  baseline: { files: 3, matches: 4 },
  floor: 4,
  ...over,
});

// -------------------------------------------------- 1. exact fixture counts ---
// These numbers are hand-counted from __fixtures__/tree/. They are the tripwire:
// any change to the walk, the matcher, the comment filter or the exclusion logic
// moves at least one of them.

test('fixture registry produces exact counts for all three rules', () => {
  const { results } = runCensus({ rulesFile: FIXTURE_RULES, root: FIXTURES, check: true });
  const by = Object.fromEntries(results.map(({ rule, result }) => [rule.id, result]));

  eq(by['fx-storage'].files, 2, 'fx-storage files');
  eq(by['fx-storage'].matches, 4, 'fx-storage matches');
  eq(by['fx-spinner'].files, 3, 'fx-spinner files');
  eq(by['fx-spinner'].matches, 4, 'fx-spinner matches');
  eq(by['fx-select'].files, 3, 'fx-select files');
  eq(by['fx-select'].matches, 4, 'fx-select matches');

  // Every rule walks the same 4-file tree.
  for (const id of ['fx-storage', 'fx-spinner', 'fx-select']) eq(by[id].walked, 4, `${id} walked`);
});

test('fixture registry is green under --check (baselines match reality)', () => {
  const { exitCode } = runCensus({ rulesFile: FIXTURE_RULES, root: FIXTURES, check: true });
  eq(exitCode, 0, 'fixture exit code');
});

test('comment-only lines are excluded from counts', () => {
  const { results } = runCensus({ rulesFile: FIXTURE_RULES, root: FIXTURES });
  const by = Object.fromEntries(results.map(({ rule, result }) => [rule.id, result]));
  // hits.tsx's JSDoc names all three tokens once each; deep.tsx and
  // Primitive.tsx name select/spinner/storage in `//` headers.
  ok(by['fx-storage'].commentMatchesSkipped >= 1, 'storage comment matches skipped');
  ok(by['fx-spinner'].commentMatchesSkipped >= 1, 'spinner comment matches skipped');
  ok(by['fx-select'].commentMatchesSkipped >= 1, 'select comment matches skipped');
});

test('excluded file is credited to its exclude entry and not counted', () => {
  const { results } = runCensus({ rulesFile: FIXTURE_RULES, root: FIXTURES });
  const storage = results.find(({ rule }) => rule.id === 'fx-storage').result;
  eq(storage.excludes.length, 1, 'fx-storage exclude count');
  eq(storage.excludes[0].hits, 1, 'excluded file matched exactly one file');
  ok(!storage.hits.some((h) => h.file.includes('Primitive')), 'Primitive.tsx not in hits');

  // ...while a rule that does NOT exclude it still sees it.
  const select = results.find(({ rule }) => rule.id === 'fx-select').result;
  ok(select.hits.some((h) => h.file.includes('Primitive')), 'fx-select still sees Primitive.tsx');
});

// ------------------------------------- 2. the two real matcher bugs, killed ---

test('REGRESSION: a token at end of line is still found (whole-file matching)', () => {
  // __fixtures__/tree/nested/deep.tsx has `<select` as the last token on its
  // line. A line-by-line matcher with the pattern `<select[\s/>]` misses it,
  // because after splitting there is no character left to match `[\s/>]`.
  // In this repo that shape is 63 of 67 raw selects — the bug reads as
  // "4 violations, looks clean!".
  const line = '      <select';
  eq(line.match(/<select[\s/>]/), null, 'the naive line-split matcher really does miss it');

  const rule = baseRule({
    id: 'eol',
    roots: ['tree/nested'],
    signal: { pattern: '<select(?![A-Za-z0-9_$-])', flags: 'g', description: 'eol', ignoreCommentLines: true },
    floor: 1,
  });
  const result = scanRule(rule, { root: FIXTURES });
  eq(result.matches, 1, 'end-of-line <select found by the engine');
});

test('REGRESSION: CRLF files map matches to the correct line', () => {
  // The obvious line indexer (`split(/\r?\n/)` + `offset += len + 1`) drifts by
  // one character per line on CRLF input, so the comment filter ends up reading
  // a NEIGHBOURING line. Caught in the wild: usePersistedContext.ts (76 CRLF
  // endings) was over-counted by exactly 1.
  const dir = mkdtempSync(join(tmpdir(), 'census-crlf-'));
  try {
    mkdirSync(join(dir, 'tree'), { recursive: true });

    // The fixture must be long enough, with short enough lines, that the naive
    // indexer's one-char-per-line drift accumulates past a whole line and
    // MISCLASSIFIES a match. A five-line fixture does not do that — the first
    // version of this test passed against the regressed engine, which is the
    // exact "green while checking nothing" failure this runner exists to stop.
    // 120 densely alternating comment/code lines of ~16 chars means the drift
    // crosses a line boundary every ~16 lines and flips classification.
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push('//localStorage'); // comment-only: must NOT count
      lines.push(`a${i}=localStorage;`); // code: must count
    }
    lines.push('');
    const EXPECTED_PER_FILE = 60;

    writeFileSync(join(dir, 'tree', 'crlf.tsx'), lines.join('\r\n'), 'utf8');
    writeFileSync(join(dir, 'tree', 'lf.tsx'), lines.join('\n'), 'utf8');

    const rule = baseRule({
      id: 'crlf',
      signal: {
        pattern: '(?:\\bwindow\\s*\\.\\s*)?\\b(?:localStorage|sessionStorage)\\b',
        flags: 'g',
        description: 'crlf',
        ignoreCommentLines: true,
      },
      floor: 2,
    });
    const result = scanRule(rule, { root: dir });
    eq(result.files, 2, 'both files counted');
    eq(result.matches, EXPECTED_PER_FILE * 2, 'every code line counted, every comment line ignored');
    eq(result.commentMatchesSkipped, EXPECTED_PER_FILE * 2, 'every comment mention skipped');

    // Byte-identical content in two line endings must produce identical counts.
    // This is the assertion that fails the moment the line indexer assumes a
    // separator length instead of measuring it.
    const crlfOnly = scanRule({ ...rule, exclude: [{ path: 'tree/lf.tsx', reason: 'isolate the CRLF file' }] }, { root: dir });
    const lfOnly = scanRule({ ...rule, exclude: [{ path: 'tree/crlf.tsx', reason: 'isolate the LF file' }] }, { root: dir });
    eq(lfOnly.matches, EXPECTED_PER_FILE, 'LF baseline is exact');
    eq(crlfOnly.matches, lfOnly.matches, 'CRLF and LF match counts agree');
    eq(crlfOnly.commentMatchesSkipped, lfOnly.commentMatchesSkipped, 'CRLF and LF comment skips agree');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REGRESSION: a comment-skipped MULTILINE match must not swallow real ones', () => {
  // `exec` leaves lastIndex at the END of a match, so a match skipped for
  // starting on a comment line also CONSUMED everything it spanned. Harmless
  // for single-line patterns; for a multiline pattern it silently eats real
  // matches — a comment containing the opening token can begin a match running
  // for hundreds of lines, and every genuine hit inside vanishes.
  //
  // Caught in the wild 2026-08-14: adding an explanatory comment containing the
  // literal `#[cfg(` to lib.rs moved build-gated-ipc-entrypoint from 127 to
  // 126. A COMMENT changed the count — precisely what ignoreCommentLines
  // exists to prevent — and it surfaced as a "silent drop" drift warning, i.e.
  // the detector claiming the codebase improved when nothing had changed.
  const dir = mkdtempSync(join(tmpdir(), 'census-multiline-'));
  try {
    mkdirSync(join(dir, 'tree'), { recursive: true });

    // OPEN ... ] ... newline ... `use x;` — the `[^\]]*` crosses newlines, so a
    // mention inside a comment runs forward to the next `]` anywhere below.
    const src = [
      '// a comment that merely MENTIONS OPEN( in prose',
      'OPEN(one)]',
      'use alpha;',
      'OPEN(two)]',
      'use beta;',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'tree', 'a.tsx'), src, 'utf8');

    const rule = baseRule({
      id: 'multiline-comment-swallow',
      signal: {
        pattern: 'OPEN\\([^\\]]*\\][^\\S\\r\\n]*\\r?\\nuse [a-z]+;',
        flags: 'g',
        description: 'multiline',
        ignoreCommentLines: true,
      },
      baseline: { files: 1, matches: 2 },
      floor: 1,
    });
    const result = scanRule(rule, { root: dir });

    // Both real pairs must survive. Against the regressed engine the comment's
    // runaway match consumed the first pair and this returned 1.
    eq(result.matches, 2, 'both real multiline matches counted despite the comment mention');
    eq(result.files, 1, 'the file is counted once');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------- 3. every fail-loud path fires ---

test('FAIL-LOUD: walking fewer files than `floor` is structural', () => {
  const rule = baseRule({ floor: 5000 });
  const result = scanRule(rule, { root: FIXTURES });
  const p = expectProblem(assertRule(rule, result), 'floor', 'structural');
  ok(/MATCHER IS BROKEN, NOT THE CODEBASE CLEAN/.test(p.message), 'floor message names the real cause');
});

test('FAIL-LOUD: a bad root walks nothing and trips the floor, not a clean pass', () => {
  const rule = baseRule({ roots: ['tree-renamed-in-a-refactor'] });
  const result = scanRule(rule, { root: FIXTURES });
  eq(result.walked, 0, 'nothing walked');
  eq(result.matches, 0, 'nothing matched');
  const problems = assertRule(rule, result);
  expectProblem(problems, 'floor', 'structural');
  expectProblem(problems, 'zero-matches', 'structural');
});

test('FAIL-LOUD: matching zero files anywhere is structural', () => {
  const rule = baseRule({
    signal: { pattern: 'a-class-nobody-has-ever-written', flags: 'g', description: 'x', ignoreCommentLines: true },
    baseline: { files: 0, matches: 0 },
  });
  const result = scanRule(rule, { root: FIXTURES });
  const p = expectProblem(assertRule(rule, result), 'zero-matches', 'structural');
  ok(/DELETE the rule/.test(p.message), 'zero-match message says what to do instead');
});

test('FAIL-LOUD: a stale exclude (path no longer exists) is structural', () => {
  const rule = baseRule({
    exclude: [{ path: 'tree/moved/AwayLastQuarter.tsx', reason: 'a path that no longer exists anywhere' }],
  });
  const result = scanRule(rule, { root: FIXTURES });
  const p = expectProblem(assertRule(rule, result), 'stale-exclude', 'structural');
  ok(/reason on record/.test(p.message), 'stale-exclude message quotes the recorded reason');
});

test('FAIL-LOUD: a count that RISES above baseline is drift', () => {
  const rule = baseRule({ baseline: { files: 1, matches: 1 } });
  const result = scanRule(rule, { root: FIXTURES });
  const problems = assertRule(rule, result);
  const p = expectProblem(problems, 'rose', 'drift');
  ok(/rose 1 -> 3/.test(p.message) || /rose 1 -> 4/.test(p.message), 'rise message carries both numbers');
});

test('FAIL-LOUD: a count that DROPS below baseline is also drift', () => {
  // The non-obvious half. A silent drop is a broken matcher far more often than
  // it is fixed code, and a baseline that only ever ratchets on the way up
  // drifts upward as fast as it drifts down.
  const rule = baseRule({ baseline: { files: 99, matches: 99 } });
  const result = scanRule(rule, { root: FIXTURES });
  const p = expectProblem(assertRule(rule, result), 'dropped', 'drift');
  ok(/broken matcher/.test(p.message), 'drop message names the likely cause');
});

test('drift is fatal under --check and non-fatal in report mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'census-drift-'));
  try {
    // Same fixture tree, but a registry whose baselines are deliberately wrong.
    const registry = {
      rules: [
        baseRule({ id: 'drifting', baseline: { files: 1, matches: 1 } }),
      ],
    };
    const rulesFile = join(dir, 'rules.json');
    writeFileSync(rulesFile, JSON.stringify(registry), 'utf8');

    eq(runCensus({ rulesFile, root: FIXTURES, check: false }).exitCode, 0, 'report mode tolerates drift');
    eq(runCensus({ rulesFile, root: FIXTURES, check: true }).exitCode, 1, 'check mode rejects drift');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('structural failure is fatal even in report mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'census-struct-'));
  try {
    const registry = { rules: [baseRule({ id: 'broken', floor: 5000 })] };
    const rulesFile = join(dir, 'rules.json');
    writeFileSync(rulesFile, JSON.stringify(registry), 'utf8');
    eq(runCensus({ rulesFile, root: FIXTURES, check: false }).exitCode, 1, 'report mode still fails structurally');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FAIL-LOUD: an empty rule registry fails instead of passing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'census-empty-'));
  const errors = [];
  const originalError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const rulesFile = join(dir, 'rules.json');
    writeFileSync(rulesFile, JSON.stringify({ rules: [] }), 'utf8');
    eq(runCensus({ rulesFile, root: FIXTURES }).exitCode, 1, 'empty registry exit code');
    ok(errors.some((e) => /checked nothing at all/.test(e)), 'empty registry says so out loud');
  } finally {
    console.error = originalError;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------ 4. registry validation ---

test('validateRule rejects an exclude with no real reason', () => {
  const errors = validateRule(baseRule({ exclude: [{ path: 'tree/clean.tsx', reason: 'legacy' }] }), 0);
  ok(errors.some((e) => /needs a real "reason"/.test(e)), 'short reason rejected');
});

test('validateRule rejects missing floor, baseline, grounding and a bad regex', () => {
  const rule = baseRule();
  delete rule.floor;
  delete rule.goldenPath;
  rule.baseline = {};
  rule.signal = { pattern: '(unclosed', flags: 'g', description: 'bad' };
  const errors = validateRule(rule, 0);
  ok(errors.some((e) => /missing "floor"/.test(e)), 'floor required');
  ok(errors.some((e) => /missing grounding/.test(e)), 'grounding required');
  ok(errors.some((e) => /missing "baseline.files"/.test(e)), 'baseline.files required');
  ok(errors.some((e) => /not a valid RegExp/.test(e)), 'bad regex rejected');
});

test('a rule grounded by `principle` alone is valid — the consuming-repo shape', () => {
  // A repo that CONSUMES the library has no docs/concepts/golden-paths/ of its own:
  // the principle text stays upstream and the local rule cites a principle id
  // resolved against a vendored index. Requiring `goldenPath` unconditionally made
  // the runner unusable outside the repo that authored it — the first port to
  // another codebase failed on exactly this.
  //
  // Both directions are asserted deliberately. Testing only that missing-BOTH fails
  // would let a later refactor quietly drop `principle` support while this file
  // stayed green, which is the failure mode the whole self-test exists to prevent.
  const consuming = baseRule();
  delete consuming.goldenPath;
  consuming.principle = 'client-state-persistence';
  eq(validateRule(consuming, 0).length, 0, 'principle alone grounds a rule');

  const home = baseRule(); // goldenPath only — the library-home shape
  delete home.principle;
  eq(validateRule(home, 0).length, 0, 'goldenPath alone still grounds a rule');

  const ungrounded = baseRule();
  delete ungrounded.goldenPath;
  ok(
    validateRule(ungrounded, 0).some((e) => /missing grounding/.test(e)),
    'a rule grounded by NEITHER is still rejected',
  );
});

test('a malformed registry fails the run rather than scanning nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'census-bad-'));
  const originalError = console.error;
  console.error = () => {};
  try {
    const rulesFile = join(dir, 'rules.json');
    writeFileSync(rulesFile, JSON.stringify({ rules: [{ id: 'no-fields-at-all' }] }), 'utf8');
    const outcome = runCensus({ rulesFile, root: FIXTURES });
    eq(outcome.exitCode, 1, 'malformed registry exit code');
    ok(outcome.schemaErrors.length > 0, 'schema errors reported');
  } finally {
    console.error = originalError;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- 5. unit-level bits ---

test('patternToRegExp handles exact paths, dir prefixes and globs', () => {
  ok(patternToRegExp('src/main.tsx').test('src/main.tsx'), 'exact match');
  ok(!patternToRegExp('src/main.tsx').test('src/main.tsx.bak'), 'exact match is anchored');
  ok(patternToRegExp('src/lib/storage/').test('src/lib/storage/keys.ts'), 'dir prefix');
  ok(patternToRegExp('**/*.test.ts').test('src/a/b/thing.test.ts'), 'glob suffix');
  ok(!patternToRegExp('**/*.test.ts').test('src/a/b/thing.ts'), 'glob suffix is precise');
  ok(patternToRegExp('**/__tests__/**').test('src/stores/__tests__/a/b.ts'), 'glob dir');
  ok(!patternToRegExp('**/__tests__/**').test('src/stores/thing.ts'), 'glob dir is precise');
});

test('isCommentOnlyLine never swallows code containing // inside a string', () => {
  ok(isCommentOnlyLine('  // a comment'), 'line comment');
  ok(isCommentOnlyLine('   * jsdoc continuation'), 'jsdoc');
  ok(isCommentOnlyLine('/* block start'), 'block start');
  ok(!isCommentOnlyLine("const url = 'https://x.dev'; // trailing"), 'url with // is code');
  ok(!isCommentOnlyLine('const a = localStorage.getItem(k);'), 'plain code');
});

test('zero-width patterns cannot hang the scanner', () => {
  const rule = baseRule({
    id: 'zero-width',
    signal: { pattern: '(?:)|animate-spin', flags: 'g', description: 'pathological', ignoreCommentLines: false },
    floor: 1,
  });
  const result = scanRule(rule, { root: FIXTURES }); // must terminate
  ok(result.walked === 4, 'scan completed');
});

// ------------------------------------------------------------------- run ---
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

console.log(`\ncensus self-test: ${passed}/${tests.length} passed`);
if (failures.length > 0) {
  console.error(
    `\n${failures.length} failure(s). If these fail after an unrelated change, the census ` +
      `runner has stopped detecting — treat every green census run as untrustworthy until fixed.`,
  );
  process.exit(1);
}
process.exit(0);
