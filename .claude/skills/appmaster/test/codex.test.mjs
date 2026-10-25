// The Codex engine (spark spooky WP-A): the brief key, the argv builder, the stream parser, the limit
// mapping, a codex dispatch through a fake `codex` (never the real one: APPMASTER_CODEX_BIN), settle of a
// codex run with no result.json, and the regression that a brief without `engine` still spawns claude
// exactly as before. Every path is a temp dir.
// Run: node --test .claude/skills/appmaster/test/codex.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-codex-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
process.env.APPMASTER_CLAUDE_BIN = path.join(tmp, 'claude-shim.mjs');
process.env.APPMASTER_CODEX_BIN = path.join(tmp, 'codex-shim.mjs');
process.env.APPMASTER_FAKE_FREE_GB = '40';
process.env.APPMASTER_GATE_POLL_MS = '5';
process.env.SHIM_OUT_DIR = path.join(tmp, 'shim-out');
fs.mkdirSync(process.env.SHIM_OUT_DIR, { recursive: true });
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const W = await import('../lib/worker.mjs');
const M = await import('../lib/merge.mjs');
const L = await import('../lib/limits.mjs');
const X = await import('../lib/codex.mjs');
const O = await import('../lib/onboard.mjs');

// Recorded 2026-10-25 from `codex exec fork ... --json` (Codex CLI 0.160.0), trimmed to its event shapes.
const RECORDED_FORK = [
  '{"type":"thread.started","thread_id":"01a17406-cf86-7e42-9e17-76041d78a87f"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I\'ll check the current directory and write the two files."}}',
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"powershell.exe -Command pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"powershell.exe -Command pwd","aggregated_output":"C:\\\\lab\\\\wt1\\r\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Created hello.txt containing hi."}}',
  '{"type":"turn.completed","usage":{"input_tokens":76306,"cached_input_tokens":60032,"cache_write_input_tokens":0,"output_tokens":304,"reasoning_output_tokens":17}}',
].join('\n');
// Recorded the same day: a fork the service throttled (exit 1).
const RECORDED_429 = [
  '{"type":"thread.started","thread_id":"01a17408-5b76-7972-a935-7b59331a9a26"}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"exceeded retry limit, last status: 429 Too Many Requests"}',
  '{"type":"turn.failed","error":{"message":"exceeded retry limit, last status: 429 Too Many Requests"}}',
].join('\n');

// ---------------------------------------------------------------- fixtures

// a fake codex: records argv/cwd/stdin, prints thread.started, then does what CODEX_MODE says
fs.writeFileSync(process.env.APPMASTER_CODEX_BIN, `
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const stdin = Buffer.concat(chunks).toString('utf8');
const argv = process.argv.slice(2);
const tid = crypto.randomUUID();
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
w({ type: 'thread.started', thread_id: tid });
fs.writeFileSync(path.join(process.env.SHIM_OUT_DIR, 'codex-' + tid + '.json'), JSON.stringify({ argv, stdin, cwd: process.cwd() }));
w({ type: 'turn.started' });
const mode = process.env.CODEX_MODE || 'commit';
const last = argv[argv.indexOf('-o') + 1];
if (mode === 'limit') {
  w({ type: 'error', message: 'exceeded retry limit, last status: 429 Too Many Requests' });
  w({ type: 'turn.failed', error: { message: 'exceeded retry limit, last status: 429 Too Many Requests' } });
  process.exit(1);
}
if (mode === 'commit' || mode === 'blocked') {
  // like the real sandbox: the change is left UNCOMMITTED, settle commits it
  const name = fs.existsSync('hello.txt') ? 'more-' + tid + '.txt' : 'hello.txt';
  fs.writeFileSync(name, 'hi\\n');
  fs.writeFileSync(path.join(path.dirname(last), 'result.json'), JSON.stringify({ status: mode === 'blocked' ? 'blocked' : 'done', summary: 'Added the greeting. Nothing else.', commitMessage: 'Add ' + name, commits: [], filesTouched: [name], gates: {}, questions: [] }));
}
w({ type: 'item.completed', item: { id: 'i', type: 'command_execution', command: 'cat README', aggregated_output: 'docs: when you hit a rate limit, wait', exit_code: 0, status: 'completed' } });
fs.writeFileSync(last, mode === 'silent' ? 'I could not finish: the task names a file that does not exist.' : 'done');
w({ type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'done' } });
w({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
`);
fs.writeFileSync(process.env.APPMASTER_CLAUDE_BIN, `
import fs from 'node:fs';
import path from 'node:path';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const argv = process.argv.slice(2);
const sid = argv[argv.indexOf('--session-id') + 1];
fs.writeFileSync(path.join(process.env.SHIM_OUT_DIR, 'claude-' + sid + '.json'), JSON.stringify({ argv, cwd: process.cwd() }));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'FINAL', num_turns: 1 }) + '\\n');
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
  return root;
}
const castle = { slug: 'castle', id: 'p-castle', name: 'Castle', root: makeRepo('castle'), baseBranch: 'main' };
const plain = { slug: 'plain', id: 'p-plain', name: 'Plain', root: makeRepo('plain'), baseBranch: 'main' };
const charters = [{ slug: 'accepted-idea-delivery', priority: 1 }];
S.saveBrief('castle', { headless: true, charters, gates: { typecheck: 'exit 0' }, engine: { kind: 'codex' }, maxConcurrent: 5 });
S.saveBrief('plain', { headless: true, charters, gates: { typecheck: 'exit 0' } });
const plan = (project, fields = {}) => S.newRun(project, { wakeId: 'w1', charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'Add hello.txt.', ideaIds: [], model: C.MODELS.builder, ...fields });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) {
  const until = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > until) throw new Error('timed out waiting'); await sleep(100); }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function refusal(fn) {
  try { fn(); } catch (e) { if (e instanceof C.Refusal) return e; throw e; }
  assert.fail('expected a Refusal');
}
const retireAll = () => { for (const s of S.listSlugs()) for (const r of S.listRuns(s, { states: ['running', 'planned', 'exited'] })) S.updateRun(r, { state: 'released' }); };

// ---------------------------------------------------------------- the brief key

test('validateBrief: engine is optional, codex is accepted with defaults, anything else is refused', () => {
  assert.equal(O.validateBrief({ charters }).ok, true, 'no engine = Claude builders');
  const ok = O.validateBrief({ charters, engine: { kind: 'codex' } });
  assert.equal(ok.ok, true); assert.deepEqual(ok.warnings, [], 'engine is a known key');
  assert.equal(O.validateBrief({ charters, engine: { kind: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh' } }).ok, true);
  for (const [engine, want] of [
    [{ kind: 'claude' }, /engine.kind must be "codex"/],
    ['codex', /engine must be an object/],
    [{ kind: 'codex', effort: 'max' }, /engine.effort must be one of/],
    [{ kind: 'codex', model: '' }, /engine.model must be/],
    [{ kind: 'codex', sandbox: 'danger-full-access' }, /engine.sandbox is not a known key/],
  ]) {
    const v = O.validateBrief({ charters, engine });
    assert.equal(v.ok, false, JSON.stringify(engine));
    assert.ok(v.errors.some((e) => want.test(e)), `${JSON.stringify(engine)} -> ${v.errors.join(' | ')}`);
  }
  assert.deepEqual(X.engineOf({ engine: { kind: 'codex' } }), { kind: 'codex', model: 'gpt-6.1-sol', effort: 'high' });
  assert.deepEqual(X.engineOf({ engine: { kind: 'codex', model: 'm', effort: 'low' } }), { kind: 'codex', model: 'm', effort: 'low' });
  assert.equal(X.engineOf({}), null);
  assert.equal(X.engineOf(null), null);
});

test('PROJECT_CAP_MAX is 5: a codex project may run five builders', () => {
  assert.equal(C.PROJECT_CAP_MAX, 5);
  assert.equal(C.projectCap({ maxConcurrent: 5 }), 5);
  assert.equal(C.projectCap({ maxConcurrent: 9 }), 5);
});

// ---------------------------------------------------------------- argv (pure)

test('codexArgs: the exact argv of fork, resume, exec and init; never the sandbox bypass', () => {
  const base = { model: 'gpt-6.1-sol', effort: 'high', lastMessage: 'C:\\run\\last-message.txt' };
  const roots = ['C:\\state\\runs\\r1', 'C:\\repo\\.git'];
  const roots_toml = 'sandbox_workspace_write.writable_roots=["C:\\\\state\\\\runs\\\\r1","C:\\\\repo\\\\.git"]';
  assert.deepEqual(X.codexArgs({ ...base, mode: 'fork', threadId: 'MAIN', writableRoots: roots }), [
    'exec', 'fork', 'MAIN', '--json', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"', '-c', 'approval_policy="never"',
    '-c', 'sandbox_mode="workspace-write"', '-c', roots_toml, '-o', 'C:\\run\\last-message.txt', '-',
  ]);
  assert.deepEqual(X.codexArgs({ ...base, mode: 'resume', threadId: 'BUILD', writableRoots: roots }), [
    'exec', 'resume', 'BUILD', '--json', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"', '-c', 'approval_policy="never"',
    '-c', 'sandbox_mode="workspace-write"', '-c', roots_toml, '-o', 'C:\\run\\last-message.txt', '-',
  ]);
  assert.deepEqual(X.codexArgs({ ...base, mode: 'exec', cwd: 'C:\\wt', writableRoots: roots }), [
    'exec', '--json', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"', '-c', 'approval_policy="never"',
    '-s', 'workspace-write', '-C', 'C:\\wt', '--add-dir', roots[0], '--add-dir', roots[1], '-o', 'C:\\run\\last-message.txt', '-',
  ]);
  assert.deepEqual(X.codexArgs({ ...base, mode: 'init', cwd: 'C:\\proj' }), [
    'exec', '--json', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"', '-c', 'approval_policy="never"',
    '-s', 'read-only', '-C', 'C:\\proj', '-o', 'C:\\run\\last-message.txt', '-',
  ]);
  for (const mode of ['fork', 'resume', 'exec', 'init']) {
    const a = X.codexArgs({ ...base, mode, threadId: 'T', cwd: 'C:\\x', writableRoots: roots });
    assert.ok(!a.some((s) => /dangerously/.test(s)), `${mode} never bypasses the sandbox`);
  }
  assert.throws(() => X.codexArgs({ ...base, mode: 'fork' }), /threadId is required/);
  assert.throws(() => X.codexArgs({ ...base, mode: 'nope' }), /unknown mode/);
});

test('resolveCodexBin: the env override wins; on Windows the npm shim\'s node entry, so the pid is the real process', () => {
  assert.deepEqual(X.resolveCodexBin({ env: { APPMASTER_CODEX_BIN: 'C:/fake/codex.mjs' } }), { bin: 'C:/fake/codex.mjs', via: 'env' });
  const dir = 'C:\\nvm4w\\nodejs';
  const entry = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const have = new Set([path.join(dir, 'codex.cmd'), entry]);
  assert.deepEqual(X.resolveCodexBin({ env: { PATH: `C:\\Windows;${dir}` }, platform: 'win32', exists: (p) => have.has(p) }), { bin: entry, via: 'node-entry' });
  assert.deepEqual(X.resolveCodexBin({ env: { PATH: '/usr/bin' }, platform: 'linux', exists: () => false }), { bin: 'codex', via: 'path' });
  const [cmd, argv] = X.commandFor(entry, ['exec']);
  assert.equal(cmd, process.execPath); assert.deepEqual(argv, [entry, 'exec']);
});

// ---------------------------------------------------------------- the stream (pure)

test('parseCodexStream: thread id, last message and outcome from a recorded fork; parseResult reads it too', () => {
  const p = X.parseCodexStream(`${RECORDED_FORK}\n{"type":"item.comp`);
  assert.equal(p.threadId, '01a17406-cf86-7e42-9e17-76041d78a87f');
  assert.equal(p.lastMessage, 'Created hello.txt containing hi.');
  assert.equal(p.turnsCompleted, 1); assert.equal(p.ended, 'completed'); assert.equal(p.turnFailed, false);
  assert.equal(X.codexThreadId(RECORDED_FORK), '01a17406-cf86-7e42-9e17-76041d78a87f');
  const r = W.parseResult(RECORDED_FORK);
  assert.equal(r.isError, false); assert.equal(r.result, 'Created hello.txt containing hi.'); assert.equal(r.engine, 'codex');
  assert.equal(W.finishedClean(RECORDED_FORK), true);
  assert.equal(W.parseResult(RECORDED_429).isError, true);
  assert.equal(W.finishedClean(RECORDED_429), false);
  assert.equal(W.parseResult('{"type":"thread.started","thread_id":"x"}'), null, 'a stream with no finished turn has no result yet');
});

test('limit mapping: a 429/usage turn.failed is a limit; a command output that mentions one is not', () => {
  const surface = X.codexLimitSurface(RECORDED_429, '');
  assert.ok(X.detectCodexLimit(surface));
  assert.match(X.codexLimitSnippet(surface), /429 Too Many Requests/);
  assert.ok(X.detectCodexLimit(X.codexLimitSurface('{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Try again later."}}')));
  const quoting = '{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"README: on a 429 rate limit, back off"}}\n{"type":"turn.completed"}';
  assert.equal(X.detectCodexLimit(X.codexLimitSurface(quoting)), false, 'a tool output is not the plan running out');
  assert.equal(X.detectCodexLimit(X.codexLimitSurface(RECORDED_FORK)), false);
});

// ---------------------------------------------------------------- dispatch

test('a codex project refuses to dispatch until its main thread exists, and names the command', () => {
  retireAll();
  const run = plan(castle);
  const e = refusal(() => W.cmdDispatch({ flags: { run: run.runId } }));
  assert.equal(e.reason, 'codex main thread missing');
  assert.match(e.extra.hint, /codex init --project castle/);
  assert.equal(S.loadRun('castle', run.runId).state, 'planned');
  assert.equal(S.loadRun('castle', run.runId).worktree, undefined, 'refused before a worktree was cut');
  S.updateRun(S.loadRun('castle', run.runId), { state: 'released' });
});

let codexRun;
test('codex dispatch: forks the main thread in the worktree, records engine/model/thread, journals the thread', async () => {
  retireAll();
  delete process.env.CODEX_MODE;
  C.writeJson(C.codexPath('castle'), { mainThreadId: 'MAIN-THREAD', model: 'gpt-6.1-sol', effort: 'high', createdAt: C.nowIso(), cwd: castle.root });
  const out = W.cmdDispatch({ flags: { run: plan(castle, { model: 'claude-opus-5-5' }).runId } });
  codexRun = out;
  assert.equal(out.state, 'running');
  assert.equal(out.engine, 'codex');
  assert.equal(out.model, 'gpt-6.1-sol');
  assert.equal(out.effort, 'high');
  assert.equal(out.requestedModel, 'claude-opus-5-5', 'the master\'s model is kept for the record, not used');
  assert.equal(out.codexParent, 'MAIN-THREAD');
  assert.equal(out.codexMode, 'fork');
  assert.ok(out.codexThreadId, 'thread.started was read at dispatch');
  const rec = await waitFor(() => { const p = path.join(process.env.SHIM_OUT_DIR, `codex-${out.codexThreadId}.json`); return fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8')); });
  assert.deepEqual(rec.argv.slice(0, 3), ['exec', 'fork', 'MAIN-THREAD']);
  assert.equal(rec.argv[rec.argv.indexOf('-m') + 1], 'gpt-6.1-sol');
  assert.ok(rec.argv.includes('sandbox_mode="workspace-write"'));
  const roots = rec.argv.find((a) => a.startsWith('sandbox_workspace_write.writable_roots='));
  assert.equal(roots, `sandbox_workspace_write.writable_roots=${X.tomlStrings([C.runDir('castle', out.runId)])}`, 'the run dir is the one extra writable root');
  assert.match(rec.stdin, /Do not commit, and do not run `git add`/, 'the codex addendum replaces the commit duty');
  assert.equal(fs.realpathSync(rec.cwd).toLowerCase(), fs.realpathSync(out.worktree).toLowerCase(), 'cwd = the worktree');
  assert.match(rec.stdin, /## Codex build thread/, 'the codex addendum rides on the builder prompt');
  assert.ok(rec.stdin.includes(C.runDir('castle', out.runId)), 'it names the run dir for result.json');
  const threads = X.loadThreads('castle');
  assert.equal(threads.length, 1);
  assert.deepEqual({ ...threads[0], startedAt: undefined }, { runId: out.runId, threadId: out.codexThreadId, parent: 'MAIN-THREAD', mode: 'fork', startedAt: undefined });
  await waitFor(() => !alive(out.pid));
});

test('settle commits a codex build\'s uncommitted work on its branch, then merges it exactly as a claude one', async () => {
  const settled = M.cmdSettle({ flags: { run: codexRun.runId } });
  assert.equal(settled.state, 'merged', settled.heldReason);
  assert.equal(fs.readFileSync(path.join(castle.root, 'hello.txt'), 'utf8'), 'hi\n', 'the file landed through the merge');
  assert.equal(settled.verdict.claim.status, 'done');
  assert.deepEqual(settled.verdict.harnessCommit.files, ['hello.txt']);
  assert.equal(settled.verdict.harnessCommit.message, 'Add hello.txt');
  const body = sh(castle.root, 'log', '-1', '--format=%B', settled.mergedSha);
  assert.match(body, /^Add hello.txt\n\nCommitted by the App Master for Codex build thread /);
  assert.ok(body.includes(codexRun.codexThreadId) && body.includes('MAIN-THREAD'), 'the commit names its thread and the main thread');
});

test('commitCodexWork: only done/partial claims, never a node_modules junction; a blocked codex build stays uncommitted', async () => {
  const wt = path.join(tmp, 'cw');
  fs.mkdirSync(wt, { recursive: true });
  sh(wt, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false']]) sh(wt, 'config', k, v);
  fs.writeFileSync(path.join(wt, 'a.txt'), 'a\n'); sh(wt, 'add', 'a.txt'); sh(wt, 'commit', '-q', '-m', 'i');
  fs.writeFileSync(path.join(wt, 'a.txt'), 'changed\n');
  fs.mkdirSync(path.join(wt, 'pkg', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'pkg', 'node_modules', 'x.js'), '');
  const run = { engine: 'codex', worktree: wt, runId: 'r-1', charterSlug: 'c', codexThreadId: 'T', codexParent: 'M' };
  assert.equal(X.commitCodexWork({ ...run, engine: undefined }, { status: 'done' }), null, 'a claude run is never touched');
  assert.equal(X.commitCodexWork(run, null), null, 'no claim: left as it is');
  assert.equal(X.commitCodexWork(run, { status: 'blocked' }), null);
  const hc = X.commitCodexWork(run, { status: 'partial', summary: 'Changed a. Then more.' }, { junctions: [path.join('pkg', 'node_modules')] });
  assert.deepEqual(hc.files, ['a.txt']);
  assert.equal(hc.message, 'Changed a.');
  assert.equal(sh(wt, 'rev-parse', 'HEAD'), hc.sha);
  assert.equal(sh(wt, 'status', '--porcelain', '--', 'a.txt'), '');

  retireAll();
  process.env.CODEX_MODE = 'blocked';
  const out = W.cmdDispatch({ flags: { run: plan(castle).runId } });
  await waitFor(() => !alive(out.pid));
  delete process.env.CODEX_MODE;
  const settled = M.cmdSettle({ flags: { run: out.runId } });
  assert.equal(settled.state, 'failed');
  assert.match(settled.heldReason, /^builder produced no commits \(uncommitted changes left in the worktree: /);
  assert.equal(settled.verdict.harnessCommit, undefined);
});

test('a codex build with no result.json and no commits fails like a claude one, its last message attached', async () => {
  retireAll();
  process.env.CODEX_MODE = 'silent';
  const out = W.cmdDispatch({ flags: { run: plan(castle).runId } });
  await waitFor(() => !alive(out.pid));
  const settled = M.cmdSettle({ flags: { run: out.runId } });
  assert.equal(settled.state, 'failed');
  assert.match(settled.heldReason, /^builder produced no commits \(no result.json; codex last message: I could not finish/);
  assert.equal(settled.verdict.claim, null);
  delete process.env.CODEX_MODE;
});

test('a codex limit releases the run, marks the CODEX plan only: claude dispatches go on, codex ones refuse', async () => {
  retireAll();
  L.clearLimit();
  process.env.CODEX_MODE = 'limit';
  const out = W.cmdDispatch({ flags: { run: plan(castle).runId } });
  await waitFor(() => !alive(out.pid));
  delete process.env.CODEX_MODE;
  const settled = M.cmdSettle({ flags: { run: out.runId } });
  assert.equal(settled.state, 'released');
  assert.match(settled.heldReason, /^usage limit: codex worker .* 429 Too Many Requests/);
  const mark = L.readLimit();
  assert.equal(mark.engine, 'codex');
  assert.equal(mark.resetsAt, null, 'no reset time is invented');
  // a claude project dispatches under a codex mark
  const claudeRun = W.cmdDispatch({ flags: { run: plan(plain).runId } });
  assert.equal(claudeRun.state, 'running');
  await waitFor(() => !alive(claudeRun.pid));
  S.updateRun(S.loadRun('plain', claudeRun.runId), { state: 'released' });
  // a codex one refuses
  const e = refusal(() => W.cmdDispatch({ flags: { run: plan(castle).runId } }));
  assert.equal(e.reason, 'usage limit'); assert.equal(e.extra.engine, 'codex');
  L.clearLimit();
  // and a plain (claude) mark does not stop... a codex dispatch? It does not: the plans are separate.
  L.setLimit('claude out', null);
  const ok = W.cmdDispatch({ flags: { run: S.listRuns('castle', { states: ['planned'] }).at(-1).runId } });
  assert.equal(ok.state, 'running');
  await waitFor(() => !alive(ok.pid));
  L.clearLimit();
  retireAll();
});

test('regression: a brief without engine spawns claude with today\'s argv, no codex fields', async () => {
  retireAll();
  const out = W.cmdDispatch({ flags: { run: plan(plain).runId } });
  const rec = await waitFor(() => { const p = path.join(process.env.SHIM_OUT_DIR, `claude-${out.sessionId}.json`); return fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8')); });
  assert.deepEqual(rec.argv, ['-p', '-', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--model', C.MODELS.builder, '--session-id', out.sessionId]);
  for (const k of ['engine', 'codexThreadId', 'codexParent', 'codexMode', 'effort', 'requestedModel']) assert.equal(out[k], undefined, k);
  assert.doesNotMatch(fs.readFileSync(W.runFile(out, 'brief.md'), 'utf8'), /Codex build thread/);
  await waitFor(() => !alive(out.pid));
  retireAll();
});

test('a council review of a codex project stays on claude', async () => {
  retireAll();
  const run = plan(castle, { charterSlug: 'council-lite-review', featureSlug: 'gate', councilMode: 'lite', paths: [] });
  const out = W.cmdDispatch({ flags: { run: run.runId } });
  assert.equal(out.engine, undefined);
  const rec = await waitFor(() => { const p = path.join(process.env.SHIM_OUT_DIR, `claude-${out.sessionId}.json`); return fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8')); });
  assert.equal(rec.argv[0], '-p');
  await waitFor(() => !alive(out.pid));
  retireAll();
});

test('codex show lists the main thread and every build thread with its run state', async () => {
  const shown = await X.cmdCodex({ _: ['show'], flags: { project: 'castle' } });
  assert.equal(shown.main.mainThreadId, 'MAIN-THREAD');
  assert.ok(shown.threads.length >= 3);
  assert.ok(shown.threads.every((t) => t.parent === 'MAIN-THREAD' && t.mode === 'fork'));
  assert.equal(shown.threads[0].state, 'merged');
});

test('codex init refuses when the main thread exists (no --force), and refuses a non-codex project', async () => {
  await assert.rejects(X.cmdCodex({ _: ['init'], flags: { project: 'castle' } }), (e) => e instanceof C.Refusal && e.reason === 'codex main thread exists');
  await assert.rejects(X.cmdCodex({ _: ['init'], flags: { project: 'plain' } }), (e) => e instanceof C.Refusal && e.reason === 'not a codex project');
});

test('codex init --force starts a new main thread (fake codex), keeps a .bak, persists codex.json', async () => {
  delete process.env.CODEX_MODE;
  process.env.CODEX_MODE = 'primer';
  const out = await X.cmdCodex({ _: ['init'], flags: { project: 'castle', force: true, root: castle.root } });
  delete process.env.CODEX_MODE;
  assert.ok(out.mainThreadId && out.mainThreadId !== 'MAIN-THREAD');
  assert.ok(out.backup && fs.existsSync(out.backup));
  const saved = C.readJson(C.codexPath('castle'));
  assert.deepEqual(Object.keys(saved).sort(), ['createdAt', 'cwd', 'effort', 'mainThreadId', 'model']);
  assert.equal(saved.cwd, castle.root);
  const rec = JSON.parse(fs.readFileSync(path.join(process.env.SHIM_OUT_DIR, `codex-${out.mainThreadId}.json`), 'utf8'));
  assert.deepEqual(rec.argv.slice(0, 2), ['exec', '--json']);
  assert.equal(rec.argv[rec.argv.indexOf('-s') + 1], 'read-only');
  assert.match(rec.stdin, /main Codex thread of the project/);
});

test('codex say resumes a held build in its worktree under the same pid/await path, output rotated aside', async () => {
  retireAll();
  // a held codex run with a thread and a worktree
  const out = W.cmdDispatch({ flags: { run: plan(castle).runId } });
  await waitFor(() => !alive(out.pid));
  const held = S.updateRun(S.loadRun('castle', out.runId), { state: 'held', heldReason: 'gate failed: test' });
  const msg = path.join(tmp, 'msg.md');
  fs.writeFileSync(msg, 'The test gate fails: fix it.');
  const said = await X.cmdCodex({ _: ['say'], flags: { run: held.runId, file: msg } });
  assert.equal(said.state, 'running');
  assert.equal(said.heldReason, null);
  assert.ok(said.pid > 0 && said.pid !== out.pid);
  assert.match(said.awaitCommand, / await --run /);
  assert.ok(said.rotated.moved.includes('stream.1.jsonl'));
  const recs = fs.readdirSync(process.env.SHIM_OUT_DIR).filter((f) => f.startsWith('codex-')).map((f) => JSON.parse(fs.readFileSync(path.join(process.env.SHIM_OUT_DIR, f), 'utf8')));
  const resumed = await waitFor(() => fs.readdirSync(process.env.SHIM_OUT_DIR).filter((f) => f.startsWith('codex-')).map((f) => JSON.parse(fs.readFileSync(path.join(process.env.SHIM_OUT_DIR, f), 'utf8'))).find((r) => r.argv[1] === 'resume'));
  assert.ok(recs);
  assert.ok(said.codexThreadId);
  assert.deepEqual(resumed.argv.slice(0, 3), ['exec', 'resume', said.codexThreadId]);
  assert.equal(fs.realpathSync(resumed.cwd).toLowerCase(), fs.realpathSync(held.worktree).toLowerCase());
  assert.match(resumed.stdin, /The test gate fails: fix it\./);
  assert.ok(X.loadThreads('castle').some((t) => t.runId === held.runId && t.mode === 'resume'));
  await waitFor(() => !alive(said.pid));
  // a running run cannot be said to; a claude run is not a codex build
  S.updateRun(S.loadRun('castle', held.runId), { state: 'running', pid: process.pid });
  await assert.rejects(X.cmdCodex({ _: ['say'], flags: { run: held.runId, file: msg } }), (e) => e.reason === 'run not resumable');
  retireAll();
});
