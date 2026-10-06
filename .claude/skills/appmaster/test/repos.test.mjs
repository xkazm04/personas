// Multi-repo runs: a dispatch may target a second repo the brief names; the worktree is cut from THAT
// repo, the gates and the merge are THAT repo's; paths stay disjoint per repo ROOT across all projects;
// a repo lane caps live runs per shared repo; a Personas-targeted run shares the one cargo target.
// Temp repos only: APPMASTER_PERSONAS_ROOT / APPMASTER_REGISTRY_ROOT point at throwaway checkouts.
// Run: node --test .claude/skills/appmaster/test/repos.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-repos-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
process.env.APPMASTER_CLAUDE_BIN = path.join(tmp, 'shim.mjs');
process.env.APPMASTER_HANDSHAKE = path.join(tmp, 'no-such-handshake.json');
process.env.PERSONAS_DB = path.join(tmp, 'no-such.db');
process.env.APPMASTER_PERSONAS_ROOT = path.join(tmp, 'repos', 'personas');
process.env.APPMASTER_REGISTRY_ROOT = path.join(tmp, 'repos', 'registry');
process.env.APPMASTER_FAKE_FREE_GB = '64';
process.env.APPMASTER_GATE_POLL_MS = '5';
process.env.SHIM_OUT_DIR = path.join(tmp, 'shim-out');
fs.mkdirSync(process.env.SHIM_OUT_DIR, { recursive: true });
fs.writeFileSync(process.env.APPMASTER_CLAUDE_BIN, `
import fs from 'node:fs';
import path from 'node:path';
let stdin = '';
for await (const c of process.stdin) stdin += c;
const argv = process.argv.slice(2);
const sid = argv[argv.indexOf('--session-id') + 1];
fs.writeFileSync(path.join(process.env.SHIM_OUT_DIR, sid + '.json'), JSON.stringify({ env: process.env, stdin, cwd: process.cwd() }));
`);

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const W = await import('../lib/worker.mjs');
const WT = await import('../lib/worktree.mjs');
const M = await import('../lib/merge.mjs');
const R = await import('../lib/repos.mjs');
const V = await import('../lib/decision.mjs');
const O = await import('../lib/onboard.mjs');
const Q = await import('../lib/queue.mjs');

const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function makeRepo(root, branch) {
  fs.mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', branch);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', path.join(tmp, 'no-hooks')]]) sh(root, 'config', k, v);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  sh(root, 'add', 'a.txt');
  sh(root, 'commit', '-q', '-m', 'init');
  return root;
}
const PERSONAS = makeRepo(process.env.APPMASTER_PERSONAS_ROOT, 'master');
const REGISTRY = makeRepo(process.env.APPMASTER_REGISTRY_ROOT, 'main');
const SHARED = makeRepo(path.join(tmp, 'repos', 'shared'), 'trunk');   // a repo two projects share, with no lane
const CHARTERS = ['accepted-idea-delivery', 'project-kpi-stewardship', 'technical-decision-capture'].map((slug) => ({ slug, priority: null }));
const REPOS = [
  { key: 'desktop', root: PERSONAS, baseBranch: 'master' },
  { key: 'registry', root: REGISTRY, baseBranch: 'main', gates: { typecheck: 'node -e "process.exit(0)"' } },
  { key: 'shared', root: SHARED, baseBranch: 'trunk' },
];
const projects = {};
function project(slug, repos = REPOS) {
  if (projects[slug]) return projects[slug];
  const root = makeRepo(path.join(tmp, 'repos', slug), 'main');
  S.saveBrief(slug, { headless: true, charters: CHARTERS, gates: { typecheck: 'exit 1' }, repos });   // the PROJECT's gate fails: a second repo must not use it
  return (projects[slug] = { slug, id: `p-${slug}`, name: slug, root, baseBranch: 'main' });
}
function plan(slug, repo, paths, charter = 'accepted-idea-delivery') {
  const p = project(slug);
  return S.newRun(p, { wakeId: `w-${slug}`, charterSlug: charter, reason: 'r', brief: `work in ${repo}`, ideaIds: [], model: C.MODELS.builder, paths, ...R.resolveRepo(p, S.loadBrief(slug), repo) });
}
const refusal = (fn) => { try { fn(); } catch (e) { if (e instanceof C.Refusal) return e; throw e; } assert.fail('expected a Refusal'); };
const hold = (run) => S.saveRun({ ...run, state: 'running', pid: 999999, startedAt: C.nowIso(), worktree: path.join(tmp, 'fake-wt', run.runId) });
function reset() {
  for (const s of S.listSlugs()) for (const r of S.listRuns(s, { states: C.LIVE_RUN_STATES })) S.updateRun(r, { state: 'released' });
  fs.rmSync(C.queuePath(), { force: true });
}
async function shimRecord(run) {
  const p = path.join(process.env.SHIM_OUT_DIR, `${run.sessionId}.json`);
  for (let i = 0; i < 150; i++) { if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* mid-write */ } } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('the shim never ran');
}

test('the contract: REPO_LANES holds the Personas repo and the registry at one live run each', () => {
  assert.equal(C.REPO_LANES[C.normRoot(PERSONAS)], 1);
  assert.equal(C.REPO_LANES[C.normRoot(REGISTRY)], 1);
  assert.equal(C.normRoot(`${PERSONAS}${path.sep}`), C.normRoot(PERSONAS), 'a trailing separator is the same root');
  assert.equal(C.PERSONAS_CARGO_TARGET, path.join(PERSONAS, 'src-tauri', 'target'));
  assert.deepEqual(C.repoOf({ project: { root: 'X', baseBranch: 'b' } }), { key: 'self', root: 'X', baseBranch: 'b' }, 'an older run targets its project');
});

test('onboard validates repos: key, absolute root, base branch, lane, gates', () => {
  const ok = O.validateBrief({ charters: CHARTERS, repos: REPOS });
  assert.deepEqual(ok.errors, []);
  const bad = O.validateBrief({ charters: CHARTERS, repos: [{ key: 'self', root: 'rel/path', baseBranch: '' }, { key: 'x', root: PERSONAS, baseBranch: 'm', lane: 0, gates: { test: 3 } }, { key: 'x', root: PERSONAS, baseBranch: 'm' }] });
  for (const re of [/repos\[0\]\.key must be a kebab-case key other than "self"/, /repos\[0\]\.root must be the absolute path/, /repos\[0\]\.baseBranch/, /repos\[1\]\.lane must be a positive integer/, /repos\[1\]\.gates must map/, /repos\[2\]\.key "x" is listed twice/]) {
    assert.ok(bad.errors.some((e) => re.test(e)), `${re} in ${JSON.stringify(bad.errors)}`);
  }
});

test('decide: an unknown repo key is refused; a known one is recorded as repo, repoRoot and repoBase', async () => {
  const p = project('alpha');
  const wake = (id) => S.saveWake('alpha', { wakeId: id, slug: 'alpha', at: C.nowIso(), status: 'context', project: p });
  const decision = (wakeId, repo) => ({
    wakeId, dispatch: [{ charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', ideaIds: [], paths: ['src/'], repo }],
    defer: [{ charterSlug: 'project-kpi-stewardship', reason: 'later' }, { charterSlug: 'technical-decision-capture', reason: 'later' }],
    asks: [], ideaVerdicts: [], say: null, note: 'n', nextWakeMinutes: 30,
  });
  const file = (d) => { const f = path.join(tmp, `d-${d.wakeId}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
  wake('w-bad');
  await assert.rejects(V.cmdDecide({ flags: { project: 'alpha', wake: 'w-bad', file: file(decision('w-bad', 'mars')) } }),
    (e) => e.reason === 'invalid decision' && e.extra.errors.some((x) => /dispatch\[0\]\.repo "mars" is not a repo of this project \(one of: self, desktop, registry, shared/.test(x)));
  wake('w-ok');
  const r = await V.cmdDecide({ flags: { project: 'alpha', wake: 'w-ok', file: file(decision('w-ok', 'registry')) } });
  const run = S.loadRun('alpha', r.runIds[0]);
  assert.deepEqual([run.repo, run.repoRoot, run.repoBase], ['registry', REGISTRY, 'main']);
  // two dispatches in DIFFERENT repos may name the same paths
  const two = { ...decision('w-two', 'desktop'), dispatch: [{ charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', ideaIds: [], paths: ['src/'], repo: 'desktop' }, { charterSlug: 'project-kpi-stewardship', reason: 'r', brief: 'b', ideaIds: [], paths: ['src/'] }], defer: [{ charterSlug: 'technical-decision-capture', reason: 'later' }] };
  assert.deepEqual(V.validateDecision(two, { wakeId: 'w-two', brief: S.loadBrief('alpha') }), { ok: true, errors: [] });
  assert.equal(V.validateDecision({ ...two, dispatch: two.dispatch.map((x) => ({ ...x, repo: 'shared' })) }, { wakeId: 'w-two', brief: S.loadBrief('alpha') }).ok, false, 'the same repo still needs disjoint paths');
  S.updateRun(run, { state: 'released' });
});

test('paths overlap is keyed by the target repo ROOT across ALL projects', () => {
  reset();
  const a = hold(plan('alpha', 'shared', ['lib/x/']));
  const e = refusal(() => W.cmdDispatch({ flags: { run: plan('beta', 'shared', ['lib/']).runId } }));
  assert.equal(e.reason, 'paths overlap', 'beta collides with alpha in their shared repo');
  assert.equal(e.extra.with[0].slug, 'alpha');
  assert.equal(e.extra.with[0].runId8, C.shortId(a.runId));
  assert.equal(e.extra.queued, true, 'and it waits in the queue');
  // the same paths in each project's OWN repo do not collide
  const own = W.cmdDispatch({ flags: { run: plan('beta', 'self', ['lib/x/']).runId } });
  assert.equal(own.state, 'running');
  W.cmdRelease({ flags: { run: own.runId, reason: 'test', kill: true } });
  reset();
});

test('repo lane: the registry carries one live run across all projects; a brief lane tightens a free repo', () => {
  reset();
  hold(plan('alpha', 'registry', ['knowledge/a/']));
  const e = refusal(() => W.cmdDispatch({ flags: { run: plan('beta', 'registry', ['knowledge/b/']).runId } }));
  assert.equal(e.reason, 'repo lane');
  assert.equal(e.extra.lane, 1);
  assert.equal(e.extra.queued, true);
  assert.equal(Q.queueTable()[0].reason, 'repo lane');
  assert.equal(Q.queueTable()[0].repo, 'registry');
  assert.equal(R.laneFor(SHARED), null, 'no lane on a repo nobody limited');
  S.saveBrief('gamma', { ...S.loadBrief('alpha'), repos: [...REPOS.filter((r) => r.key !== 'shared'), { key: 'shared', root: SHARED, baseBranch: 'trunk', lane: 1 }] });
  projects.gamma = { slug: 'gamma', id: 'p-gamma', name: 'gamma', root: makeRepo(path.join(tmp, 'repos', 'gamma'), 'main'), baseBranch: 'main' };
  assert.equal(R.laneFor(SHARED), 1, 'one brief\'s lane binds every project in that repo');
  hold(plan('gamma', 'shared', ['one/']));
  assert.equal(refusal(() => W.cmdDispatch({ flags: { run: plan('alpha', 'shared', ['two/']).runId } })).reason, 'repo lane');
  reset();
});

test('a run in the Personas repo gets CARGO_TARGET_DIR (builder AND gates); a run in its own repo does not', async () => {
  reset();
  const desk = W.cmdDispatch({ flags: { run: plan('alpha', 'desktop', ['src/']).runId } });
  const rec = await shimRecord(desk);
  assert.equal(rec.env.CARGO_TARGET_DIR, C.PERSONAS_CARGO_TARGET);
  assert.ok(rec.stdin.includes('`desktop`, a second repo') && rec.stdin.includes(`main checkout is \`${PERSONAS}\``), 'the builder is told which repo it is in');
  assert.ok(rec.stdin.includes('never override it or start a second Rust build tree'));
  assert.equal(fs.realpathSync(rec.cwd).toLowerCase(), fs.realpathSync(desk.worktree).toLowerCase());
  assert.equal(sh(desk.worktree, 'rev-parse', 'HEAD'), sh(PERSONAS, 'rev-parse', 'master'), 'cut from the Personas base, not the project\'s');
  const own = W.cmdDispatch({ flags: { run: plan('beta', 'self', ['src/']).runId } });
  const ownRec = await shimRecord(own);
  assert.equal(ownRec.env.CARGO_TARGET_DIR === C.PERSONAS_CARGO_TARGET, false, 'only a Personas-targeted run shares that target');
  // the gate env: a Personas run's gate sees the same target
  const probe = path.join(tmp, 'cargo-probe.cjs').replace(/\\/g, '/');
  fs.writeFileSync(probe, `process.exit(process.env.CARGO_TARGET_DIR === ${JSON.stringify(C.PERSONAS_CARGO_TARGET)} ? 0 : 3)`);
  const G = await import('../lib/gate.mjs');
  assert.equal(G.runGates(desk.worktree, { typecheck: `node ${probe}` }, { only: ['typecheck'], env: C.repoEnv(PERSONAS) }).typecheck.ok, true);
  reset();
});

test('settle a run in a second repo: its gates, its base branch, its checkout; the project checkout is untouched', () => {
  reset();
  const p = project('delta');
  let run = plan('delta', 'registry', ['knowledge/']);
  const wt = WT.createWorktree(run, {});
  run = S.updateRun(run, { ...wt, state: 'exited', startedAt: C.nowIso(), endedAt: C.nowIso() });
  fs.mkdirSync(path.join(wt.worktree, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(wt.worktree, 'knowledge', 'k.md'), 'k\n');
  sh(wt.worktree, 'add', 'knowledge/k.md'); sh(wt.worktree, 'commit', '-q', '-m', 'forge');
  const tip = sh(wt.worktree, 'rev-parse', 'HEAD');
  const projectHead = sh(p.root, 'rev-parse', 'HEAD');
  const out = M.cmdSettle({ flags: { run: run.runId } });
  assert.equal(out.state, 'merged', out.heldReason);
  assert.equal(out.mergedSha, tip);
  assert.equal(sh(REGISTRY, 'rev-parse', 'main'), tip, 'merged into the registry\'s base branch');
  assert.equal(sh(p.root, 'rev-parse', 'HEAD'), projectHead, 'the project\'s own checkout did not move');
  assert.equal(out.verdict.gates.typecheck.command, 'node -e "process.exit(0)"', 'the registry\'s gate from repos[].gates, not the project\'s failing one');
  const tc = S.loadOutbox('delta').find((e) => e.kind === 'task-complete');
  assert.equal(tc.payload.repo, 'registry');
  assert.equal(tc.projectId, 'p-delta', 'the outbox stays keyed by the project');
  // dirty overlap is checked in the TARGET checkout
  let run2 = plan('delta', 'registry', ['knowledge/']);
  const wt2 = WT.createWorktree(run2, {});
  run2 = S.updateRun(run2, { ...wt2, state: 'exited', startedAt: C.nowIso() });
  fs.writeFileSync(path.join(wt2.worktree, 'a.txt'), 'builder\n'); sh(wt2.worktree, 'add', 'a.txt'); sh(wt2.worktree, 'commit', '-q', '-m', 'edit a');
  fs.writeFileSync(path.join(REGISTRY, 'a.txt'), 'operator wip in the registry\n');
  const held = M.cmdSettle({ flags: { run: run2.runId } });
  assert.equal(held.state, 'held');
  assert.match(held.heldReason, /uncommitted changes in the checkout overlap the branch: a\.txt/);
  assert.match(S.openAsks('delta').find((a) => a.askId === held.askId).question, /its registry repo/);
  sh(REGISTRY, 'checkout', '--', 'a.txt');
});

test('cleanup', () => {
  reset();
  const wtRoot = C.WORKTREE_ROOT;
  for (const slug of fs.existsSync(wtRoot) ? fs.readdirSync(wtRoot) : []) {
    for (const id of fs.readdirSync(path.join(wtRoot, slug))) {
      const link = path.join(wtRoot, slug, id, 'node_modules');
      try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* none */ }
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
