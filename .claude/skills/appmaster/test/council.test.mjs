// The council lane: a review run settles `reviewed` from the council's own run directory (copied to the
// journal), never merged; a commit, a missing run directory or an unreadable result.json holds it; a full
// `ready` queues tier + report (the human gate); dispatch seeds the feature's history and the reviewer
// prompt; decide checks the feature, the rounds and one council per feature; the context shows each
// feature's state. Fixture DB + temp git repos + a node shim; never a real claude or app.
// Run: node --test .claude/skills/appmaster/test/council.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setupEnv, makeRepo, makeDb, demoBrief, IDS } from './wp1-fixture.mjs';

const env = setupEnv('council');
process.env.APPMASTER_WORKTREE_ROOT = path.join(env.tmp, 'worktrees');
process.env.APPMASTER_CLAUDE_BIN = path.join(env.tmp, 'shim.mjs');
process.env.APPMASTER_FAKE_FREE_GB = '64';
process.env.APPMASTER_GATE_POLL_MS = '5';
process.env.SHIM_OUT_DIR = path.join(env.tmp, 'shim-out');
fs.mkdirSync(process.env.SHIM_OUT_DIR, { recursive: true });
fs.writeFileSync(process.env.APPMASTER_CLAUDE_BIN, `
import fs from 'node:fs';
import path from 'node:path';
let stdin = '';
for await (const c of process.stdin) stdin += c;
const argv = process.argv.slice(2);
fs.writeFileSync(path.join(process.env.SHIM_OUT_DIR, argv[argv.indexOf('--session-id') + 1] + '.json'), JSON.stringify({ stdin }));
`);
makeRepo(env.demoRoot, 'main');
const app = makeDb(env);   // the "app": writable, test-only

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const W = await import('../lib/worker.mjs');
const WT = await import('../lib/worktree.mjs');
const M = await import('../lib/merge.mjs');
const Co = await import('../lib/council.mjs');
const V = await import('../lib/decision.mjs');
const X = await import('../lib/context.mjs');
const D = await import('../lib/dbread.mjs');
const O = await import('../lib/outbox.mjs');

const sh = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const CHARTERS = [{ slug: 'accepted-idea-delivery', priority: 1 }, { slug: 'council-lite-review', priority: 2 }, { slug: 'council-review', priority: 3 }];
S.saveBrief('demo', demoBrief(CHARTERS));
const project = { slug: 'demo', id: IDS.project, name: 'Demo', root: env.demoRoot, baseBranch: 'main' };
S.saveWake('demo', { wakeId: 'w-seed', slug: 'demo', at: C.nowIso(), status: 'context', project });

/** A review run with its worktree cut and its history seeded, as dispatch leaves it; state exited. */
function reviewRun(featureSlug, mode = 'lite', { before = [] } = {}) {
  let run = S.newRun(project, {
    wakeId: 'w-seed', charterSlug: mode === 'lite' ? 'council-lite-review' : 'council-review', reason: 'r', brief: `review ${featureSlug}`,
    ideaIds: [], model: C.MODELS.builder, paths: [], featureSlug, councilMode: mode, repo: 'self', repoRoot: env.demoRoot, repoBase: 'main',
  });
  const wt = WT.createWorktree(run, {});
  run = S.updateRun(run, { ...wt, state: 'exited', startedAt: C.nowIso(), endedAt: C.nowIso() });
  for (const [name, result] of before) writeCouncil(run.worktree, name, result);
  const seed = Co.seedCouncil(run, env.demoRoot);
  return S.updateRun(run, { councilSeeded: seed.present });
}
/** What the council writes: <runsRel>/<name>/{result.json, report.md, ...extra files}. */
function writeCouncil(worktree, name, result, files = {}) {
  const dir = path.join(worktree, C.COUNCIL.runsRel, name);
  fs.mkdirSync(dir, { recursive: true });
  if (result !== null) fs.writeFileSync(path.join(dir, 'result.json'), typeof result === 'string' ? result : JSON.stringify(result));
  for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); }
  return dir;
}
const claim = (run, dir) => fs.writeFileSync(path.join(C.runDir(run.slug, run.runId), 'result.json'), JSON.stringify({ status: 'done', councilRunDir: dir }));
const settle = (run, retry = false) => M.cmdSettle({ flags: { run: run.runId, ...(retry ? { retry: true } : {}) } });
const outboxOf = (run) => S.loadOutbox('demo').filter((e) => e.source?.runId === run.runId);
const RESULT = (outcome, extra = {}) => ({ outcome, overall: 0.5, coverage: 0.7, round_no: 1, must_address: ['Link the three tabs', 'Add the shared header'], summary: 'S', ...extra });

// ---------------------------------------------------------------- settle

test('a lite review with no commits settles `reviewed`: the run dir is copied to the journal, a council entry is queued, the worktree goes', () => {
  const run = reviewRun('org-journey');
  const dir = writeCouncil(run.worktree, '2026-10-07-org-journey-lite-r1', RESULT('fail'), { 'report.md': '# report\n' });
  claim(run, dir);
  const out = settle(run);
  assert.equal(out.state, 'reviewed', out.heldReason);
  assert.equal(out.council.outcome, 'fail');
  assert.equal(out.council.mode, 'lite');
  assert.equal(out.council.runDirName, '2026-10-07-org-journey-lite-r1');
  assert.deepEqual(out.council.mustAddress, ['Link the three tabs', 'Add the shared header']);
  assert.equal(out.verdict.councilRunDirFrom, 'claim');
  assert.equal(path.dirname(out.council.copyPath), C.councilDir('demo'));
  assert.ok(fs.existsSync(path.join(out.council.copyPath, 'result.json')), 'the durable copy holds the result');
  assert.equal(fs.existsSync(run.worktree), false, 'the worktree is removed');
  const ob = outboxOf(run);
  assert.deepEqual(ob.map((e) => e.kind), ['council']);
  assert.deepEqual(ob[0].payload, { projectId: IDS.project, runDir: out.council.copyPath, featureSlug: 'org-journey', mode: 'lite', outcome: 'fail' });
  assert.equal(M.cmdSettle({ flags: { run: run.runId } }).state, 'reviewed', 'settled once; a second settle returns it as it is');
});

test('dispatch of a review: the feature\'s earlier rounds and state.json are seeded, the reviewer prompt runs the council, no path collision', async () => {
  fs.mkdirSync(path.join(env.demoRoot, '.personas', 'council'), { recursive: true });
  fs.writeFileSync(path.join(env.demoRoot, C.COUNCIL.stateRel), JSON.stringify({ decisions: [{ subject_slug: 'org-journey', decision: 'rejected', reason: 'the header is missing' }] }));
  // a builder of the WHOLE repo is running: a review still dispatches beside it (it writes no code)
  const whole = S.saveRun({ ...S.newRun(project, { wakeId: 'w-seed', charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', ideaIds: [], model: C.MODELS.builder, paths: [] }), state: 'running', pid: 999999, worktree: path.join(env.tmp, 'fake') });
  const planned = S.newRun(project, { wakeId: 'w-seed', charterSlug: 'council-lite-review', reason: 'r', brief: 'Review the org journey.', ideaIds: [], model: C.MODELS.builder, paths: [], featureSlug: 'org-journey', councilMode: 'lite' });
  const run = W.cmdDispatch({ flags: { run: planned.runId } });
  assert.equal(run.state, 'running');
  assert.deepEqual(run.councilSeeded, ['2026-10-07-org-journey-lite-r1'], 'the earlier lite round came from the journal copy');
  assert.equal(run.councilSeed.expectedRound, 2);
  assert.equal(run.councilSeed.stateCopied, true);
  assert.ok(fs.existsSync(path.join(run.worktree, C.COUNCIL.runsRel, '2026-10-07-org-journey-lite-r1', 'result.json')));
  assert.ok(fs.existsSync(path.join(run.worktree, C.COUNCIL.stateRel)));
  const p = path.join(process.env.SHIM_OUT_DIR, `${run.sessionId}.json`);
  for (let i = 0; i < 100 && !fs.existsSync(p); i++) await new Promise((r) => setTimeout(r, 100));
  const { stdin } = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.match(stdin, /^# Council reviewer brief: Demo \(demo\)/);
  assert.ok(stdin.includes('Run `/council --lite org-journey` inside'));
  assert.ok(stdin.includes('this should be round 2') && stdin.includes('`2026-10-07-org-journey-lite-r1`'));
  assert.ok(stdin.includes('Review the org journey.') && stdin.includes('do NOT fall back to a full council'));
  assert.ok(!/\{\{\w+\}\}/.test(stdin));
  assert.equal(fs.readFileSync(W.runFile(run, 'brief.md'), 'utf8'), stdin);
  W.cmdRelease({ flags: { run: run.runId, reason: 'test' } });
  S.updateRun(whole, { state: 'released' });
});

test('a review whose branch carries a commit is held: a reviewer must not change code', () => {
  const run = reviewRun('billing-flow');
  fs.writeFileSync(path.join(run.worktree, 'a.txt'), 'the reviewer edited code\n');
  sh(run.worktree, 'add', 'a.txt'); sh(run.worktree, 'commit', '-q', '-m', 'oops');
  writeCouncil(run.worktree, '2026-10-07-billing-flow-lite-r1', RESULT('ready'));
  const out = settle(run);
  assert.equal(out.state, 'held');
  assert.match(out.heldReason, /a review run must not change code, and its branch carries 1 commit\(s\) \(a\.txt\)/);
  const ask = S.openAsks('demo').find((a) => a.askId === out.askId);
  assert.deepEqual(ask.options.map((o) => o.label), ['Discard the review', 'Settle again']);
  assert.match(ask.question, /council-lite-review of billing-flow\) in demo is held and its council verdict was not used/);
  assert.equal(outboxOf(run).filter((e) => e.kind === 'council').length, 0, 'nothing reaches the app from a held review');
  W.cmdRelease({ flags: { run: run.runId, reason: 'test' } });
});

test('no run dir of its own, a missing result.json, an unknown outcome: each holds; a fixed one settles on --retry', () => {
  const run = reviewRun('org-journey', 'lite', { before: [['2026-10-01-org-journey-lite-r1', RESULT('ready')]] });
  assert.deepEqual(run.councilSeeded, ['2026-10-01-org-journey-lite-r1', '2026-10-07-org-journey-lite-r1']);
  let out = settle(run);
  assert.equal(out.state, 'held');
  assert.match(out.heldReason, /no council run directory for org-journey was written in the worktree .* beside the 2 that were there before/, 'a directory that was there before is never taken for this run\'s');
  const dir = writeCouncil(run.worktree, '2026-10-08-org-journey-lite-r3', null);
  out = settle(run, true);
  assert.equal(out.state, 'held');
  assert.match(out.heldReason, /the council run directory 2026-10-08-org-journey-lite-r3 has no result\.json/);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ outcome: 'great' }));
  out = settle(run, true);
  assert.match(out.heldReason, /outcome "great" is not one of ready, fail, incomplete, stalled/);
  fs.writeFileSync(path.join(dir, 'result.json'), '{ not json');
  out = settle(run, true);
  assert.match(out.heldReason, /does not parse/);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(RESULT('ready', { round_no: 3 })));
  out = settle(run, true);
  assert.equal(out.state, 'reviewed', out.heldReason);
  assert.equal(out.verdict.councilRunDirFrom, 'discovered', 'no claim: found by convention');
  assert.equal(out.council.round, 3);
  assert.equal(S.openAsks('demo').filter((a) => a.question.startsWith(`Run ${C.shortId(run.runId)} `)).length, 0, 'its hold asks are closed');
});

test('a FULL council `ready` queues council, tier (major) and report (report.md, attachments, an Approval)', () => {
  const run = reviewRun('org-journey', 'full');
  writeCouncil(run.worktree, '2026-10-09-org-journey-r1', RESULT('ready', { overall: 0.81, coverage: 0.93 }), {
    'report.md': '# Council report: org journey\n\nReady.\n', 'screenshot.png': 'png-bytes', 'evidence/log.txt': 'log',
  });
  const out = settle(run);
  assert.equal(out.state, 'reviewed', out.heldReason);
  const ob = outboxOf(run);
  assert.deepEqual(ob.map((e) => e.kind).sort(), ['council', 'report', 'tier']);
  assert.deepEqual(ob.find((e) => e.kind === 'tier').payload, { projectId: IDS.project, featureSlug: 'org-journey', tier: 'major' });
  const rep = ob.find((e) => e.kind === 'report').payload;
  assert.equal(rep.projectId, IDS.project);
  assert.equal(rep.title, 'Council ready: org-journey (full council, round 1)');
  assert.ok(rep.content.startsWith('# Council report: org journey'));
  assert.deepEqual(rep.attachments.map((a) => a.caption), ['evidence/log.txt', 'screenshot.png']);
  assert.ok(rep.attachments.every((a) => a.path.startsWith(out.council.copyPath)), 'attachments point at the durable copy');
  assert.equal(rep.approval.title, 'Approve org-journey?');
  assert.equal(rep.approval.severity, 'info');
  assert.match(rep.approval.description, /overall 0\.81, coverage 0\.93\)\. The council never approves/);
  // a full council that is not ready sends no report
  const failing = reviewRun('billing-flow', 'full');
  writeCouncil(failing.worktree, '2026-10-09-billing-flow-r2', RESULT('fail'));
  assert.equal(settle(failing).state, 'reviewed');
  assert.deepEqual(outboxOf(failing).map((e) => e.kind), ['council']);
});

// ---------------------------------------------------------------- decide

test('decide: featureSlug required for a review, unknown features refused, one council per feature, round 4 refused', async () => {
  const brief = S.loadBrief('demo');
  const base = (dispatch, wakeId = 'w') => ({
    wakeId, dispatch, defer: CHARTERS.filter((c) => !dispatch.some((x) => x.charterSlug === c.slug)).map((c) => ({ charterSlug: c.slug, reason: 'later' })),
    asks: [], ideaVerdicts: [], say: null, note: 'n', nextWakeMinutes: 30,
  });
  const lite = (featureSlug, over = {}) => ({ charterSlug: 'council-lite-review', reason: 'r', brief: 'b', ideaIds: [], ...(featureSlug ? { featureSlug } : {}), ...over });
  const errs = (d) => V.validateDecision(d, { wakeId: 'w', brief }).errors;
  assert.ok(errs(base([lite(null)])).some((e) => /featureSlug is required for council-lite-review/.test(e)));
  assert.ok(errs(base([lite('Org Journey')])).some((e) => /must be a kebab-case feature slug/.test(e)));
  assert.ok(errs(base([lite('org-journey', { repo: 'desktop' })])).some((e) => /a council review runs in the project's own repo/.test(e)));
  assert.ok(errs(base([lite('org-journey'), { charterSlug: 'council-review', reason: 'r', brief: 'b', ideaIds: [], featureSlug: 'org-journey' }])).some((e) => /both review org-journey; one council at a time per feature/.test(e)));
  assert.deepEqual(errs(base([lite('org-journey'), { charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', ideaIds: [], paths: ['src/'] }])), [], 'a review needs no paths beside a builder');

  const decide = async (d) => {
    const wakeId = `w-${Math.random().toString(16).slice(2, 10)}`;
    S.saveWake('demo', { wakeId, slug: 'demo', at: C.nowIso(), status: 'context', project });
    const file = path.join(env.tmp, `${wakeId}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...d, wakeId }));
    return V.cmdDecide({ flags: { project: 'demo', wake: wakeId, file } });
  };
  await assert.rejects(decide(base([lite('no-such-feature')])), (e) => e.extra.errors.some((x) => /feature no-such-feature is not a dev_use_cases slug of demo/.test(x)));
  // no characters tracked on the base: the value member would report unmeasured, so a review is refused.
  // An untracked overlay does not count: a review worktree carries tracked files only.
  assert.deepEqual(Co.charactersOf(env.demoRoot, 'main'), { source: null });
  await assert.rejects(decide(base([lite('org-journey')])), (e) => e.extra.errors.some((x) => /council-lite-review is refused: demo tracks no characters on main/.test(x)));
  fs.mkdirSync(path.join(env.demoRoot, 'uat', 'characters'), { recursive: true });
  fs.writeFileSync(path.join(env.demoRoot, 'uat', 'characters', 'ops-lead.md'), '# Ops lead\n');
  assert.deepEqual(Co.charactersOf(env.demoRoot, 'main'), { source: null }, 'an untracked character is not on the base');
  sh(env.demoRoot, 'add', 'uat'); sh(env.demoRoot, 'commit', '-q', '-m', 'characters');
  assert.deepEqual(Co.charactersOf(env.demoRoot, 'main'), { source: 'uat/characters', count: 1 });
  // three lite rounds already used on billing-flow: a fourth is refused
  for (let i = 1; i <= 2; i++) {
    S.saveRun({ ...S.newRun(project, { wakeId: 'w-old', charterSlug: 'council-lite-review', reason: 'r', brief: 'b', model: 'm', featureSlug: 'billing-flow', councilMode: 'lite' }),
      state: 'reviewed', settledAt: C.nowIso(), council: { mode: 'lite', featureSlug: 'billing-flow', runDirName: `2026-10-0${i}-billing-flow-lite-r${i}`, outcome: 'fail', mustAddress: [`Refund fix ${i}`] } });
  }
  const third = await decide(base([lite('billing-flow')]));
  S.updateRun(S.loadRun('demo', third.runIds[0]), { state: 'reviewed', settledAt: new Date(Date.now() + 1000).toISOString(), council: { mode: 'lite', featureSlug: 'billing-flow', runDirName: '2026-10-03-billing-flow-lite-r3', outcome: 'fail', mustAddress: ['Refund fix 3'] } });
  await assert.rejects(decide(base([lite('billing-flow')])), (e) => e.extra.errors.some((x) => /feature billing-flow has used 3 lite council round\(s\); round 4 is refused \(stalled\)/.test(x)));
  // a council of kpi-board in flight: no second council of it (another charter, so only the feature clashes)
  const flying = S.saveRun({ ...S.newRun(project, { wakeId: 'w-old', charterSlug: 'council-lite-review', reason: 'r', brief: 'b', model: 'm', featureSlug: 'kpi-board', councilMode: 'lite' }), state: 'running', pid: 999999 });
  await assert.rejects(decide(base([{ charterSlug: 'council-review', reason: 'r', brief: 'b', ideaIds: [], featureSlug: 'kpi-board' }])),
    (e) => e.extra.errors.some((x) => new RegExp(`feature kpi-board already has a council run in flight: ${C.shortId(flying.runId)} council-lite-review \\(running\\)`).test(x)));
  S.updateRun(flying, { state: 'released' });
  const ok = await decide(base([{ charterSlug: 'council-review', reason: 'r', brief: 'b', ideaIds: [], featureSlug: 'kpi-board', paths: ['ignored/'] }]));
  const minted = S.loadRun('demo', ok.runIds[0]);
  assert.deepEqual([minted.featureSlug, minted.councilMode, minted.paths, minted.repo], ['kpi-board', 'full', [], 'self'], 'a review holds no paths');
  S.updateRun(minted, { state: 'released' });
});

// ---------------------------------------------------------------- the context

test('context: the COUNCIL section shows each feature\'s state (journal + app), rounds, must-address and what is in flight', async () => {
  const live = S.saveRun({ ...S.newRun(project, { wakeId: 'w-old', charterSlug: 'accepted-idea-delivery', reason: 'rework', brief: 'b', model: 'm', featureSlug: 'billing-flow', paths: ['src/billing/'] }), state: 'running', pid: 999999 });
  const r = await X.cmdContext({ flags: { project: 'demo' } });
  const doc = fs.readFileSync(r.path, 'utf8');
  assert.match(doc, /COUNCIL \(the quality gate\. Every feature passes council-lite/);
  assert.match(doc, /- 3 feature\(s\): lite-fail 1, full-ready 1, approved 1/);
  assert.match(doc, new RegExp(`- billing-flow: lite-fail · rounds lite 3/3, full 2/3 · in flight: ${C.shortId(live.runId)} accepted-idea-delivery running`));
  assert.match(doc, /must address: Refund fix 3/);
  assert.match(doc, /- org-journey: full-ready · rounds lite 2\/3, full 1\/3/);
  assert.match(doc, /- kpi-board: approved · rounds lite 0\/3, full 1\/3/, 'the operator\'s decision is newer than the app\'s ready run');
  assert.match(doc, /REQUIRES "featureSlug":"<a feature slug from COUNCIL>"/);
  assert.ok(doc.indexOf('billing-flow: lite-fail') < doc.indexOf('org-journey: full-ready'), 'what needs the master first');
  S.updateRun(live, { state: 'released' });
});

test('featureState: none, a mode-outcome, stalled, approved and rejected (a rejection reason is a must-address)', () => {
  const ev = (mode, outcome, at) => ({ featureSlug: 'f', mode, outcome, at, mustAddress: [`${mode} ${outcome}`] });
  assert.equal(Co.featureState('f', []).state, 'none');
  assert.equal(Co.featureState('f', [ev('lite', 'incomplete', '2026-10-01T00:00:00Z')]).state, 'lite-incomplete');
  assert.equal(Co.featureState('f', [ev('full', 'stalled', '2026-10-01T00:00:00Z')]).state, 'stalled');
  const rej = Co.featureState('f', [ev('full', 'ready', '2026-10-01T00:00:00Z')], [{ slug: 'f', decision: 'rejected', reason: 'wrong flow', decided_at: '2026-10-02 08:00:00' }]);
  assert.deepEqual([rej.state, rej.mustAddress], ['rejected', ['wrong flow']]);
  const later = Co.featureState('f', [ev('lite', 'ready', '2026-10-03T00:00:00Z')], [{ slug: 'f', decision: 'rejected', reason: 'x', decided_at: '2026-10-02 08:00:00' }]);
  assert.equal(later.state, 'lite-ready', 'a round after the decision is newer than it');
});

// ---------------------------------------------------------------- replay

function doors({ missing = [] } = {}) {
  const calls = [];
  const deny = (route) => { const e = new Error(`${route} -> 404: Not Found`); e.status = 404; throw e; };
  return {
    calls,
    async devTools(route, body) {
      calls.push([route, body ?? null]);
      if (missing.some((m) => route.startsWith(m))) deny(route);
      if (route === '/council/ingest') { app.prepare("insert into dev_council_runs (id, subject_id, round_no, outcome, run_dir, ingested_at) values (?, 's-x', 1, 'ready', ?, ?)").run(`cr-${calls.length}`, body.runDir, C.nowIso()); return { runId: `cr-${calls.length}` }; }
      if (/^\/use-cases\/[^/]+$/.test(route) && !body) return app.prepare('select id, slug, tier from dev_use_cases where project_id = ?').all(decodeURIComponent(route.split('/')[2])).map((r) => ({ ...r }));
      const tierRoute = route.match(/^\/use-cases\/([^/]+)\/tier$/);
      if (tierRoute) { app.prepare('update dev_use_cases set tier = ? where id = ?').run(body.tier, decodeURIComponent(tierRoute[1])); return { ok: true }; }
      if (route === '/reports') { app.prepare('insert into persona_reports (id, persona_id, title, content, created_at) values (?,?,?,?,?)').run(`rep-${calls.length}`, IDS.master, body.title, body.content, C.nowIso()); return { reportId: `rep-${calls.length}` }; }
      throw new Error(`unexpected ${route}`);
    },
  };
}
const entry = (kind, payload, extra = {}) => ({ id: `${kind}:t`, kind, slug: 'demo', projectId: IDS.project, payload, source: {}, queuedAt: C.nowIso(), state: 'queued', attempts: 0, ...extra });

test('replay council / tier / report: 404 keeps each queued, the door + a DB post-check replays it, a second replay skips it', async () => {
  const db = D.openDb();
  try {
    const runDir = path.join(C.councilDir('demo'), '2026-10-09-org-journey-r1');
    const c = entry('council', { projectId: IDS.project, runDir, featureSlug: 'org-journey', mode: 'full', outcome: 'ready' });
    let r = await O.replayEntry(c, { db, doors: doors({ missing: ['/council'] }) });
    assert.deepEqual([r.state, r.evidence], ['queued', 'route missing (404): POST /dev-tools/council/ingest']);
    const d1 = doors();
    r = await O.replayEntry(c, { db, doors: d1 });
    assert.equal(r.state, 'replayed', r.evidence);
    assert.deepEqual(d1.calls[0], ['/council/ingest', { projectId: IDS.project, runDir }]);
    r = await O.replayEntry(c, { db, doors: d1 });
    assert.match(r.evidence, /^already applied: council run/);

    const t = entry('tier', { projectId: IDS.project, featureSlug: 'org-journey', tier: 'major' });
    r = await O.replayEntry(t, { db, doors: doors({ missing: ['/use-cases/uc-'] }) });
    assert.deepEqual([r.state, r.evidence], ['queued', 'route missing (404): POST /dev-tools/use-cases/{useCaseId}/tier']);
    const d2 = doors();
    r = await O.replayEntry(t, { db, doors: d2 });
    assert.equal(r.state, 'replayed', r.evidence);
    assert.deepEqual(d2.calls.map(([route]) => route), [`/use-cases/${IDS.project}`, '/use-cases/uc-org/tier'], 'the id resolved by slug through the list route');
    assert.equal(app.prepare("select tier from dev_use_cases where id = 'uc-org'").get().tier, 'major');
    assert.match((await O.replayEntry(t, { db, doors: d2 })).evidence, /^already applied: org-journey is major/);

    const rep = entry('report', { projectId: IDS.project, title: 'Council ready: org-journey (full council, round 1)', content: '# r', attachments: [], approval: { title: 'Approve org-journey?', description: 'd', severity: 'info' } });
    r = await O.replayEntry(rep, { db, doors: doors({ missing: ['/reports'] }) });
    assert.deepEqual([r.state, r.evidence], ['queued', 'route missing (404): POST /dev-tools/reports']);
    const d3 = doors();
    r = await O.replayEntry(rep, { db, doors: d3 });
    assert.equal(r.state, 'replayed', r.evidence);
    assert.ok(r.created.reportId);
    assert.deepEqual(d3.calls[0][1].approval, { title: 'Approve org-journey?', description: 'd', severity: 'info' });
    r = await O.replayEntry({ ...rep, created: r.created }, { db, doors: d3 });
    assert.equal(r.state, 'skipped');
    assert.equal(d3.calls.length, 1, 'a report is never posted twice');
  } finally { db.close(); }
});

test('cleanup', () => {
  const wtRoot = C.WORKTREE_ROOT;
  for (const slug of fs.existsSync(wtRoot) ? fs.readdirSync(wtRoot) : []) {
    for (const id of fs.readdirSync(path.join(wtRoot, slug))) {
      const link = path.join(wtRoot, slug, id, 'node_modules');
      try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* none */ }
    }
  }
  app.close();
  fs.rmSync(env.tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });   // a shim may hold a handle briefly (EPERM)
});
