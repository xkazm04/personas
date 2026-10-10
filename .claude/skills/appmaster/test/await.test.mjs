// The exit watcher: `await` blocks on a builder's pid (a fake one: a node sleeper this test spawns),
// then watches and settles that run through settle's own code path, in throwaway git repos.
// Never a real claude, never the real journal, never a running app (APPMASTER_HANDSHAKE is missing).
// Run: node --test .claude/skills/appmaster/test/await.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-await-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
process.env.APPMASTER_CLAUDE_BIN = path.join(tmp, 'never-called.mjs');
process.env.APPMASTER_HANDSHAKE = path.join(tmp, 'no-such-handshake.json');
process.env.APPMASTER_FAKE_FREE_GB = '40';
process.env.APPMASTER_GATE_POLL_MS = '5';
process.env.APPMASTER_AWAIT_POLL_MS = '50';

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const W = await import('../lib/worker.mjs');
const WT = await import('../lib/worktree.mjs');
const M = await import('../lib/merge.mjs');
const A = await import('../lib/await.mjs');
const CLI = await import('../appmaster.mjs');

// ---------------------------------------------------------------- fixtures

const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleepers = [];
/** A process that lives `ms` and then exits: the fake builder pid. */
function sleeper(ms) {
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { stdio: 'ignore', windowsHide: true });
  sleepers.push(child);
  return child;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const refusal = async (p) => { try { await p; } catch (e) { if (e instanceof C.Refusal) return e; throw e; } assert.fail('expected a Refusal'); };

function makeRepo(name) {
  const root = path.join(tmp, 'repos', name);
  fs.mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', path.join(tmp, 'no-hooks')]]) sh(root, 'config', k, v);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  sh(root, 'add', '.gitignore', 'a.txt');
  sh(root, 'commit', '-q', '-m', 'init');
  return root;
}
function commitIn(dir, file, content) {
  fs.writeFileSync(path.join(dir, file), content);
  sh(dir, 'add', file);
  sh(dir, 'commit', '-q', '-m', `edit ${file}`);
  return sh(dir, 'rev-parse', 'HEAD');
}
/** A project with one dispatched run (worktree cut, one commit in it) in the given state. */
function scenario(slug, fields = {}) {
  const root = makeRepo(slug);
  const project = { slug, id: `p-${slug}`, name: slug, root, baseBranch: 'main' };
  S.saveBrief(slug, { headless: true, charters: [{ slug: 'accepted-idea-delivery', priority: 1 }], gates: { typecheck: 'exit 0', lint: '', test: '' } });
  let run = S.newRun(project, { wakeId: `w-${slug}`, charterSlug: 'accepted-idea-delivery', reason: 'r', brief: `Deliver for ${slug}`, ideaIds: [], model: C.MODELS.builder });
  const wt = WT.createWorktree(run, {});
  const tip = commitIn(wt.worktree, 'c.txt', `${slug}\n`);
  run = S.updateRun(run, { ...wt, startedAt: C.nowIso(), state: 'exited', ...fields });
  return { root, run, tip };
}
/** CLI run with console captured: {code, json}. */
async function cli(argv) {
  const log = console.log, err = console.error, out = [];
  console.log = (s) => out.push(String(s)); console.error = () => {};
  try { const code = await CLI.run(argv); return { code, json: out.length ? JSON.parse(out.at(-1)) : null }; } finally { console.log = log; console.error = err; }
}

// ---------------------------------------------------------------- the four required cases

test('an already-exited run settles immediately: merged, waitedSec ~0, lock released', async () => {
  const { root, run, tip } = scenario('already');
  const t = Date.now();
  const out = await A.cmdAwait({ flags: { run: C.shortId(run.runId) } });
  assert.equal(out.state, 'merged', out.heldReason);
  assert.equal(out.mergedSha, tip);
  assert.equal(sh(root, 'rev-parse', 'HEAD'), tip);
  assert.equal(out.waitedSec, 0);
  assert.ok(Date.now() - t < 10000);
  assert.equal(fs.existsSync(W.awaitLockPath(run)), false, 'the await lock is released');
});

test('a pid that exits mid-wait: await blocks, sees it gone, moves it to exited, then settles', async () => {
  const made = scenario('midwait');   // git setup first: the fake builder's clock starts after it
  const { root, tip } = made;
  const child = sleeper(1800);
  const run = S.updateRun(made.run, { state: 'running', pid: child.pid });
  const pending = A.cmdAwait({ flags: { run: run.runId } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(S.loadRun('midwait', run.runId).state, 'running', 'nothing happens while the builder lives');
  assert.ok(fs.existsSync(W.awaitLockPath(run)), 'the run is locked while awaited');
  const e = await refusal(Promise.resolve().then(() => M.cmdSettle({ flags: { run: run.runId } })));
  assert.equal(e.reason, 'still running', 'a settle beside it refuses (here: the builder still lives)');
  const out = await pending;
  assert.equal(alive(child.pid), false);
  assert.equal(out.state, 'merged', out.heldReason);
  assert.equal(out.mergedSha, tip);
  assert.equal(sh(root, 'rev-parse', 'HEAD'), tip);
  assert.ok(out.waitedSec >= 1, `waited ${out.waitedSec}s`);
  assert.ok(out.endedAt, 'watch stamped endedAt when it moved the run to exited');
});

test('refusal: a merged run is not awaitable (exit 2 through the CLI, {refused}), nothing changes', async () => {
  const { run } = scenario('merged');
  const merged = await A.cmdAwait({ flags: { run: run.runId } });
  assert.equal(merged.state, 'merged');
  const e = await refusal(A.cmdAwait({ flags: { run: run.runId } }));
  assert.equal(e.reason, 'not awaitable');
  assert.equal(e.extra.state, 'merged');
  assert.equal(e.extra.slug, 'merged');
  const r = await cli(['await', '--run', C.shortId(run.runId)]);
  assert.equal(r.code, C.EXIT.REFUSED);
  assert.equal(r.json.refused, 'not awaitable');
  for (const state of ['planned', 'held', 'verifying', 'released', 'failed']) {
    const x = S.saveRun({ ...S.newRun(run.project, { wakeId: 'w', charterSlug: 'c', reason: 'r', brief: 'b', model: 'm' }), state });
    assert.equal((await refusal(A.cmdAwait({ flags: { run: x.runId } }))).reason, 'not awaitable', state);
  }
});

test('timeout: {timedOut:true}, exit 0, the builder is NOT killed and the run stays running', async () => {
  const child = sleeper(60000);
  const { run } = scenario('timeout', { state: 'running', pid: child.pid });
  const out = await A.cmdAwait({ flags: { run: run.runId, 'timeout-min': '0.005' } });
  assert.equal(out.timedOut, true);
  assert.equal(out.slug, 'timeout');
  assert.equal(out.runs[0].runId, run.runId);
  assert.equal(out.runs[0].pidAlive, true);
  assert.equal(alive(child.pid), true, 'never killed');
  assert.equal(S.loadRun('timeout', run.runId).state, 'running');
  assert.equal(fs.existsSync(W.awaitLockPath(run)), false, 'the lock is released on timeout');
  const r = await cli(['await', '--run', run.runId, '--timeout-min', '0.005']);
  assert.equal(r.code, C.EXIT.OK);
  assert.equal(r.json.timedOut, true);
  child.kill();
});

// ---------------------------------------------------------------- one await per run, project mode, dispatch

test('one await per run: a live foreign await lock refuses a second await AND a settle; a dead one is taken over', async () => {
  const holder = sleeper(60000);
  const { run } = scenario('locked');
  fs.writeFileSync(W.awaitLockPath(run), JSON.stringify({ pid: holder.pid, at: C.nowIso(), expiresAt: new Date(Date.now() + 3600e3).toISOString() }));
  const e = await refusal(A.cmdAwait({ flags: { run: run.runId } }));
  assert.equal(e.reason, 'already awaited');
  assert.equal(e.extra.holder.pid, holder.pid);
  const s = await refusal(Promise.resolve().then(() => M.cmdSettle({ flags: { run: run.runId } })));
  assert.equal(s.reason, 'awaited');
  assert.equal(S.loadRun('locked', run.runId).state, 'exited', 'a refused settle changes nothing');
  // an expired lock holds nothing, even with a live pid (a reused pid)
  fs.writeFileSync(W.awaitLockPath(run), JSON.stringify({ pid: holder.pid, at: C.nowIso(), expiresAt: new Date(Date.now() - 1000).toISOString() }));
  assert.equal(W.awaitHolder(run), null);
  holder.kill();
  await new Promise((r) => setTimeout(r, 200));
  fs.writeFileSync(W.awaitLockPath(run), JSON.stringify({ pid: holder.pid, at: C.nowIso(), expiresAt: new Date(Date.now() + 3600e3).toISOString() }));
  const out = await A.cmdAwait({ flags: { run: run.runId } });
  assert.equal(out.state, 'merged', 'a dead holder\'s lock is taken over');
});

test('--project: settles the first of the project\'s runs to finish; nothing to await is a refusal', async () => {
  const live = sleeper(60000);
  const { run: first } = scenario('proj', { state: 'running', pid: live.pid });
  const project = first.project;
  let second = S.newRun(project, { wakeId: 'w-proj', charterSlug: 'other', reason: 'r', brief: 'b', model: C.MODELS.builder });
  const wt = WT.createWorktree(second, {});
  commitIn(wt.worktree, 'd.txt', 'second\n');
  second = S.updateRun(second, { ...wt, state: 'exited', startedAt: C.nowIso() });
  const out = await A.cmdAwait({ flags: { project: 'proj' } });
  assert.equal(out.runId, second.runId, 'the exited one, not the one still running');
  assert.equal(out.state, 'merged', out.heldReason);
  assert.equal(S.loadRun('proj', first.runId).state, 'running');
  live.kill();
  S.updateRun(S.loadRun('proj', first.runId), { state: 'released' });
  assert.equal((await refusal(A.cmdAwait({ flags: { project: 'proj' } }))).reason, 'nothing to await');
  await assert.rejects(A.cmdAwait({ flags: {} }), /exactly one of --run/);
  await assert.rejects(A.cmdAwait({ flags: { run: first.runId, 'timeout-min': '-1' } }), /--timeout-min/);
});

test('a run released by the operator while awaited ends the await with a refusal, untouched', async () => {
  const live = sleeper(60000);
  const { run } = scenario('releasedmid', { state: 'running', pid: live.pid });
  const pending = A.cmdAwait({ flags: { run: run.runId } });
  await new Promise((r) => setTimeout(r, 150));
  W.cmdRelease({ flags: { run: run.runId, reason: 'operator discarded' } });
  const e = await refusal(pending);
  assert.equal(e.reason, 'not awaitable');
  assert.equal(e.extra.state, 'released');
  assert.equal(alive(live.pid), true, 'release without --kill kills nothing');
  live.kill();
});

test('dispatch prints a ready-to-run awaitCommand for the Director', () => {
  const root = makeRepo('disp');
  fs.writeFileSync(process.env.APPMASTER_CLAUDE_BIN, 'setTimeout(() => {}, 10);\n');
  const project = { slug: 'disp', id: 'p-disp', name: 'disp', root, baseBranch: 'main' };
  S.saveBrief('disp', { headless: true, charters: [{ slug: 'accepted-idea-delivery', priority: 1 }], gates: { typecheck: 'exit 0' } });
  const run = S.newRun(project, { wakeId: 'w', charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', model: C.MODELS.builder });
  const out = W.cmdDispatch({ flags: { run: run.runId } });
  assert.equal(out.state, 'running');
  assert.match(out.awaitCommand, new RegExp(`^node ".+/appmaster\\.mjs" await --run ${C.shortId(run.runId)}$`));
  assert.ok(!out.awaitCommand.includes('\\'), 'forward slashes only (Git Bash eats backslashes)');
  assert.equal(S.loadRun('disp', run.runId).awaitCommand, undefined, 'printed, not journaled');
});

test('the CLI binds await and beats after it (the app is down here: still exit 0)', () => {
  assert.deepEqual(CLI.COMMANDS.await, ['./lib/await.mjs', 'cmdAwait']);
  assert.ok(CLI.BEAT_AFTER.includes('await') && CLI.BEAT_AFTER_REFUSAL.includes('await'));
});

test('cleanup', () => {
  for (const c of sleepers) { try { c.kill(); } catch { /* gone */ } }
  const wtRoot = C.WORKTREE_ROOT;
  for (const slug of fs.existsSync(wtRoot) ? fs.readdirSync(wtRoot) : []) {
    for (const id of fs.readdirSync(path.join(wtRoot, slug))) {
      const link = path.join(wtRoot, slug, id, 'node_modules');
      try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* none */ }
    }
  }
  // a killed sleeper may still hold a handle for a moment on Windows (EPERM): retry, don't fail
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
