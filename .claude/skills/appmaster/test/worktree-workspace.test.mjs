// node_modules linking in npm/pnpm WORKSPACE repos (2026-10-25: two mage-arena runs were held on
// TS2305 because the worktree's @mage/core resolved to the MAIN checkout's packages/core).
// Every path is a temp dir: APPMASTER_STATE_ROOT and APPMASTER_WORKTREE_ROOT are set before import.
// Run: node --test .claude/skills/appmaster/test/worktree-workspace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-ws-link-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');

const WT = await import('../lib/worktree.mjs');

const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const real = (p) => fs.realpathSync.native(p).toLowerCase();
const isLink = (p) => fs.lstatSync(p).isSymbolicLink();

/** A git repo with a committed packages/core and an untracked root node_modules. */
function makeRepo(name, { workspace }) {
  const root = path.join(tmp, 'repos', name);
  fs.mkdirSync(path.join(root, 'packages', 'core'), { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', path.join(tmp, 'no-hooks')]]) sh(root, 'config', k, v);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"root","workspaces":["packages/*"]}\n');
  fs.writeFileSync(path.join(root, 'packages', 'core', 'package.json'), '{"name":"@ws/core"}\n');
  fs.writeFileSync(path.join(root, 'packages', 'core', 'index.js'), 'export const where = "main";\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-q', '-m', 'init');
  const nm = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(nm, 'lodash'), { recursive: true });
  fs.writeFileSync(path.join(nm, 'lodash', 'index.js'), 'third party');
  fs.mkdirSync(path.join(nm, '.bin'));
  fs.writeFileSync(path.join(nm, '.package-lock.json'), '{"lockfileVersion":3}\n');
  if (workspace) {
    fs.mkdirSync(path.join(nm, '@ws'));
    fs.mkdirSync(path.join(nm, '@other', 'thing'), { recursive: true });   // a real scoped third-party package
    fs.symlinkSync(path.join(root, 'packages', 'core'), path.join(nm, '@ws', 'core'), 'junction');
  }
  return root;
}
function addWorktree(root, name) {
  const wt = path.join(tmp, 'worktrees', name);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  sh(root, 'worktree', 'add', '-q', '--detach', wt, 'main');
  // the worktree's own change: the export the main checkout does not have yet
  fs.writeFileSync(path.join(wt, 'packages', 'core', 'index.js'), 'export const where = "worktree";\n');
  return wt;
}
/** Every name under a dir, recursing into real dirs only (never through a link). */
function snapshot(dir) {
  const out = [];
  const walk = (d, pre) => {
    for (const e of fs.readdirSync(d).sort()) {
      const p = path.join(d, e), st = fs.lstatSync(p);
      out.push(`${pre}${e}${st.isSymbolicLink() ? '@' : st.isDirectory() ? '/' : ''}`);
      if (st.isDirectory() && !st.isSymbolicLink()) walk(p, `${pre}${e}/`);
    }
  };
  walk(dir, '');
  return out;
}

test('(a) a workspace link resolves into the WORKTREE, a third-party entry to the root', () => {
  const root = makeRepo('ws-a', { workspace: true });
  const wt = addWorktree(root, 'ws-a');
  assert.equal(WT.linkNodeModules(root, wt), 'workspace');
  const nm = path.join(wt, 'node_modules');
  assert.equal(isLink(nm), false, 'node_modules is a real dir in a workspace repo');
  assert.equal(isLink(path.join(nm, '@ws')), false, 'the scope holding a workspace link is a real dir');
  assert.equal(real(path.join(nm, '@ws', 'core')), real(path.join(wt, 'packages', 'core')));
  assert.equal(fs.readFileSync(path.join(nm, '@ws', 'core', 'index.js'), 'utf8'), 'export const where = "worktree";\n');
  assert.equal(isLink(path.join(nm, 'lodash')), true);
  assert.equal(real(path.join(nm, 'lodash')), real(path.join(root, 'node_modules', 'lodash')));
  assert.equal(real(path.join(nm, '.bin')), real(path.join(root, 'node_modules', '.bin')));
  assert.equal(real(path.join(nm, '@other')), real(path.join(root, 'node_modules', '@other')), 'a scope with no workspace link is junctioned whole');
  assert.equal(isLink(path.join(nm, '.package-lock.json')), false, 'a top-level file is copied, never linked');
  assert.equal(fs.readFileSync(path.join(nm, '.package-lock.json'), 'utf8'), '{"lockfileVersion":3}\n');
  // idempotent: a second pass (evaluateGates re-links) changes nothing and does not refuse
  const before = snapshot(nm);
  assert.equal(WT.linkNodeModules(root, wt), 'workspace');
  assert.deepEqual(snapshot(nm), before);
  // the main checkout still sees its own code
  assert.equal(fs.readFileSync(path.join(root, 'node_modules', '@ws', 'core', 'index.js'), 'utf8'), 'export const where = "main";\n');
});

test('(b) a non-workspace repo still gets the single whole-dir junction', () => {
  const root = makeRepo('plain-b', { workspace: false });
  const wt = addWorktree(root, 'plain-b');
  assert.equal(WT.linkNodeModules(root, wt), 'junction');
  const nm = path.join(wt, 'node_modules');
  assert.equal(isLink(nm), true, 'node_modules is one junction');
  assert.equal(real(nm), real(path.join(root, 'node_modules')));
  assert.equal(WT.unlinkNodeModules(root, wt), true);
  assert.equal(fs.existsSync(nm), false);
});

test('(c) unlink removes everything it created and leaves the root intact', () => {
  const root = makeRepo('ws-c', { workspace: true });
  const wt = addWorktree(root, 'ws-c');
  const rootNm = snapshot(path.join(root, 'node_modules'));
  const rootPkgs = snapshot(path.join(root, 'packages'));
  assert.equal(WT.linkNodeModules(root, wt), 'workspace');
  assert.equal(WT.unlinkNodeModules(root, wt), true);
  assert.equal(fs.existsSync(path.join(wt, 'node_modules')), false, 'the layout dir is gone');
  assert.deepEqual(snapshot(path.join(root, 'node_modules')), rootNm, 'the root node_modules is untouched');
  assert.deepEqual(snapshot(path.join(root, 'packages')), rootPkgs, 'the root packages are untouched');
  assert.equal(fs.readFileSync(path.join(root, 'node_modules', 'lodash', 'index.js'), 'utf8'), 'third party');
  assert.equal(fs.readFileSync(path.join(wt, 'packages', 'core', 'index.js'), 'utf8'), 'export const where = "worktree";\n', 'the worktree package survives');
  assert.equal(WT.unlinkNodeModules(root, wt), false, 'a second unlink finds nothing');
  // and the git removal path goes through cleanly afterwards
  sh(root, 'worktree', 'remove', '--force', wt);
  assert.deepEqual(snapshot(path.join(root, 'node_modules')), rootNm);
});

test('(d) a real, unmarked node_modules in the worktree is refused, workspace or not', () => {
  for (const workspace of [true, false]) {
    const name = workspace ? 'ws-d' : 'plain-d';
    const root = makeRepo(name, { workspace });
    const wt = addWorktree(root, name);
    fs.mkdirSync(path.join(wt, 'node_modules'));
    fs.writeFileSync(path.join(wt, 'node_modules', 'own.txt'), 'a real install');
    assert.throws(() => WT.linkNodeModules(root, wt), /is not a junction; refusing/);
    assert.equal(fs.readFileSync(path.join(wt, 'node_modules', 'own.txt'), 'utf8'), 'a real install', 'the real dir is left alone');
    assert.equal(WT.unlinkNodeModules(root, wt), false, 'unlink leaves a real install alone too');
    assert.ok(fs.existsSync(path.join(wt, 'node_modules', 'own.txt')));
  }
});
