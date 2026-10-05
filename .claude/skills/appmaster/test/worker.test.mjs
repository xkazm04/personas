// WP2 worker test: worktree + junction, spawn through a node shim (never the real claude),
// watch flags without killing, dispatch brakes, release --kill, the usage-limit mark.
// Every path is a temp dir: APPMASTER_STATE_ROOT and APPMASTER_WORKTREE_ROOT are set before import.
// Run: node --test .claude/skills/appmaster/test/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-wp2-worker-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
process.env.APPMASTER_CLAUDE_BIN = path.join(tmp, 'shim.mjs');
process.env.APPMASTER_FAKE_FREE_GB = '40';
process.env.SHIM_OUT_DIR = path.join(tmp, 'shim-out');
// the scrub must remove these from the child even though this process carries them
Object.assign(process.env, { ANTHROPIC_API_KEY: 'leak', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'nested', CLAUDE_EFFORT: 'max' });
fs.mkdirSync(process.env.SHIM_OUT_DIR, { recursive: true });

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const W = await import('../lib/worker.mjs');
const WT = await import('../lib/worktree.mjs');
const L = await import('../lib/limits.mjs');

// ---------------------------------------------------------------- fixtures

fs.writeFileSync(process.env.APPMASTER_CLAUDE_BIN, `
import fs from 'node:fs';
import path from 'node:path';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const stdin = Buffer.concat(chunks).toString('utf8');
const argv = process.argv.slice(2);
const sid = argv[argv.indexOf('--session-id') + 1];
fs.writeFileSync(path.join(process.env.SHIM_OUT_DIR, sid + '.json'), JSON.stringify({ argv, env: process.env, stdin, cwd: process.cwd(), pid: process.pid }));
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
w({ type: 'system', subtype: 'hook_response', output: 'SessionStart hook noise' });
w({ type: 'system', subtype: 'init', session_id: sid });
w({ type: 'result', subtype: 'success', is_error: false, result: 'DECOY-FIRST', num_turns: 1 });
w({ type: 'user', message: { content: [{ type: 'tool_result', content: 'docs say: when you hit your usage limit the limit resets at 5pm' }] } });
if (process.env.SHIM_MODE === 'limit') w({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit - resets 5pm (Europe/Prague)", num_turns: 3 });
else w({ type: 'result', subtype: 'success', is_error: false, result: 'FINAL', total_cost_usd: 0.12, num_turns: 7 });
process.stdout.write('{"type":"res');
const ms = Number(process.env.SHIM_SLEEP_MS || 0);
if (ms) await new Promise((r) => setTimeout(r, ms));
`);

const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function makeRepo(name) {
  const root = path.join(tmp, 'repos', name);
  fs.mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', path.join(tmp, 'no-hooks')]]) sh(root, 'config', k, v);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  sh(root, 'add', '.gitignore', 'a.txt');
  sh(root, 'commit', '-q', '-m', 'init');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'marker.txt'), 'real deps');
  return root;
}
const root = makeRepo('demo');
const project = { slug: 'demo', id: 'p-demo', name: 'Demo', root, baseBranch: 'main' };
S.saveBrief('demo', { headless: true, charters: [{ slug: 'accepted-idea-delivery', priority: 1 }], boundaries: ['secrets/**', 'No new paid APIs.'], gates: { typecheck: 'exit 0' }, askFor: ['scope change'] });
const plan = (fields = {}) => S.newRun(project, { wakeId: 'w1', charterSlug: 'accepted-idea-delivery', reason: 'idea i1 accepted', brief: 'Add the widget to the panel.\nKeep it small.', ideaIds: ['i1'], model: C.MODELS.builder, ...fields });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > until) throw new Error('timed out waiting'); await sleep(100); }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sameDir = (a, b) => fs.realpathSync(a).toLowerCase() === fs.realpathSync(b).toLowerCase();
const spawned = [];
/** Retire every live run so the next test starts with nothing running. */
function retireAll() { for (const s of S.listSlugs()) for (const r of S.listRuns(s, { states: ['running', 'planned'] })) S.updateRun(r, { state: 'released' }); }

// ---------------------------------------------------------------- 1. worktree + junction

test('worktree: path, branch from the LOCAL base tip, node_modules junction, junction removed first', () => {
  const statusBefore = sh(root, 'status', '--porcelain');
  const run = plan();
  const wt = WT.createWorktree(run, {});
  const id8 = C.shortId(run.runId);
  assert.equal(wt.worktree, path.join(C.WORKTREE_ROOT, 'demo', id8));
  assert.equal(wt.branch, `autopilot/accepted-idea-delivery-${id8}`);
  assert.equal(wt.baseSha, sh(root, 'rev-parse', 'refs/heads/main'));
  assert.equal(sh(wt.worktree, 'rev-parse', 'HEAD'), wt.baseSha);
  const link = path.join(wt.worktree, 'node_modules');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'node_modules must be a junction, not a copy');
  assert.ok(sameDir(link, path.join(root, 'node_modules')));
  assert.equal(fs.readFileSync(path.join(link, 'marker.txt'), 'utf8'), 'real deps');
  assert.equal(wt.nodeModules, 'junction');
  assert.equal(sh(root, 'status', '--porcelain'), statusBefore, 'the checkout is untouched');

  const res = WT.removeWorktree({ ...run, ...wt });
  assert.equal(res.junction, true);
  assert.equal(res.removed, true);
  assert.equal(fs.existsSync(wt.worktree), false);
  assert.equal(fs.readFileSync(path.join(root, 'node_modules', 'marker.txt'), 'utf8'), 'real deps', 'the real node_modules survives');
  assert.equal(res.branchDeleted, true, 'a branch whose tip is in base is deleted');
  S.updateRun(run, { state: 'released' });
});

test('worktree: an unmerged branch is never deleted', () => {
  const run = plan();
  const wt = WT.createWorktree(run, {});
  fs.writeFileSync(path.join(wt.worktree, 'new.txt'), 'x\n');
  sh(wt.worktree, 'add', 'new.txt');
  sh(wt.worktree, 'commit', '-q', '-m', 'unmerged work');
  const res = WT.removeWorktree({ ...run, ...wt });
  assert.equal(res.removed, true);
  assert.equal(res.branchDeleted, false);
  assert.ok(sh(root, 'rev-parse', '--verify', `refs/heads/${wt.branch}`));
  assert.ok(fs.existsSync(path.join(root, 'node_modules', 'marker.txt')));
  S.updateRun(run, { state: 'released' });
});

// ---------------------------------------------------------------- 2. spawn through the shim

let quickRun;
test('dispatch spawns the shim: argv, scrubbed env, brief on stdin, cwd = worktree; parseResult takes the LAST result', async () => {
  process.env.SHIM_SLEEP_MS = '0'; delete process.env.SHIM_MODE;
  const run = plan();
  const out = W.cmdDispatch({ flags: { run: run.runId } });
  quickRun = out;
  assert.equal(out.state, 'running');
  assert.ok(out.pid > 0 && out.sessionId && out.startedAt && out.branch && out.worktree && out.baseSha);
  assert.equal(fs.readFileSync(W.runFile(out, 'pid'), 'utf8'), String(out.pid));
  const recPath = path.join(process.env.SHIM_OUT_DIR, `${out.sessionId}.json`);
  const rec = await waitFor(() => fs.existsSync(recPath) && JSON.parse(fs.readFileSync(recPath, 'utf8')));
  const a = rec.argv;
  assert.equal(a[a.indexOf('-p') + 1], '-', 'prompt comes from stdin');
  assert.equal(a[a.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(a[a.indexOf('--model') + 1], C.MODELS.builder);
  assert.equal(a[a.indexOf('--session-id') + 1], out.sessionId);
  assert.ok(a.includes('--verbose') && a.includes('--dangerously-skip-permissions'));
  const envKeys = Object.keys(rec.env).map((k) => k.toUpperCase());
  for (const k of C.ENV_STRIP) assert.ok(!envKeys.includes(k.toUpperCase()), `${k} must be stripped`);
  for (const [k, v] of Object.entries(C.ENV_SET)) assert.equal(rec.env[k], v);
  assert.equal(rec.env.PERSONAS_RUN_LABEL, 'cli-master:demo');
  assert.ok(rec.stdin.includes('Add the widget to the panel.'), 'the task arrived on stdin');
  assert.ok(rec.stdin.includes(out.worktree) && rec.stdin.includes(out.branch));
  assert.ok(!/\{\{\w+\}\}/.test(rec.stdin), 'no unfilled placeholder');
  assert.ok(sameDir(rec.cwd, out.worktree), 'cwd is the worktree');
  assert.equal(fs.readFileSync(W.runFile(out, 'brief.md'), 'utf8'), rec.stdin);

  await waitFor(() => !alive(out.pid));
  const stream = fs.readFileSync(W.runFile(out, 'stream.jsonl'), 'utf8');
  assert.ok(stream.split('\n')[0].includes('hook_response'), 'noise comes first');
  const r = W.parseResult(stream);
  assert.equal(r.result, 'FINAL');
  assert.equal(r.isError, false);
  assert.equal(r.costUsd, 0.12);
  assert.equal(r.turns, 7);
});

test('parseResult: null without a result line; a truncated last line is skipped', () => {
  assert.equal(W.parseResult('{"type":"system"}\n{"type":"assistant"}\n'), null);
  assert.equal(W.parseResult(''), null);
  assert.equal(W.parseResult('{"type":"result","result":"ok","is_error":false}\n{"type":"result","resu').result, 'ok');
});

test('watch: a dead pid moves running -> exited; a tool result that MENTIONS a limit sets no mark', () => {
  const rows = W.cmdWatch({ flags: { project: 'demo' } });
  const row = rows.find((r) => r.runId === quickRun.runId);
  assert.equal(row.state, 'exited');
  assert.equal(row.pidAlive, false);
  assert.deepEqual(row.result, { isError: false, costUsd: 0.12, turns: 7 });
  assert.ok(S.loadRun('demo', quickRun.runId).endedAt);
  assert.equal(L.readLimit(), null, 'a repo quoting "usage limit" is not the subscription running out');
  S.updateRun(S.loadRun('demo', quickRun.runId), { state: 'released' });
});

test('watch: quiet at QUIET_MIN, timed out at TIMEOUT_MIN, and it NEVER kills; release --kill does', async () => {
  retireAll();
  process.env.SHIM_SLEEP_MS = '120000';
  const run = W.cmdDispatch({ flags: { run: plan().runId } });
  spawned.push(run.pid);
  const stream = W.runFile(run, 'stream.jsonl');
  await waitFor(() => fs.existsSync(stream) && fs.readFileSync(stream, 'utf8').includes('FINAL'));
  const old = new Date(Date.now() - (C.QUIET_MIN + 1) * 60000);
  fs.utimesSync(stream, old, old);
  let row = W.cmdWatch({}).find((r) => r.runId === run.runId);
  assert.equal(row.pidAlive, true);
  assert.equal(row.quiet, true);
  assert.equal(row.timedOut, false);
  assert.ok(row.streamAgeMin >= C.QUIET_MIN);
  assert.equal(row.state, 'running');

  S.updateRun(S.loadRun('demo', run.runId), { startedAt: new Date(Date.now() - (C.TIMEOUT_MIN + 1) * 60000).toISOString() });
  row = W.cmdWatch({}).find((r) => r.runId === run.runId);
  assert.equal(row.timedOut, true);
  await sleep(300);
  assert.equal(alive(run.pid), true, 'watch never kills a quiet or timed-out worker');

  const released = W.cmdRelease({ flags: { run: C.shortId(run.runId), reason: 'operator said stop', kill: true } });
  assert.equal(released.state, 'released');
  assert.equal(released.heldReason, 'operator said stop');
  assert.equal(released.killed, true);
  assert.equal(alive(run.pid), false);
  assert.ok(fs.existsSync(run.worktree), 'release keeps the worktree of a started run');
});

test('release of a never-started (planned) run removes its worktree and kills nothing; --reason is required', () => {
  const r = plan();
  const wt = WT.createWorktree(r, {});
  const withWt = S.updateRun(r, { ...wt });
  const out = W.cmdRelease({ flags: { run: r.runId, reason: 'never needed' } });
  assert.equal(out.state, 'released');
  assert.equal(out.killed, undefined);
  assert.equal(fs.existsSync(withWt.worktree), false);
  assert.throws(() => W.cmdRelease({ flags: { run: r.runId } }), /--reason/);
});

// ---------------------------------------------------------------- 3. brakes

function refusal(fn) {
  try { fn(); } catch (e) { if (e instanceof C.Refusal) return e; throw e; }
  assert.fail('expected a Refusal');
}

test('dispatch brakes: limit mark, memory, not planned, project cap, global cap (typed reasons)', () => {
  retireAll();
  const run = plan();

  L.setLimit('test limit', new Date(Date.now() + 3600000).toISOString());
  let e = refusal(() => W.cmdDispatch({ flags: { run: run.runId } }));
  assert.equal(e.reason, 'usage limit');
  assert.ok(e.extra.resetsAt);
  L.clearLimit();

  process.env.APPMASTER_FAKE_FREE_GB = String(C.MEM.dispatchMinFreeGb - 0.5);
  e = refusal(() => W.cmdDispatch({ flags: { run: run.runId } }));
  assert.equal(e.reason, 'memory');
  assert.equal(e.extra.freeGb, C.MEM.dispatchMinFreeGb - 0.5);
  assert.equal(e.extra.needGb, C.MEM.dispatchMinFreeGb);
  process.env.APPMASTER_FAKE_FREE_GB = String(C.MEM.dispatchMinFreeGb - 0.1);
  assert.equal(refusal(() => W.cmdDispatch({ flags: { run: run.runId } })).reason, 'memory', 'just under the need is refused');
  process.env.APPMASTER_FAKE_FREE_GB = '40';

  const held = plan({ state: 'held' });
  S.saveRun({ ...held, state: 'held' });
  assert.equal(refusal(() => W.cmdDispatch({ flags: { run: held.runId } })).reason, 'run not planned');

  const busy = S.saveRun({ ...plan(), state: 'running', pid: 999999, startedAt: C.nowIso() });
  e = refusal(() => W.cmdDispatch({ flags: { run: run.runId } }));
  assert.equal(e.reason, 'project cap');
  assert.equal(W.cmdDispatch({ flags: { run: busy.runId } }).runId, busy.runId, 'a running run returns itself');
  S.updateRun(busy, { state: 'released' });

  for (const s of ['p1', 'p2', 'p3']) {
    S.saveBrief(s, { headless: true, charters: [] });
    S.saveRun({ ...S.newRun({ ...project, slug: s, id: s }, { wakeId: 'w', charterSlug: 'c', reason: 'r', brief: 'b', model: 'm' }), state: 'running', pid: 999999 });
  }
  e = refusal(() => W.cmdDispatch({ flags: { run: run.runId } }));
  assert.equal(e.reason, 'global cap');
  assert.equal(e.extra.running.length, C.GLOBAL_CAP);
  assert.equal(S.loadRun('demo', run.runId).state, 'planned', 'a refused dispatch writes nothing');
  assert.equal(S.loadRun('demo', run.runId).worktree, undefined, 'and cuts no worktree');
  retireAll();
});

// ---------------------------------------------------------------- 4. limit mark

test('watch writes the limit mark from a limit banner, and dispatch then refuses', async () => {
  retireAll();
  L.clearLimit();
  process.env.SHIM_SLEEP_MS = '0'; process.env.SHIM_MODE = 'limit';
  const run = W.cmdDispatch({ flags: { run: plan().runId } });
  delete process.env.SHIM_MODE;
  await waitFor(() => !alive(run.pid));
  const row = W.cmdWatch({ flags: { project: 'demo' } }).find((r) => r.runId === run.runId);
  assert.equal(row.limitHit, true);
  const mark = L.readLimit();
  assert.equal(mark.runId, run.runId);
  assert.match(mark.reason, /hit your limit/);
  assert.equal(refusal(() => W.cmdDispatch({ flags: { run: plan().runId } })).reason, 'usage limit');
  L.clearLimit();
  const again = W.cmdWatch({ flags: { project: 'demo' } }).find((r) => r.runId === run.runId);
  assert.equal(again.limitHit, true);
  assert.equal(L.readLimit(), null, 'an operator clear is not overruled by the next watch');
  retireAll();
});

test('limit: detectLimit, cmdLimit show|set|clear, an expired resetsAt reads as cleared', () => {
  assert.equal(L.detectLimit('Claude AI USAGE LIMIT reached'), true);
  assert.equal(L.detectLimit('all good'), false);
  // user turns, system/init lines and clean results are NOT scanned; error results and unparseable lines are
  assert.equal(L.detectLimit(L.limitSurface('{"type":"user","message":"usage limit"}\n{"type":"result","result":"ok","is_error":false}', '')), false);
  const initNoise = JSON.stringify({ type: 'system', subtype: 'init', slash_commands: ['review', 'usage-credits', 'extra-usage'] });
  assert.equal(L.detectLimit(L.limitSurface(initNoise, '')), false, 'the init slash-command list must not read as a limit');
  assert.equal(L.detectLimit(L.limitSurface('{"type":"result","is_error":true,"result":"hit your limit"}', '')), true);
  assert.equal(L.detectLimit(L.limitSurface('plain stdout banner: usage limit reached', '')), true);
  assert.deepEqual(L.cmdLimit({ _: ['show'], flags: {} }), { limited: false });
  const set = L.cmdLimit({ _: ['set'], flags: { reason: 'weekly cap', resets: '2099-01-01T00:00:00Z' } });
  assert.equal(set.limited, true);
  assert.equal(set.reason, 'weekly cap');
  assert.equal(set.resetsAt, '2099-01-01T00:00:00.000Z');
  const onDisk = JSON.parse(fs.readFileSync(C.limitPath(), 'utf8'));
  assert.ok(onDisk.limitedAt && onDisk.reason && 'resetsAt' in onDisk, 'the shared file format');
  assert.equal(L.cmdLimit({ _: ['clear'], flags: {} }).cleared, true);
  L.setLimit('old', '2000-01-01T00:00:00Z');
  assert.equal(L.readLimit(), null);
  assert.deepEqual(L.cmdLimit({ _: [], flags: {} }), { limited: false });
  assert.throws(() => L.cmdLimit({ _: ['set'], flags: {} }), /--reason/);
  L.clearLimit();
});

// ---------------------------------------------------------------- 5. prompt

test('renderBuilderPrompt: globs vs prose boundaries, gates listed, a missing value is an error', () => {
  const run = { ...plan(), branch: 'autopilot/x-1', worktree: 'C:/wt/x' };
  const text = W.renderBuilderPrompt(run, S.loadBrief('demo'), { typecheck: 'exit 0', lint: null, test: null });
  assert.ok(text.includes('`secrets/**`'));
  assert.ok(text.includes('No new paid APIs.'));
  assert.ok(text.includes('- typecheck: `exit 0`'));
  assert.ok(text.includes('- lint: no command configured'));
  assert.ok(text.includes('scope change'));
  assert.ok(text.includes('result.json'));
  assert.throws(() => W.renderBuilderPrompt({ ...run, worktree: undefined }, {}, {}), /\{\{worktree\}\}/);
  S.updateRun(run, { state: 'released' });
});

test('cleanup', () => {
  for (const pid of spawned) { if (alive(pid)) try { process.kill(pid); } catch { /* gone */ } }
  // unlink every junction before the recursive delete, as the code under test does
  const wtRoot = C.WORKTREE_ROOT;
  for (const slug of fs.existsSync(wtRoot) ? fs.readdirSync(wtRoot) : []) {
    for (const id of fs.readdirSync(path.join(wtRoot, slug))) {
      const link = path.join(wtRoot, slug, id, 'node_modules');
      try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* none */ }
    }
  }
  assert.ok(fs.existsSync(path.join(root, 'node_modules', 'marker.txt')));
  fs.rmSync(tmp, { recursive: true, force: true });
});
