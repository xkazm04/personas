// WP2 merge test: settle verifies the builder's claim and the rung-3 merge gate decides, all in
// throwaway git repos under a temp dir (APPMASTER_STATE_ROOT / APPMASTER_WORKTREE_ROOT set first).
// Run: node --test .claude/skills/appmaster/test/merge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-wp2-merge-')));
process.env.APPMASTER_FAKE_FREE_GB = '40';   // settle takes the gate slot: pin memory so these tests never depend on the host
process.env.APPMASTER_GATE_POLL_MS = '5';
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
process.env.APPMASTER_CLAUDE_BIN = path.join(tmp, 'never-called.mjs');

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const M = await import('../lib/merge.mjs');
const WT = await import('../lib/worktree.mjs');
const L = await import('../lib/limits.mjs');

// ---------------------------------------------------------------- fixtures

const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const okGates = { typecheck: 'exit 0', lint: 'exit 0', test: '' };

function makeRepo(name) {
  const root = path.join(tmp, 'repos', name);
  fs.mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', path.join(tmp, 'no-hooks')]]) sh(root, 'config', k, v);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'line one\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
  sh(root, 'add', '.gitignore', 'a.txt', 'b.txt');
  sh(root, 'commit', '-q', '-m', 'init');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'marker.txt'), 'real deps');
  return root;
}

/** A project + an `exited` run whose worktree is cut and ready for the test to commit in. */
function scenario(slug, { gates = okGates, boundaries = [], prep } = {}) {
  const root = makeRepo(slug);
  if (prep) prep(root);
  const project = { slug, id: `p-${slug}`, name: slug, root, baseBranch: 'main' };
  S.saveBrief(slug, { headless: true, charters: [{ slug: 'accepted-idea-delivery', priority: 1 }], gates, boundaries });
  let run = S.newRun(project, { wakeId: `w-${slug}`, charterSlug: 'accepted-idea-delivery', reason: 'r', brief: `Deliver idea for ${slug}`, ideaIds: [`i-${slug}`], model: C.MODELS.builder });
  const wt = WT.createWorktree(run, {});
  run = S.updateRun(run, { ...wt, state: 'exited', startedAt: C.nowIso(), endedAt: C.nowIso() });
  return { root, run, wt: wt.worktree };
}
function commitIn(dir, file, content, msg = `edit ${file}`) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
  sh(dir, 'add', file);
  sh(dir, 'commit', '-q', '-m', msg);
  return sh(dir, 'rev-parse', 'HEAD');
}
/** Status + every working file's bytes (no .git, no node_modules): the checkout's whole visible state. */
function snapshot(root) {
  const files = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files[path.relative(root, p)] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(root);
  return { status: sh(root, 'status', '--porcelain', '--untracked-files=all'), head: sh(root, 'rev-parse', 'HEAD'), files };
}
const settle = (run) => M.cmdSettle({ flags: { run: run.runId } });
const branchExists = (root, b) => { try { sh(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`); return true; } catch { return false; } };

function assertHeldWithAsk(out, slug) {
  assert.equal(out.state, 'held');
  assert.ok(out.heldReason);
  const ask = S.openAsks(slug).find((a) => a.askId === out.askId);
  assert.ok(ask, 'the merge-gate ask is raised');
  assert.equal(ask.source, 'merge-gate');
  assert.equal(ask.kind, 'merge-held');
  assert.equal(ask.wakeId, out.wakeId);
  assert.deepEqual(ask.options.map((o) => o.label), ['Merge it myself', 'Discard the branch', 'Re-dispatch after I commit']);
  assert.ok(ask.options[0].action.includes(out.branch));
  const ob = S.loadOutbox(slug).find((e) => e.kind === 'ask' && e.payload.askId === out.askId);
  assert.ok(ob, 'the ask is queued in the outbox');
  assert.equal(ob.source.runId, out.runId);
  assert.equal(ob.projectId, `p-${slug}`);
  assert.ok(fs.existsSync(out.worktree), 'a held run keeps its worktree');
  assert.ok(branchExists(out.project.root, out.branch), 'a held run keeps its branch');
}

// ---------------------------------------------------------------- the eight acceptance cases

test('(i) dirty overlap with the branch diff -> held, names the file, checkout byte-identical', () => {
  const { root, run, wt } = scenario('dirty');
  commitIn(wt, 'a.txt', 'builder change\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'operator wip\n');
  fs.writeFileSync(path.join(root, 'notes.md'), 'untracked operator notes\n');
  const before = snapshot(root);
  const out = settle(run);
  assertHeldWithAsk(out, 'dirty');
  assert.match(out.heldReason, /a\.txt/);
  assert.deepEqual(out.verdict.dirtyOverlap, ['a.txt']);
  assert.equal(out.verdict.gates.typecheck.ok, true, 'the gates ran first');
  assert.deepEqual(snapshot(root), before, 'nothing in the checkout moved');
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'operator wip\n');
});

test('(ii) clean paths + gates ok -> fast-forward merged, mergedSha == branch tip, task-complete queued, foreign WIP intact', () => {
  const { root, run, wt } = scenario('clean');
  commitIn(wt, 'a.txt', 'builder change\n');
  const tip = commitIn(wt, 'src/c.txt', 'new file\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'operator wip on another file\n');
  fs.writeFileSync(path.join(root, 'foreign.md'), 'a sibling session file\n');
  const out = settle(run);
  assert.equal(out.state, 'merged', out.heldReason);
  assert.equal(out.mergedSha, tip);
  assert.equal(sh(root, 'rev-parse', 'HEAD'), tip);
  assert.deepEqual(out.verdict.commits.length, 2);
  assert.deepEqual(out.verdict.files.sort(), ['a.txt', 'src/c.txt']);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'builder change\n');
  assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'operator wip on another file\n');
  assert.equal(fs.readFileSync(path.join(root, 'foreign.md'), 'utf8'), 'a sibling session file\n');
  assert.equal(sh(root, 'status', '--porcelain', '--untracked-files=all'), 'M b.txt\n?? foreign.md', '(sh trims the leading space of " M")');
  const tc = S.loadOutbox('clean').find((e) => e.kind === 'task-complete');
  assert.ok(tc, 'task-complete queued');
  assert.deepEqual({ ...tc.payload, title: undefined }, { ideaIds: ['i-clean'], sha: tip, title: undefined, runId: run.runId, branch: run.branch });
  assert.ok(tc.payload.title.includes('Deliver idea for clean'));
  assert.equal(fs.existsSync(wt), false, 'worktree removed');
  assert.equal(out.cleanup.junction, true, 'the junction went first');
  assert.ok(fs.existsSync(path.join(root, 'node_modules', 'marker.txt')), 'the real node_modules survives');
  assert.equal(branchExists(root, run.branch), false, 'a merged branch is deleted');
  assert.equal(S.openAsks('clean').length, 0);
  assert.equal(M.cmdSettle({ flags: { run: run.runId } }).mergedSha, tip, 'settle is idempotent on a merged run');
});

test('(iii) base moved -> worktree rebase, typecheck re-run, then fast-forward', () => {
  const { root, run, wt } = scenario('moved');
  commitIn(wt, 'c.txt', 'builder file\n');
  const baseMove = commitIn(root, 'base2.txt', 'operator landed this meanwhile\n', 'operator commit');
  const out = settle(run);
  assert.equal(out.state, 'merged', out.heldReason);
  assert.equal(out.verdict.rebased, true);
  assert.equal(out.verdict.gatesAfterRebase.typecheck.ok, true);
  assert.equal(sh(root, 'rev-parse', 'HEAD'), out.mergedSha);
  sh(root, 'merge-base', '--is-ancestor', baseMove, 'HEAD');
  assert.ok(fs.existsSync(path.join(root, 'c.txt')) && fs.existsSync(path.join(root, 'base2.txt')));
  assert.equal(sh(root, 'rev-list', '--count', `${baseMove}..HEAD`), '1', 'linear: one rebased commit on top');
});

test('(iii-b) base moved with a conflict -> rebase aborted, held, branch tip unchanged', () => {
  const { root, run, wt } = scenario('conflict');
  const tip = commitIn(wt, 'a.txt', 'builder line\n');
  commitIn(root, 'a.txt', 'operator line\n', 'operator commit');
  const before = snapshot(root);
  const out = settle(run);
  assertHeldWithAsk(out, 'conflict');
  assert.match(out.heldReason, /conflicts/);
  assert.equal(sh(root, 'rev-parse', `refs/heads/${run.branch}`), tip);
  assert.equal(fs.existsSync(path.resolve(wt, sh(wt, 'rev-parse', '--git-path', 'rebase-merge'))), false, 'no rebase left in progress');
  assert.deepEqual(snapshot(root), before);
});

test('(iv) boundary hit -> held; prose boundaries are rules, not matchers', () => {
  const { root, run, wt } = scenario('boundary', { boundaries: ['secrets/**', 'No new paid APIs: a new provider needs an ask.'] });
  commitIn(wt, 'secrets/key.txt', 'k\n');
  commitIn(wt, 'ok.txt', 'fine\n');
  const head = sh(root, 'rev-parse', 'HEAD');
  const out = settle(run);
  assertHeldWithAsk(out, 'boundary');
  assert.match(out.heldReason, /secrets\/key\.txt/);
  assert.deepEqual(out.verdict.boundaryHits, [{ file: 'secrets/key.txt', glob: 'secrets/**' }]);
  assert.deepEqual(out.verdict.gates, {}, 'no gate runs once a boundary is hit');
  assert.equal(sh(root, 'rev-parse', 'HEAD'), head);
});

test('(v) no commits -> failed, nothing queued, clean worktree removed', () => {
  const { run, wt } = scenario('empty');
  const out = settle(run);
  assert.equal(out.state, 'failed');
  assert.equal(out.heldReason, 'builder produced no commits');
  assert.equal(S.loadOutbox('empty').length, 0);
  assert.equal(S.loadAsks('empty').length, 0);
  assert.equal(fs.existsSync(wt), false);
});

test('(vi) a gate exiting 1 -> held with its tail', () => {
  const { root, run, wt } = scenario('gatefail', { gates: { typecheck: 'exit 0', lint: 'node -e "console.log(\'LINT-BOOM at x.ts:3\');process.exit(1)"', test: '' } });
  commitIn(wt, 'c.txt', 'x\n');
  const head = sh(root, 'rev-parse', 'HEAD');
  const out = settle(run);
  assertHeldWithAsk(out, 'gatefail');
  assert.match(out.heldReason, /^gate lint failed \(exit 1\): .*LINT-BOOM/);
  assert.equal(out.verdict.gates.lint.ok, false);
  assert.equal(out.verdict.gates.lint.exit, 1);
  assert.match(out.verdict.gates.lint.tail, /LINT-BOOM at x\.ts:3/);
  assert.equal(out.verdict.gates.test.skipped, true);
  assert.equal(sh(root, 'rev-parse', 'HEAD'), head);
});

test('(vii) every gate skipped -> held "no verifiable gate"', () => {
  const { run, wt } = scenario('nogates', { gates: { typecheck: '', lint: null, test: '' } });
  commitIn(wt, 'c.txt', 'x\n');
  const out = settle(run);
  assertHeldWithAsk(out, 'nogates');
  assert.match(out.heldReason, /no verifiable gate/);
  assert.ok(Object.values(out.verdict.gates).every((g) => g.skipped));
});

test('(viii) checkout on another branch -> held, nothing merged', () => {
  const { root, run, wt } = scenario('otherbranch');
  commitIn(wt, 'c.txt', 'x\n');
  sh(root, 'checkout', '-q', '-b', 'feature');
  const before = snapshot(root);
  const out = settle(run);
  assertHeldWithAsk(out, 'otherbranch');
  assert.match(out.heldReason, /on feature, not main/);
  assert.deepEqual(snapshot(root), before);
});

test('(ix) unresolved conflicts left by a stash pop (no MERGE_HEAD) -> held with a clear reason, nothing merged', () => {
  const { root, run, wt } = scenario('stashpop');
  commitIn(wt, 'c.txt', 'x\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'local edit\n');
  sh(root, 'stash', 'push', '-q', '-m', 'wip');
  commitIn(root, 'b.txt', 'upstream edit\n', 'upstream change to b');
  try { sh(root, 'stash', 'pop'); } catch { /* the conflict is the point */ }
  assert.match(sh(root, 'ls-files', '--unmerged'), /b\.txt/);
  assert.equal(fs.existsSync(path.join(root, '.git', 'MERGE_HEAD')), false);
  const headBefore = sh(root, 'rev-parse', 'HEAD');
  const out = settle(run);
  assertHeldWithAsk(out, 'stashpop');
  assert.match(out.heldReason, /unresolved conflicted file/);
  assert.match(out.heldReason, /b\.txt/);
  assert.equal(sh(root, 'rev-parse', 'HEAD'), headBefore);
});

// delta gate: a gate that is ALREADY red on the base blocks a branch only if the branch adds a failure
const redScript = path.join(tmp, 'red-gate.cjs').replace(/\\/g, '/');
fs.writeFileSync(redScript, [
  "const fs = require('fs');",
  'const out = [];',
  "if (fs.existsSync('base-red.txt')) out.push(' FAIL  src/old.test.ts > already red on base  7ms');",
  "if (fs.existsSync('new-bug.txt')) out.push(' FAIL  src/new.test.ts > broken by the branch  9ms');",
  "console.log(out.join('\\n'));",
  'process.exit(out.length ? 1 : 0);',
].join('\n'));
const redGates = { typecheck: 'exit 0', lint: 'exit 0', test: `node ${redScript}` };
const redBase = (root) => { commitIn(root, 'base-red.txt', 'x\n', 'base is red'); };

test('(x) base already red, branch adds no failure -> merged, the gate is recorded as inherited', () => {
  const { root, run, wt } = scenario('inh-ok', { gates: redGates, prep: redBase });
  commitIn(wt, 'c.txt', 'x\n');
  const out = settle(run);
  assert.equal(out.state, 'merged', out.heldReason);
  assert.equal(out.verdict.gates.test.inherited, true);
  assert.equal(out.verdict.gates.test.ok, false);
  assert.equal(out.verdict.gates.test.base.ok, false);
  assert.equal(branchExists(root, run.branch), false);
});

test('(xi) base already red, branch adds a NEW failure -> held on the new one', () => {
  const { run, wt } = scenario('inh-new', { gates: redGates, prep: redBase });
  commitIn(wt, 'new-bug.txt', 'x\n');
  const out = settle(run);
  assertHeldWithAsk(out, 'inh-new');
  assert.match(out.heldReason, /gate test failed/);
  assert.notEqual(out.verdict.gates.test.inherited, true);
});

test('(xii) base green, branch red -> held (nothing is inherited from a passing base)', () => {
  const { run, wt } = scenario('inh-green', { gates: redGates });
  commitIn(wt, 'new-bug.txt', 'x\n');
  const out = settle(run);
  assertHeldWithAsk(out, 'inh-green');
  assert.equal(out.verdict.gates.test.base.ok, true);
});

// gate side effects: a test run that rewrites a tracked file (vitest snapshots) must not leave the worktree dirty
const noisyScript = path.join(tmp, 'noisy-gate.cjs').replace(/\\/g, '/');
fs.writeFileSync(noisyScript, "require('fs').appendFileSync('b.txt', 'rewritten by the gate\\n');\n");
const noisyGates = { typecheck: 'exit 0', lint: 'exit 0', test: `node ${noisyScript}` };

test('(xiii) a gate that rewrites a tracked file is reverted and recorded, and the merge still goes through', () => {
  const { root, run, wt } = scenario('noisy', { gates: noisyGates });
  commitIn(wt, 'c.txt', 'x\n');
  const out = settle(run);
  assert.equal(out.state, 'merged', out.heldReason);
  assert.deepEqual(out.verdict.gateSideEffects, ['b.txt']);
  assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8').replace(/\r\n/g, '\n'), 'b\n', 'the rewrite never reached the checkout');
});

test('(xiv) a held run that merges on a retry closes its own merge-held asks and no one else\'s', () => {
  const { run, wt } = scenario('closeasks');
  commitIn(wt, 'c.txt', 'x\n');
  const other = S.raiseAsk('closeasks', { wakeId: 'w-x', source: 'merge-gate', kind: 'merge-held', question: 'Run deadbeef (x) in closeasks is held', context: '', options: [] });
  const mine = S.raiseAsk('closeasks', { wakeId: run.wakeId, source: 'merge-gate', kind: 'merge-held', question: `Run ${C.shortId(run.runId)} (accepted-idea-delivery) in closeasks is held and was not merged: x`, context: '', options: [] });
  const masterAsk = S.raiseAsk('closeasks', { wakeId: run.wakeId, source: 'master', kind: 'scope', question: `Run ${C.shortId(run.runId)} is mentioned here but this is the master's own ask`, context: '', options: [] });
  const closed = M.closeHeldAsks(run, 'abcdef0123456789');
  assert.deepEqual(closed, [mine.askId]);
  const open = S.openAsks('closeasks').map((a) => a.askId).sort();
  assert.deepEqual(open, [other.askId, masterAsk.askId].sort());
  assert.match(S.loadAsks('closeasks').find((a) => a.askId === mine.askId).answer.notes, /merged abcdef0123/);
});

test('(xv) the failure signature is the same for the same test in the branch worktree and the base worktree', async () => {
  const G = await import('../lib/gate.mjs');
  const text = (dir) => `  BROKEN     failed twice\n    C:\\Users\\x\\.personas\\headless-masters\\worktrees\\kp\\${dir}\\app\\api\\a\\b.test.ts\n      \u00b7 the thing works\n`;
  const branch = G.failureSignature(text('1d7bc52b'));
  const base = G.failureSignature(text('base-1d7bc52b'));
  assert.ok(branch.length > 0);
  assert.deepEqual(branch, base);
  assert.equal(G.failuresAreInherited(branch, base), true);
  assert.equal(G.failuresAreInherited([...branch, 'app/api/c/d.test.ts'], base), false, 'a failure only the branch has is not inherited');
});

test('(xvi) settle with no memory headroom refuses, leaves the run exactly as it was, and a later settle succeeds', () => {
  const { run, wt } = scenario('nomem');
  commitIn(wt, 'c.txt', 'x\n');
  const before = S.loadRun('nomem', run.runId);
  process.env.APPMASTER_FAKE_FREE_GB = '1';
  process.env.APPMASTER_GATE_WAIT_MS = '30';
  process.env.APPMASTER_GATE_POLL_MS = '5';
  try {
    assert.throws(() => settle(run), (e) => e.reason === 'memory' && e.extra.needGb === C.MEM.gateMinFreeGb);
  } finally { delete process.env.APPMASTER_GATE_WAIT_MS; process.env.APPMASTER_FAKE_FREE_GB = '40'; }
  const after = S.loadRun('nomem', run.runId);
  assert.equal(after.state, before.state, 'the run is back in the state it was in (exited)');
  assert.equal(fs.existsSync(path.join(C.STATE_ROOT, '_headless-gate.lock')), false, 'no lock left behind');
  const out = settle(run);
  assert.equal(out.state, 'merged', out.heldReason);
});

// ---------------------------------------------------------------- the rest of the state machine

test('a usage limit in the stream -> released (not held, not failed) and the mark is set', () => {
  const { run, wt } = scenario('limited');
  commitIn(wt, 'c.txt', 'half done\n');
  fs.writeFileSync(path.join(C.runDir('limited', run.runId), 'stream.jsonl'),
    `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${JSON.stringify({ type: 'result', is_error: true, result: 'Claude AI usage limit reached|1760000000' })}\n`);
  const out = settle(run);
  assert.equal(out.state, 'released');
  assert.match(out.heldReason, /^usage limit/);
  assert.equal(L.readLimit().runId, run.runId);
  assert.ok(fs.existsSync(wt) && branchExists(out.project.root, run.branch), 'released keeps the work');
  assert.equal(S.loadAsks('limited').length, 0);
  L.clearLimit();
});

test('settle refuses a live worker and an undispatched run; a dirty worktree is held', () => {
  const { run, wt } = scenario('guards');
  const live = S.updateRun(run, { state: 'running', pid: process.pid });
  assert.throws(() => settle(live), (e) => e instanceof C.Refusal && e.reason === 'still running');
  const planned = S.newRun(run.project, { wakeId: 'w', charterSlug: 'c', reason: 'r', brief: 'b', model: 'm' });
  assert.throws(() => settle(planned), (e) => e instanceof C.Refusal && e.reason === 'not dispatched');

  commitIn(wt, 'c.txt', 'x\n');
  fs.writeFileSync(path.join(wt, 'c.txt'), 'uncommitted edit\n');
  const out = settle(S.updateRun(live, { state: 'running', pid: 999999 }));
  assertHeldWithAsk(out, 'guards');
  assert.match(out.heldReason, /uncommitted changes/);
});

test('parsePorcelain: quoted and octal-escaped paths, and the -z form', () => {
  assert.deepEqual(M.parsePorcelain(' M "a b.txt"\n?? "\\303\\251t\\303\\251.md"\nM  plain.txt\n'), ['a b.txt', 'été.md', 'plain.txt']);
  assert.deepEqual(M.parsePorcelain(' M a b.txt\0?? x/y.md\0', { z: true }), ['a b.txt', 'x/y.md']);
});

test('cleanup', () => {
  const wtRoot = C.WORKTREE_ROOT;
  for (const slug of fs.existsSync(wtRoot) ? fs.readdirSync(wtRoot) : []) {
    for (const id of fs.readdirSync(path.join(wtRoot, slug))) {
      const link = path.join(wtRoot, slug, id, 'node_modules');
      try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* none */ }
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
