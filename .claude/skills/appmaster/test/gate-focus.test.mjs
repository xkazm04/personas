// The focused merge gate and the full gate (operator, 2026-10-09): the merge gate narrows `test` to
// what a branch's changed files reach; `verify` runs every suite. Throwaway repos under a temp dir.
// Run: node --test .claude/skills/appmaster/test/gate-focus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-gate-focus-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
delete process.env.APPMASTER_GATE_FOCUS;

const G = await import('../lib/gate.mjs');
const M = await import('../lib/merge.mjs');

const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function pkgDir(name, scripts) {
  const dir = path.join(tmp, 'pkg', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, scripts }));
  return dir;
}

test('testFocus: a plain `vitest run` script narrows; other runners and opt-outs stay full', () => {
  const vit = pkgDir('vit', { test: 'vitest run', 'test:unit': 'vitest run' });
  assert.deepEqual(G.testFocus(vit, { test: 'npm run test' }), { kind: 'vitest' });
  assert.deepEqual(G.testFocus(vit, { test: 'npm run test:unit' }), { kind: 'vitest' });
  assert.deepEqual(G.testFocus(vit, { test: 'npx vitest run' }), { kind: 'vitest' });
  // a vitest run with a filter or a project flag is not plain: narrowing it could drop its intent
  const flagged = pkgDir('flagged', { test: 'vitest run --project unit' });
  assert.equal(G.testFocus(flagged, { test: 'npm run test' }), null);
  // kp's node:test runner, firetv's rule suites: full, unless the brief names a template
  const node = pkgDir('node', { 'test:unit': 'node scripts/run-unit-tests.mjs' });
  assert.equal(G.testFocus(node, { test: 'npm run test:unit' }), null);
  assert.equal(G.testFocus(node, { test: 'cd desk && npm run test:rules' }), null);
  assert.deepEqual(G.testFocus(node, { test: 'npm run test:unit' }, { gates: { testFocused: 'node r.mjs {files}' } }), { kind: 'template', template: 'node r.mjs {files}' });
  // an explicit empty testFocused opts a vitest repo out
  assert.equal(G.testFocus(vit, { test: 'npm run test' }, { gates: { testFocused: null } }), null);
  assert.equal(G.testFocus(vit, { test: null }), null);
  process.env.APPMASTER_GATE_FOCUS = 'off';
  try { assert.equal(G.testFocus(vit, { test: 'npm run test' }), null); } finally { delete process.env.APPMASTER_GATE_FOCUS; }
});

test('focusedTestCommand: code files that exist, quoted; none means no related tests; too many stays full', () => {
  const dir = path.join(tmp, 'tree');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const f of ['src/a.ts', 'src/b.test.tsx', 'README.md']) fs.writeFileSync(path.join(dir, f), 'x');
  const files = ['src/a.ts', 'src/b.test.tsx', 'README.md', 'src/deleted.ts', 'src\\a.ts'];
  assert.equal(G.focusedTestCommand({ kind: 'vitest' }, dir, files), 'npx vitest related --run --passWithNoTests "src/a.ts" "src/b.test.tsx"');
  assert.equal(G.focusedTestCommand({ kind: 'template', template: 'node r.mjs {files} --x' }, dir, ['src/a.ts']), 'node r.mjs "src/a.ts" --x');
  assert.equal(G.focusedTestCommand({ kind: 'vitest' }, dir, ['README.md', 'docs/x.md']), '');
  // a dependency or config change can break any test without an import: always the full suite
  for (const wide of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts', 'apps/web/next.config.mjs', 'desk/package.json']) {
    assert.equal(G.focusedTestCommand({ kind: 'vitest' }, dir, ['src/a.ts', wide]), null, wide);
    assert.equal(G.focusedTestCommand({ kind: 'vitest' }, dir, [wide]), null, `${wide} alone`);
  }
  assert.notEqual(G.focusedTestCommand({ kind: 'vitest' }, dir, ['src/a.ts', 'docs/package.json.md']), null, 'a doc named like a config is not one');
  const many = Array.from({ length: G.FOCUS_MAX_FILES + 1 }, (_, i) => `src/m${i}.ts`);
  for (const f of many) fs.writeFileSync(path.join(dir, f), 'x');
  assert.equal(G.focusedTestCommand({ kind: 'vitest' }, dir, many), null);
});

test('evaluateGates: the focused command runs on the branch, a docs-only branch passes as no related tests', () => {
  const root = path.join(tmp, 'repo');
  fs.mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) sh(root, 'config', k, v);
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 1\n');
  fs.writeFileSync(path.join(root, 'echo.mjs'), "import fs from 'node:fs'; fs.writeFileSync('ran.txt', process.argv.slice(2).join(','));\n");
  fs.writeFileSync(path.join(root, '.gitignore'), 'ran.txt\nnode_modules\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-q', '-m', 'init');
  const run = { slug: 'focus', runId: 'feedface-0000-0000-0000-000000000000', worktree: root, project: { root, baseBranch: 'main' } };
  const gates = { typecheck: 'node -e "process.exit(0)"', lint: null, test: 'node -e "process.exit(1)"' };
  const focus = { kind: 'template', template: 'node echo.mjs {files}' };

  const ev = M.evaluateGates(run, gates, { focus, files: ['a.ts', 'notes.md'] });
  assert.equal(ev.results.test.ok, true, 'the narrowed command replaced the failing full one');
  assert.equal(ev.results.test.focus, 'related');
  assert.equal(ev.results.test.fullCommand, gates.test);
  assert.match(ev.results.test.command, /node echo\.mjs "a\.ts"/);
  assert.equal(fs.readFileSync(path.join(root, 'ran.txt'), 'utf8'), 'a.ts');

  const docs = M.evaluateGates(run, gates, { focus, files: ['notes.md'] });
  assert.equal(docs.results.test.ok, true);
  assert.equal(docs.results.test.noRelatedTests, true);
  assert.match(docs.results.test.focus, /^no related tests/);
  assert.equal(G.gatesVerdict(docs.results).ok, true);

  // no focus: the full test command runs exactly as before
  const full = M.evaluateGates(run, gates, {});
  assert.equal(full.results.test.ok, false);
  assert.equal(full.results.test.focus, undefined);
});

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }); });
