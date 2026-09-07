import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeOverlay, summarizeOverlay, OverlayError, gitHead } from '../overlay.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-overlay-'));
  const base = path.join(tmp, 'base');
  fs.mkdirSync(base);
  git(base, 'init', '-q', '-b', 'main');
  git(base, 'config', 'user.email', 'gate@test');
  git(base, 'config', 'user.name', 'gate');
  git(base, 'config', 'core.autocrlf', 'false');
  write(base, 'src/a.ts', 'export const a = 1;\n');
  write(base, 'src/b.ts', 'export const b = 2;\n');
  write(base, 'src/c.ts', 'export const c = 3;\n');
  write(base, 'docs/readme.md', '# hi\n');
  write(base, '.gitignore', 'ignored.txt\n');
  git(base, 'add', '.');
  git(base, 'commit', '-q', '-m', 'init');
  const wt = path.join(tmp, 'wt');
  git(base, 'worktree', 'add', '-q', wt, '-b', 'feature');
  return { tmp, base, wt };
}

function byPath(overlay) {
  return Object.fromEntries(overlay.files.map((f) => [f.path, f]));
}

test('overlay: root === base yields an empty file set', () => {
  const { tmp, base } = makeRepo();
  try {
    const ov = computeOverlay({ baseRoot: base, root: base });
    assert.deepEqual(ov.files, []);
    assert.equal(ov.base.head, gitHead(base));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('overlay: worktree edits, adds, deletes, commits, and base-dirty files', () => {
  const { tmp, base, wt } = makeRepo();
  try {
    // committed change in the worktree
    write(wt, 'src/a.ts', 'export const a = 100;\n');
    git(wt, 'commit', '-q', '-am', 'bump a');
    // uncommitted modify + add + delete in the worktree
    write(wt, 'src/b.ts', 'export const b = 200;\n');
    write(wt, 'src/new/d.ts', 'export const d = 4;\n');
    fs.unlinkSync(path.join(wt, 'src/c.ts'));
    // ignored file must not appear
    write(wt, 'ignored.txt', 'nope');
    // binary untracked file
    write(wt, 'src/blob.bin', Buffer.from([0, 1, 2, 3, 0, 255]));
    // sibling dirties the BASE: one file the worktree still has (unchanged there), one untracked only in base
    write(base, 'docs/readme.md', '# changed by a sibling\n');
    write(base, 'docs/sibling-only.md', 'only in base\n');
    // untracked build output in base is ignored
    write(base, 'target-v3/debug/thing.o', 'zzz');

    const ov = computeOverlay({ baseRoot: base, root: wt });
    const files = byPath(ov);
    assert.deepEqual(
      Object.keys(files).sort(),
      ['docs/readme.md', 'docs/sibling-only.md', 'src/a.ts', 'src/b.ts', 'src/blob.bin', 'src/c.ts', 'src/new/d.ts'],
    );
    assert.equal(files['src/a.ts'].status, 'modified');
    assert.equal(files['src/a.ts'].content, 'export const a = 100;\n');
    assert.equal(files['src/b.ts'].status, 'modified');
    assert.equal(files['src/b.ts'].content, 'export const b = 200;\n');
    assert.equal(files['src/new/d.ts'].status, 'added');
    assert.equal(files['src/new/d.ts'].content, 'export const d = 4;\n');
    assert.equal(files['src/c.ts'].status, 'deleted');
    assert.equal(files['src/c.ts'].content, undefined);
    assert.equal(files['src/blob.bin'].status, 'added');
    assert.equal(files['src/blob.bin'].binary, true);
    assert.equal(files['src/blob.bin'].content, undefined);
    // base-dirty: the program must see the WORKTREE's (committed) version
    assert.equal(files['docs/readme.md'].status, 'modified');
    assert.equal(files['docs/readme.md'].content, '# hi\n');
    // untracked only in base: absent in the worktree -> deleted
    assert.equal(files['docs/sibling-only.md'].status, 'deleted');
    assert.equal(ov.base.head, gitHead(base));
    assert.notEqual(ov.base.head, gitHead(wt));
    assert.deepEqual(summarizeOverlay(ov), { changed: 3, deleted: 2, untracked: 2, total: 7 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('overlay: a root from a different repository is a typed error', () => {
  const { tmp, base } = makeRepo();
  const other = path.join(tmp, 'other');
  fs.mkdirSync(other);
  git(other, 'init', '-q');
  try {
    assert.throws(
      () => computeOverlay({ baseRoot: base, root: other }),
      (e) => e instanceof OverlayError && e.code === 'DIFFERENT_REPO',
    );
    assert.throws(
      () => computeOverlay({ baseRoot: base, root: path.join(tmp, 'missing') }),
      (e) => e instanceof OverlayError && e.code === 'ROOT_MISSING',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
