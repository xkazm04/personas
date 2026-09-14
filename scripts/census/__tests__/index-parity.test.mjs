/**
 * Index parity — the walk-once/read-once engine must answer EXACTLY what the
 * per-rule walk answered, and the overlay must behave like the disk would have.
 *
 *   node --test scripts/census/__tests__/index-parity.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyOverlay,
  buildIndex,
  invalidateIndex,
  scanRule,
  scanRuleOverIndex,
} from '../lib/engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '..', '__fixtures__');
const FIXTURE_RULES = JSON.parse(
  (await import('node:fs')).readFileSync(resolve(FIXTURES, 'rules.fixture.json'), 'utf8'),
).rules;

test('one shared index answers every fixture rule exactly as its own walk did', () => {
  const index = buildIndex(FIXTURES, { rules: FIXTURE_RULES });
  assert.ok(index.files.size > 0, 'index is not empty');
  for (const rule of FIXTURE_RULES) {
    const perRule = scanRule(rule, { root: FIXTURES, collectScanned: true });
    const shared = scanRuleOverIndex(rule, index, { collectScanned: true });
    assert.deepEqual(shared, perRule, `${rule.id}: shared index != per-rule walk`);
  }
});

test('a rule with two overlapping roots still counts a file once per root, as the walk did', () => {
  const base = FIXTURE_RULES.find((r) => r.id === 'fx-spinner');
  const rule = { ...base, roots: ['tree', 'tree/nested'] };
  const index = buildIndex(FIXTURES, { rules: [rule] });
  const perRule = scanRule(rule, { root: FIXTURES, collectScanned: true });
  const shared = scanRuleOverIndex(rule, index, { collectScanned: true });
  assert.deepEqual(shared, perRule);
  assert.ok(shared.walked > scanRule(base, { root: FIXTURES }).walked, 'overlap is double-counted');
});

test('a rule whose root is missing walks zero files in both engines', () => {
  const base = FIXTURE_RULES.find((r) => r.id === 'fx-spinner');
  const rule = { ...base, roots: ['does-not-exist'] };
  const index = buildIndex(FIXTURES, { rules: [rule] });
  assert.equal(scanRuleOverIndex(rule, index).walked, 0);
  assert.equal(scanRule(rule, { root: FIXTURES }).walked, 0);
});

test('applyOverlay: add / modify / delete change the answer and never touch the input', () => {
  const rule = FIXTURE_RULES.find((r) => r.id === 'fx-spinner');
  const index = buildIndex(FIXTURES, { rules: FIXTURE_RULES });
  const before = scanRuleOverIndex(rule, index);
  const sizeBefore = index.files.size;
  const hitFile = before.hits[0].file;
  const hitContent = index.files.get(hitFile).content;

  // added: a new file carrying the same violations as an existing hit file
  const added = applyOverlay(index, [{ path: 'tree/added.tsx', status: 'added', content: hitContent }]);
  const afterAdd = scanRuleOverIndex(rule, added);
  assert.equal(afterAdd.walked, before.walked + 1);
  assert.equal(afterAdd.matches, before.matches + before.hits[0].matches);
  assert.equal(added.overlayApplied, 1);

  // modified: blank out the hit file
  const modified = applyOverlay(index, [{ path: hitFile, status: 'modified', content: '' }]);
  const afterMod = scanRuleOverIndex(rule, modified);
  assert.equal(afterMod.walked, before.walked);
  assert.equal(afterMod.matches, before.matches - before.hits[0].matches);

  // deleted: the file is gone from the walk
  const deleted = applyOverlay(index, [{ path: hitFile, status: 'deleted' }]);
  const afterDel = scanRuleOverIndex(rule, deleted);
  assert.equal(afterDel.walked, before.walked - 1);
  assert.equal(afterDel.matches, before.matches - before.hits[0].matches);

  // copy-on-write: the base is untouched
  assert.equal(index.files.size, sizeBefore);
  assert.deepEqual(scanRuleOverIndex(rule, index), before);
});

test('applyOverlay ignores what the walk would have ignored, and rejects a content-less text file', () => {
  const index = buildIndex(FIXTURES, { rules: FIXTURE_RULES });
  const ignored = applyOverlay(index, [
    { path: 'tree/node_modules/x.tsx', status: 'added', content: 'animate-spin' },
    { path: 'tree/target-clippy/y.tsx', status: 'added', content: 'animate-spin' },
    { path: 'tree/image.png', status: 'added', binary: true },
    { path: './tree\\posix.md', status: 'added', content: 'animate-spin' },
  ]);
  assert.equal(ignored.overlayApplied, 0);
  assert.equal(ignored.files.size, index.files.size);
  assert.throws(
    () => applyOverlay(index, [{ path: 'tree/big.tsx', status: 'modified', binary: true }]),
    /carries no content/,
  );
});

test('invalidateIndex re-reads changed files and drops deleted ones, in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'census-index-'));
  try {
    mkdirSync(join(dir, 'tree'), { recursive: true });
    writeFileSync(join(dir, 'tree', 'a.tsx'), 'const a = 1;\n', 'utf8');
    writeFileSync(join(dir, 'tree', 'b.tsx'), 'const b = 1;\n', 'utf8');
    const index = buildIndex(dir, { roots: ['tree'], extensions: ['.tsx'] });
    assert.equal(index.files.size, 2);

    writeFileSync(join(dir, 'tree', 'a.tsx'), 'animate-spin\n', 'utf8');
    unlinkSync(join(dir, 'tree', 'b.tsx'));
    writeFileSync(join(dir, 'tree', 'c.tsx'), 'new\n', 'utf8');
    const changed = invalidateIndex(index, ['tree/a.tsx', 'tree/b.tsx', 'tree\\c.tsx', 'tree', 'tree/skip.png']);
    assert.equal(changed, 3);
    assert.equal(index.files.get('tree/a.tsx').content, 'animate-spin\n');
    assert.equal(index.files.has('tree/b.tsx'), false);
    assert.equal(index.files.get('tree/c.tsx').content, 'new\n');
    assert.equal(index.files.has('tree'), false);
    assert.equal(index.version, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the index never reaches into a skipped directory unless a root starts inside one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'census-skip-'));
  try {
    mkdirSync(join(dir, 'src', 'node_modules'), { recursive: true });
    mkdirSync(join(dir, 'src', 'target-clippy'), { recursive: true });
    writeFileSync(join(dir, 'src', 'ok.tsx'), 'animate-spin\n', 'utf8');
    writeFileSync(join(dir, 'src', 'node_modules', 'vendored.tsx'), 'animate-spin\n', 'utf8');
    writeFileSync(join(dir, 'src', 'target-clippy', 'artifact.tsx'), 'animate-spin\n', 'utf8');

    const outer = buildIndex(dir, { roots: ['src'], extensions: ['.tsx'] });
    assert.deepEqual([...outer.files.keys()], ['src/ok.tsx']);

    // A rule rooted INSIDE the skipped dir sees its files; a sibling rule rooted
    // above it must not — exactly as two separate walks would have behaved.
    const both = buildIndex(dir, { roots: ['src', 'src/node_modules'], extensions: ['.tsx'] });
    assert.equal(both.files.size, 2);
    const mk = (roots) => ({
      id: 'x',
      roots,
      extensions: ['.tsx'],
      signal: { pattern: 'animate-spin', description: 't' },
      floor: 1,
    });
    assert.equal(scanRuleOverIndex(mk(['src']), both).walked, 1);
    assert.equal(scanRuleOverIndex(mk(['src/node_modules']), both).walked, 1);
    assert.equal(scanRule(mk(['src']), { root: dir }).walked, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
