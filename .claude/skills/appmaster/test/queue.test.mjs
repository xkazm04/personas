// The durable admission queue: a dispatch refused for a slot is held, ordered FIFO by decision time,
// reordered by `queue move`, refused explicitly by `queue drop`, and kept by `promote` (alone, and after
// an `await` settles). Temp state root, temp git repos, a node shim for claude, faked free memory.
// Run: node --test .claude/skills/appmaster/test/queue.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-queue-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
process.env.APPMASTER_CLAUDE_BIN = path.join(tmp, 'shim.mjs');
process.env.APPMASTER_HANDSHAKE = path.join(tmp, 'no-such-handshake.json');
process.env.PERSONAS_DB = path.join(tmp, 'no-such.db');
process.env.APPMASTER_FAKE_FREE_GB = '64';
process.env.APPMASTER_GATE_POLL_MS = '5';
process.env.APPMASTER_AWAIT_POLL_MS = '50';
process.env.SHIM_SLEEP_MS = '60000';

fs.writeFileSync(process.env.APPMASTER_CLAUDE_BIN, `
for await (const _ of process.stdin) { /* drain the brief */ }
await new Promise((r) => setTimeout(r, Number(process.env.SHIM_SLEEP_MS || 0)));
`);

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const W = await import('../lib/worker.mjs');
const WT = await import('../lib/worktree.mjs');
const Q = await import('../lib/queue.mjs');
const P = await import('../lib/promote.mjs');
const A = await import('../lib/await.mjs');
const G = await import('../lib/digest.mjs');
const V = await import('../lib/decision.mjs');

const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function makeRepo(name) {
  const root = path.join(tmp, 'repos', name);
  fs.mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', path.join(tmp, 'no-hooks')]]) sh(root, 'config', k, v);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  sh(root, 'add', 'a.txt');
  sh(root, 'commit', '-q', '-m', 'init');
  return root;
}
const CHARTERS = ['accepted-idea-delivery', 'project-kpi-stewardship', 'codebase-security-scan', 'technical-decision-capture'];
const projects = {};
function project(slug) {
  if (projects[slug]) return projects[slug];
  const root = makeRepo(slug);
  S.saveBrief(slug, { headless: true, charters: CHARTERS.map((s) => ({ slug: s, priority: null })), gates: { typecheck: 'exit 0', lint: '', test: '' } });
  return (projects[slug] = { slug, id: `p-${slug}`, name: slug, root, baseBranch: 'main' });
}
/** A planned run whose wake was decided at `decidedAt` (the FIFO key). */
function planned(slug, { charter = 'accepted-idea-delivery', paths = [], decidedAt = C.nowIso(), ideaIds = [] } = {}) {
  const p = project(slug);
  const wakeId = `w-${Math.random().toString(16).slice(2, 10)}`;
  S.saveWake(slug, { wakeId, slug, at: decidedAt, status: 'decided', decidedAt, project: p });
  return S.newRun(p, { wakeId, charterSlug: charter, reason: 'r', brief: `work on ${paths[0] ?? 'everything'}`, ideaIds, model: C.MODELS.builder, paths });
}
/** A run that holds a slot without a process (pid that never exists). */
const busy = (slug, paths, charter = 'project-kpi-stewardship') => S.saveRun({ ...planned(slug, { charter, paths }), state: 'running', pid: 999999, startedAt: C.nowIso() });
const refusal = (fn) => { try { fn(); } catch (e) { if (e instanceof C.Refusal) return e; throw e; } assert.fail('expected a Refusal'); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const spawned = [];
/** Retire every live run and empty the queue, so each test starts from nothing. */
function reset() {
  for (const s of S.listSlugs()) for (const r of S.listRuns(s, { states: C.LIVE_RUN_STATES })) {
    if (r.pid && r.pid !== 999999 && alive(r.pid)) try { process.kill(r.pid); } catch { /* gone */ }
    S.updateRun(r, { state: 'released' });
  }
  fs.rmSync(C.queuePath(), { force: true });
  process.env.APPMASTER_FAKE_FREE_GB = '64';
}

// ---------------------------------------------------------------- enqueue on refusal

test('a dispatch refused for a slot is queued: exit-2 refusal says queued:true and the position; a retry is idempotent', () => {
  reset();
  busy('alpha', ['src/a/']); busy('alpha', ['src/b/'], 'codebase-security-scan');
  const run = planned('alpha', { paths: ['docs/'] });
  const e = refusal(() => W.cmdDispatch({ flags: { run: run.runId } }));
  assert.equal(e.reason, 'project cap');
  assert.equal(e.extra.queued, true);
  assert.equal(e.extra.position, 1);
  assert.equal(e.extra.queueLength, 1);
  const again = refusal(() => W.cmdDispatch({ flags: { run: C.shortId(run.runId) } }));
  assert.equal(again.extra.position, 1);
  const list = P.cmdQueue({ _: ['list'], flags: {} });
  assert.equal(list.length, 1, 'refused twice, queued once');
  assert.deepEqual([list.queue[0].runId, list.queue[0].slug, list.queue[0].charterSlug, list.queue[0].repo, list.queue[0].reason, list.queue[0].model],
    [run.runId, 'alpha', 'accepted-idea-delivery', 'self', 'project cap', C.MODELS.builder]);
  assert.equal(S.loadRun('alpha', run.runId).state, 'planned', 'a queued run stays planned and cuts no worktree');
  assert.equal(S.loadRun('alpha', run.runId).worktree, undefined);
  // a usage limit is not a slot: it is never queued
  reset();
  const other = planned('alpha');
  fs.writeFileSync(C.limitPath(), JSON.stringify({ limitedAt: C.nowIso(), reason: 'test', resetsAt: new Date(Date.now() + 3600e3).toISOString() }));
  try {
    const u = refusal(() => W.cmdDispatch({ flags: { run: other.runId } }));
    assert.equal(u.reason, 'usage limit');
    assert.equal(u.extra.queued, undefined);
    assert.equal(Q.queueTable().length, 0);
  } finally { fs.rmSync(C.limitPath(), { force: true }); }
});

// ---------------------------------------------------------------- order, move, drop

test('queue order is FIFO by the decision time, not by when the refusal happened', () => {
  reset();
  const t0 = Date.now() - 3 * 3600e3;
  const late = planned('alpha', { decidedAt: new Date(t0 + 2 * 3600e3).toISOString() });
  const early = planned('beta', { decidedAt: new Date(t0).toISOString() });
  const middle = planned('gamma', { decidedAt: new Date(t0 + 3600e3).toISOString() });
  for (const r of [late, early, middle]) Q.enqueue(r, 'global cap');   // refused in the "wrong" order
  assert.deepEqual(Q.queueTable().map((q) => q.runId), [early.runId, middle.runId, late.runId]);
  assert.deepEqual(Q.queueTable().map((q) => q.position), [1, 2, 3]);
  assert.equal(Q.positionOf(late.runId), 3);
});

test('queue move pins a run at a position; later arrivals follow the pinned order, FIFO', () => {
  const before = Q.queueTable().map((q) => q.runId);
  const last = before[2];
  const out = P.cmdQueue({ _: ['move'], flags: { run: C.shortId(last), to: '1' } });
  assert.equal(out.to, 1);
  assert.deepEqual(out.queue.map((q) => q.runId), [last, before[0], before[1]]);
  assert.ok(out.queue.every((q) => q.pinned), 'every queued entry is pinned at its new place');
  const newcomer = planned('delta', { decidedAt: new Date(Date.now() - 10 * 3600e3).toISOString() });   // the OLDEST decision of all
  Q.enqueue(newcomer, 'memory');
  assert.deepEqual(Q.queueTable().map((q) => q.runId), [last, before[0], before[1], newcomer.runId], 'the operator\'s order holds over FIFO');
  const clamp = P.cmdQueue({ _: ['move'], flags: { run: newcomer.runId, to: '99' } });
  assert.equal(clamp.to, 4, 'a position past the end is the end');
  assert.throws(() => P.cmdQueue({ _: ['move'], flags: { run: newcomer.runId, to: '0' } }), /positive integer/);
});

test('queue drop is the explicit refusal: the run is released with the reason and leaves the queue', () => {
  const [first] = Q.queueTable();
  const out = P.cmdQueue({ _: ['drop'], flags: { run: first.runId8, reason: 'superseded by the plan' } });
  assert.equal(out.dropped, first.runId);
  const run = S.loadRun(first.slug, first.runId);
  assert.equal(run.state, 'released');
  assert.equal(run.heldReason, 'superseded by the plan');
  assert.ok(!Q.queueTable().some((q) => q.runId === first.runId));
  const entry = Q.loadQueue().find((e) => e.runId === first.runId);
  assert.deepEqual([entry.state, entry.droppedReason], ['dropped', 'superseded by the plan']);
  assert.equal(refusal(() => P.cmdQueue({ _: ['drop'], flags: { run: first.runId, reason: 'x' } })).reason, 'not queued');
  assert.throws(() => P.cmdQueue({ _: ['drop'], flags: { run: Q.queueTable()[0].runId } }), /--reason/);
  // `release` of a queued run drops it too (the same promise, refused another way)
  const next = Q.queueTable()[0];
  W.cmdRelease({ flags: { run: next.runId, reason: 'operator discarded' } });
  assert.ok(!Q.queueTable().some((q) => q.runId === next.runId));
});

// ---------------------------------------------------------------- promote

test('promote fills a freed slot in order, skips a run whose paths still overlap, and lists each awaitCommand', () => {
  reset();
  const holderA = busy('alpha', ['src/a/']);
  busy('alpha', ['src/b/'], 'codebase-security-scan');
  const waitsForA = planned('alpha', { charter: 'technical-decision-capture', paths: ['src/a/x/'], decidedAt: new Date(Date.now() - 7200e3).toISOString() });
  const fitsLater = planned('alpha', { paths: ['docs/'], decidedAt: new Date(Date.now() - 3600e3).toISOString() });
  for (const r of [waitsForA, fitsLater]) assert.equal(refusal(() => W.cmdDispatch({ flags: { run: r.runId } })).reason, 'project cap');
  const nothing = P.promote();
  assert.deepEqual(nothing.promoted, []);
  assert.equal(nothing.stillQueued, 2);
  assert.deepEqual(nothing.refusals.map((x) => x.reason), ['project cap', 'project cap']);

  // the slot frees, but the head of the queue still overlaps a live run: it is skipped, the next one starts
  S.updateRun(S.loadRun('alpha', holderA.runId), { state: 'exited' });   // exited: slot free, paths still owned
  const out = P.promote();
  assert.deepEqual(out.promoted, [fitsLater.runId], 'the run behind the blocked head was promoted');
  assert.equal(out.stillQueued, 1);
  assert.deepEqual(out.refusals, [{ runId: waitsForA.runId, reason: 'paths overlap' }]);
  assert.equal(out.awaitCommands.length, 1);
  assert.match(out.awaitCommands[0].awaitCommand, new RegExp(`await --run ${C.shortId(fitsLater.runId)}$`));
  assert.deepEqual(out.slugs, ['alpha']);
  const started = S.loadRun('alpha', fitsLater.runId);
  assert.equal(started.state, 'running'); spawned.push(started.pid);
  assert.equal(Q.loadQueue().find((e) => e.runId === fitsLater.runId).state, 'promoted');
  assert.equal(Q.loadQueue().find((e) => e.runId === waitsForA.runId).reason, 'paths overlap', 'the entry records what it now waits on');
});

test('promote respects memory and the global cap: it stops there, and every queued run is accounted for', () => {
  reset();
  const a = planned('alpha', { paths: ['x/'] }), b = planned('beta', { paths: ['y/'] });
  Q.enqueue(a, 'memory'); Q.enqueue(b, 'memory');
  process.env.APPMASTER_FAKE_FREE_GB = String(C.MEM.dispatchMinFreeGb - 1);
  let out = P.promote();
  assert.deepEqual(out.promoted, []);
  assert.deepEqual(out.refusals.map((x) => x.reason), ['memory', 'memory']);
  assert.equal(out.stillQueued, 2);
  process.env.APPMASTER_FAKE_FREE_GB = '64';

  const fillers = Array.from({ length: C.GLOBAL_CAP }, (_, i) => busy(`fill${i}`, ['f/']));
  out = P.promote();
  assert.deepEqual(out.promoted, []);
  assert.deepEqual(out.refusals.map((x) => x.reason), ['global cap', 'global cap']);
  S.updateRun(S.loadRun(fillers[0].slug, fillers[0].runId), { state: 'released' });
  out = P.promote();
  assert.equal(out.promoted.length, 1, 'one slot freed, one run promoted');
  assert.equal(out.promoted[0], a.runId, 'the head of the queue');
  assert.deepEqual(out.refusals, [{ runId: b.runId, reason: 'global cap' }]);
  spawned.push(S.loadRun('alpha', a.runId).pid);
  // a queued run that left `planned` some other way is dropped, never dispatched twice
  S.updateRun(S.loadRun('beta', b.runId), { state: 'released' });
  out = P.promote();
  assert.deepEqual(out.refusals.map((x) => x.reason), ['run is released (dropped from the queue)']);
  assert.equal(Q.queueTable().length, 0);
});

test('promote holds the queue lock: a live foreign holder makes it wait, then refuse `queue busy`', () => {
  reset();
  const holder = { pid: process.ppid || 4, label: 'other', at: C.nowIso() };
  // the parent process is alive for the whole test, so the lock is genuinely held
  fs.mkdirSync(path.dirname(C.queueLockPath()), { recursive: true });
  fs.writeFileSync(C.queueLockPath(), JSON.stringify(holder));
  process.env.APPMASTER_QUEUE_LOCK_WAIT_MS = '200';
  try {
    const e = refusal(() => P.promote());
    assert.equal(e.reason, 'queue busy');
  } finally { delete process.env.APPMASTER_QUEUE_LOCK_WAIT_MS; fs.rmSync(C.queueLockPath(), { force: true }); }
  assert.deepEqual(P.promote().promoted, [], 'free again');
});

test('await settles, then promotes: the freed slot is refilled at once and the new awaitCommand is in its output', async () => {
  reset();
  // a run whose builder (a pid that no longer exists) left one commit; it holds a slot until settled
  const p = project('epsilon');
  let done = S.newRun(p, { wakeId: 'w-e', charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', ideaIds: [], model: C.MODELS.builder, paths: ['src/a/'] });
  const wt = WT.createWorktree(done, {});
  fs.writeFileSync(path.join(wt.worktree, 'c.txt'), 'c\n'); sh(wt.worktree, 'add', 'c.txt'); sh(wt.worktree, 'commit', '-q', '-m', 'c');
  done = S.updateRun(done, { ...wt, state: 'running', pid: 999999, startedAt: C.nowIso() });
  busy('epsilon', ['src/b/'], 'codebase-security-scan');
  const waiting = planned('epsilon', { charter: 'technical-decision-capture', paths: ['docs/'] });
  assert.equal(refusal(() => W.cmdDispatch({ flags: { run: waiting.runId } })).extra.queued, true);
  const out = await A.cmdAwait({ flags: { run: done.runId } });
  assert.equal(out.state, 'merged', out.heldReason);
  assert.deepEqual(out.promoted.promoted, [waiting.runId]);
  assert.match(out.promoted.awaitCommands[0].awaitCommand, new RegExp(`await --run ${C.shortId(waiting.runId)}$`));
  const started = S.loadRun('epsilon', waiting.runId);
  assert.equal(started.state, 'running'); spawned.push(started.pid);
});

// ---------------------------------------------------------------- what the Director and the master see

test('status --text ends with the queue table; a project with a queued run is not "quiet"', async () => {
  reset();
  const r = planned('zeta', { decidedAt: new Date(Date.now() - 600e3).toISOString() });
  Q.enqueue(r, 'global cap');
  const st = await G.cmdStatus({ flags: {} });
  assert.equal(st.queue.length, 1);
  assert.deepEqual(st.projects.find((x) => x.slug === 'zeta').queued.map((q) => q.position), [1]);
  const txt = (await G.cmdStatus({ flags: { text: true } })).text.split('\n');
  const at = txt.findIndex((l) => l.startsWith('Queue: 1 waiting'));
  assert.ok(at > 0, txt.join('\n'));
  assert.match(txt[at + 1], /#\s+project\s+charter\s+model\s+repo\s+waited\s+waits on/);
  assert.match(txt.at(-1), new RegExp(`^\\s+1\\s+zeta\\s+accepted-idea-delivery\\s+${C.MODELS.builder}\\s+self\\s+\\d+ min\\s+global cap$`));
  assert.ok(txt.some((l) => l.startsWith('zeta - ')) && txt.some((l) => /Queued [0-9a-f]{8} accepted-idea-delivery at position 1, waiting on global cap/.test(l)));
  assert.equal(G.renderQueue([]).join('\n'), 'Queue: empty.');
});

test('decide treats a queued run as in flight: its charter and its ideas are not dispatched again', async () => {
  reset();
  const r = planned('zeta', { charter: 'project-kpi-stewardship', ideaIds: ['idea-q'] });
  Q.enqueue(r, 'project cap');
  const wakeId = 'w-new';
  S.saveWake('zeta', { wakeId, slug: 'zeta', at: C.nowIso(), status: 'context', project: project('zeta') });
  const decision = {
    wakeId, dispatch: [{ charterSlug: 'project-kpi-stewardship', reason: 'r', brief: 'b', ideaIds: [] }, { charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', ideaIds: ['idea-q'], paths: ['b/'] }],
    defer: CHARTERS.filter((c) => !['project-kpi-stewardship', 'accepted-idea-delivery'].includes(c)).map((c) => ({ charterSlug: c, reason: 'later' })),
    asks: [], ideaVerdicts: [], say: null, note: 'n', nextWakeMinutes: 30,
  };
  decision.dispatch[0].paths = ['a/'];
  const file = path.join(tmp, 'decision-q.json');
  fs.writeFileSync(file, JSON.stringify(decision));
  await assert.rejects(V.cmdDecide({ flags: { project: 'zeta', wake: wakeId, file } }), (e) => {
    assert.equal(e.reason, 'invalid decision');
    assert.ok(e.extra.errors.some((x) => /charter project-kpi-stewardship already has live run [0-9a-f]{8} \(queued at position 1\)/.test(x)), JSON.stringify(e.extra.errors));
    assert.ok(e.extra.errors.some((x) => /idea idea-q is already carried by live run [0-9a-f]{8} \(queued at position 1\)/.test(x)));
    return true;
  });
});

test('the CLI binds queue and promote, and beats after both', async () => {
  const CLI = await import('../appmaster.mjs');
  assert.deepEqual(CLI.COMMANDS.queue, ['./lib/promote.mjs', 'cmdQueue']);
  assert.deepEqual(CLI.COMMANDS.promote, ['./lib/promote.mjs', 'cmdPromote']);
  assert.ok(CLI.BEAT_AFTER.includes('promote') && CLI.BEAT_AFTER.includes('queue'));
  const H = await import('../lib/heartbeat.mjs');
  assert.deepEqual(H.slugsAfter('await', {}, { slug: 'alpha', promoted: { slugs: ['beta', 'alpha'] } }), ['alpha', 'beta']);
  assert.deepEqual(H.slugsAfter('promote', {}, { promoted: [], slugs: ['gamma'] }), ['gamma']);
});

test('cleanup', () => {
  for (const pid of spawned) { if (pid && alive(pid)) try { process.kill(pid); } catch { /* gone */ } }
  reset();
  const wtRoot = C.WORKTREE_ROOT;
  for (const slug of fs.existsSync(wtRoot) ? fs.readdirSync(wtRoot) : []) {
    for (const id of fs.readdirSync(path.join(wtRoot, slug))) {
      const link = path.join(wtRoot, slug, id, 'node_modules');
      try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* none */ }
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });   // a killed shim may hold a handle briefly (EPERM)
});
