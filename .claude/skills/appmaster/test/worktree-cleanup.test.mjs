// A run's worktree must not outlive its work. 2026-10-23..28: ~213 GB of 7-23 GB cargo target/ folders sat in
// ~/.personas/headless-masters/worktrees because (a) `git worktree remove` failed halfway on a locked or deep
// target/ and removeWorktree THREW before its prune + leftover sweep, and (b) `release` kept the worktree of
// every started run, so a run the Director closed by hand ("merged as 6f367e9", "superseded") never lost it.
// Every path is a temp dir: APPMASTER_STATE_ROOT and APPMASTER_WORKTREE_ROOT are set before import.
// Run: node --test .claude/skills/appmaster/test/worktree-cleanup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-wt-cleanup-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
process.env.APPMASTER_FAKE_FREE_GB = '40';

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const W = await import('../lib/worker.mjs');
const WT = await import('../lib/worktree.mjs');

const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function makeRepo(name) {
  const root = path.join(tmp, 'repos', name);
  fs.mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', path.join(tmp, 'no-hooks')]]) sh(root, 'config', k, v);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\ntarget\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  sh(root, 'add', '.gitignore', 'a.txt');
  sh(root, 'commit', '-q', '-m', 'init');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'marker.txt'), 'real deps');
  return root;
}
const root = makeRepo('demo');
const project = { slug: 'demo', id: 'p-demo', name: 'Demo', root, baseBranch: 'main' };
S.saveBrief('demo', { headless: true, charters: [{ slug: 'accepted-idea-delivery', priority: 1 }], boundaries: ['secrets/**'], gates: { typecheck: 'exit 0' }, askFor: ['scope change'] });
const plan = () => S.newRun(project, { wakeId: 'w1', charterSlug: 'accepted-idea-delivery', reason: 'idea i1 accepted', brief: 'Add the widget.', ideaIds: ['i1'], model: C.MODELS.builder });

/** A started run: a real worktree with a fake build output, state exited. */
function started() {
  const run = plan();
  const wt = WT.createWorktree(run, {});
  const live = S.updateRun(run, { ...wt, state: 'exited', endedAt: new Date().toISOString() });
  for (const rel of ['target/debug/deps', 'src-tauri/target/debug']) {
    fs.mkdirSync(path.join(wt.worktree, rel), { recursive: true });
    fs.writeFileSync(path.join(wt.worktree, rel, 'big.pdb'), 'x'.repeat(4096));
  }
  return live;
}

test('pruneBuildOutput removes target/ and src-tauri/target, keeps source, branch and registration', () => {
  const run = started();
  const out = WT.pruneBuildOutput(run.worktree);
  assert.deepEqual(out.pruned.sort(), ['src-tauri/target'.replace('/', path.sep), 'target'].sort());
  assert.deepEqual(out.failed, []);
  assert.equal(fs.existsSync(path.join(run.worktree, 'target')), false);
  assert.equal(fs.existsSync(path.join(run.worktree, 'src-tauri', 'target')), false);
  assert.ok(fs.existsSync(path.join(run.worktree, 'a.txt')), 'source stays');
  assert.match(sh(root, 'worktree', 'list'), new RegExp(path.basename(run.worktree)), 'still registered');
  assert.ok(sh(root, 'branch', '--list', run.branch), 'branch stays');
  assert.equal(WT.pruneBuildOutput(run.worktree).pruned.length, 0, 'idempotent');
  WT.removeWorktree(run);
});

test('pruneBuildOutput refuses a path outside the worktree root', () => {
  assert.throws(() => WT.pruneBuildOutput(root), /not under/);
  assert.ok(fs.existsSync(path.join(root, 'a.txt')));
});

test('release keeps the worktree of a started run but prunes its build output; --keep-build opts out', () => {
  const a = started();
  const out = W.cmdRelease({ flags: { run: a.runId, reason: 'operator said stop' } });
  assert.equal(out.state, 'released');
  assert.ok(fs.existsSync(a.worktree), 'worktree kept for a retry');
  assert.equal(fs.existsSync(path.join(a.worktree, 'target')), false, 'target pruned');
  assert.ok(out.cleanup.pruned.length >= 1);
  assert.equal(out.cleanup.kept, 'worktree and branch');

  const b = started();
  W.cmdRelease({ flags: { run: b.runId, reason: 'keep it', 'keep-build': true } });
  assert.ok(fs.existsSync(path.join(b.worktree, 'target')), '--keep-build leaves the build output');
  WT.removeWorktree(a); WT.removeWorktree(b);
});

test('release --discard removes a clean worktree and its merged branch; a dirty one is kept and pruned', () => {
  const clean = started();
  const out = W.cmdRelease({ flags: { run: clean.runId, reason: 'merged by the Director as abc123', discard: true } });
  assert.equal(out.cleanup.discarded, true);
  assert.equal(fs.existsSync(clean.worktree), false);
  assert.equal(fs.readFileSync(path.join(root, 'node_modules', 'marker.txt'), 'utf8'), 'real deps', 'the real node_modules survives');

  const dirty = started();
  fs.writeFileSync(path.join(dirty.worktree, 'notes.md'), 'only copy of the idea\n');
  const out2 = W.cmdRelease({ flags: { run: dirty.runId, reason: 'superseded', discard: true } });
  assert.equal(out2.cleanup.discarded, false);
  assert.equal(out2.cleanup.kept, 'uncommitted changes');
  assert.ok(fs.existsSync(path.join(dirty.worktree, 'notes.md')), 'uncommitted work is never discarded');
  assert.equal(fs.existsSync(path.join(dirty.worktree, 'target')), false, 'but its build output still goes');
  fs.rmSync(path.join(dirty.worktree, 'notes.md'));
  WT.removeWorktree(dirty);
});

test('removeWorktree sweeps a folder git has already deregistered (the leftover a failed `git worktree remove` leaves)', () => {
  // Covers the sweep half of the 2026-10-23..28 failure. The throw half (git failing on a locked target/) is
  // not forced here: a Windows file lock cannot be made on demand, so that branch is reviewed, not run.
  const run = started();
  const real = WT.removeWorktree;
  // a leftover folder git no longer lists (what a half-finished remove leaves) is swept
  sh(root, 'worktree', 'remove', '--force', run.worktree);
  fs.mkdirSync(path.join(run.worktree, 'target', 'debug'), { recursive: true });
  fs.writeFileSync(path.join(run.worktree, 'target', 'debug', 'x.pdb'), 'x');
  fs.writeFileSync(path.join(run.worktree, 'package.json'), '{}');
  assert.ok(fs.existsSync(run.worktree));
  const out = real(run);
  assert.equal(out.removed, true, JSON.stringify(out));
  assert.equal(fs.existsSync(run.worktree), false, 'the orphan folder is gone');
});

test('sweep: merged runs are discarded, young released runs pruned, old released runs discarded, dirty kept', () => {
  const merged = started();
  S.updateRun(merged, { state: 'merged', settledAt: new Date().toISOString() });
  const youngReleased = started();
  S.updateRun(youngReleased, { state: 'released', settledAt: new Date().toISOString() });
  const oldReleased = started();
  S.updateRun(oldReleased, { state: 'released', settledAt: new Date(Date.now() - 30 * 864e5).toISOString() });
  const oldDirty = started();
  fs.writeFileSync(path.join(oldDirty.worktree, 'wip.txt'), 'wip\n');
  S.updateRun(oldDirty, { state: 'released', settledAt: new Date(Date.now() - 30 * 864e5).toISOString() });

  const dry = W.cmdSweep({ flags: { dry: true } });
  const act = Object.fromEntries(dry.filter((r) => [merged, youngReleased, oldReleased, oldDirty].some((x) => C.shortId(x.runId) === r.runId)).map((r) => [r.runId, r.action]));
  assert.equal(act[C.shortId(merged.runId)], 'discard');
  assert.equal(act[C.shortId(youngReleased.runId)], 'prune');
  assert.equal(act[C.shortId(oldReleased.runId)], 'discard');
  assert.ok(fs.existsSync(merged.worktree), '--dry touches nothing');

  W.cmdSweep({});
  assert.equal(fs.existsSync(merged.worktree), false, 'merged: discarded');
  assert.ok(fs.existsSync(youngReleased.worktree) && !fs.existsSync(path.join(youngReleased.worktree, 'target')), 'young released: kept, build output gone');
  assert.equal(fs.existsSync(oldReleased.worktree), false, 'old released: discarded');
  assert.ok(fs.existsSync(path.join(oldDirty.worktree, 'wip.txt')), 'uncommitted work survives the sweep');
  assert.equal(fs.existsSync(path.join(oldDirty.worktree, 'target')), false);
  assert.throws(() => W.cmdSweep({ flags: { days: 'soon' } }), /non-negative/);
  fs.rmSync(path.join(oldDirty.worktree, 'wip.txt'));
  WT.removeWorktree(youngReleased); WT.removeWorktree(oldDirty);
});
