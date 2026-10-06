// WP1: dbread + context + digest against a FIXTURE app DB and temp git checkouts. Never touches the
// real app DB or the real .claude/master tree (setupEnv points every path at a temp dir).
// Run: node --test .claude/skills/appmaster/test/context.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupEnv, makeRepo, makeDb, demoBrief, IDS } from './wp1-fixture.mjs';

const env = setupEnv('ctx');
makeRepo(env.demoRoot, 'main', { autopilot: 'autopilot/x-1', dirty: true });
makeRepo(env.bareRoot, 'master');
const fixture = makeDb(env);

const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const D = await import('../lib/dbread.mjs');
const X = await import('../lib/context.mjs');
const G = await import('../lib/digest.mjs');
const B = await import('../lib/brakes.mjs');

const CHARTERS = [
  { slug: 'project-kpi-stewardship', priority: 1 },
  { slug: 'accepted-idea-delivery', priority: 2 },
  { slug: 'made-up-charter', priority: null },
];
const HEADINGS = ["OWNER'S BRIEF", 'RIGHT NOW (UTC):', 'HOW TO DECIDE', 'ALREADY WITH THE OPERATOR', 'ANSWERED SINCE YOUR LAST WAKE',
  'WHAT THE OPERATOR SAID', 'YOUR CHARTERS', 'PROJECT STATE', 'MACHINE', 'ANSWER WITH ONE JSON OBJECT AND NOTHING ELSE'];

test('every DatabaseSync open in lib/*.mjs is readOnly', () => {
  const dir = new URL('../lib/', import.meta.url);
  let opens = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    // comments may name the call; only code is checked
    const src = fs.readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/new\s+DatabaseSync\s*\(([^)]*)\)/g)) {
      opens++;
      assert.match(m[1], /readOnly:\s*true/, `${f}: ${m[0]} is not read-only`);
    }
  }
  assert.ok(opens >= 1, 'the grep found no DatabaseSync open at all: the matcher is broken');
});

test('resolveProject: by name, slug and id; base branch falls back to the branch that exists', () => {
  const p = D.resolveProject('demo');
  assert.equal(p.id, IDS.project); assert.equal(p.baseBranch, 'main'); assert.equal(p.baseBranchNote, undefined);
  assert.equal(D.resolveProject(IDS.project).slug, 'demo');
  const bare = D.resolveProject('Bare');
  assert.equal(bare.baseBranch, 'master');
  assert.match(bare.baseBranchNote, /main_branch is main; the checkout has master/);
  assert.throws(() => D.resolveProject('nope'), /no dev_projects row/);
});

test('chartersFor: brief decides which; text from db, then template, then the slug alone', () => {
  const d = D.openDb();
  try {
    const cs = D.chartersFor(d, IDS.project, demoBrief(CHARTERS));
    assert.deepEqual(cs.map((c) => [c.slug, c.source]), [
      ['project-kpi-stewardship', 'db'], ['accepted-idea-delivery', 'template'], ['made-up-charter', 'slug-only']]);
    assert.equal(cs[0].need, 'NEED-FROM-DB'); assert.equal(cs[0].coreAction, 'CORE-FROM-DB'); assert.equal(cs[0].pacingNote, 'NOTE-FROM-DB');
    assert.ok(cs[1].coreAction.length > 20, 'the template core action was read');
    assert.equal(D.masterPersona(d, IDS.bare), null);
    assert.equal(D.chartersFor(d, IDS.bare, demoBrief(CHARTERS))[0].source, 'template');
  } finally { d.close(); }
});

test('projectSnapshot ports the in-app sensors', () => {
  const d = D.openDb();
  try {
    const s = D.projectSnapshot(d, D.resolveProject('demo'));
    assert.equal(s.acceptedNoTask.count, 1);
    assert.equal(s.acceptedNoTask.oldest[0].id, IDS.ideaAccepted);
    assert.equal(s.pendingCount, 3); assert.equal(s.unratedCount, 1);
    assert.deepEqual(s.kpis, { active: 2, unmeasured: 1, unmeasuredNames: ['Unmeasured KPI'] });
    assert.equal(s.inFlightTasks.length, 1);
    assert.equal(s.gitBranches.total, 1); assert.equal(s.gitBranches.branches[0].ahead, 1);
    assert.equal(s.checkout.dirty, 1); assert.equal(s.checkout.branch, 'main');
    assert.equal(s.goals[0].status, 'in-progress', 'open goals first');
    assert.deepEqual(s.readErrors, []);
  } finally { d.close(); }
});

test('context refuses without a brief and names onboard', async () => {
  await assert.rejects(X.cmdContext({ flags: { project: 'demo' } }), /run onboard first/);
});

test('context: writes the doc and a context wake line; every section with an input renders', async () => {
  S.saveBrief('demo', demoBrief(CHARTERS));
  const r = await X.cmdContext({ flags: { project: 'demo' } });
  assert.equal(r.slug, 'demo'); assert.equal(r.due, true);
  assert.ok(fs.existsSync(r.path));
  assert.equal(path.dirname(r.path), C.contextDir('demo'));
  assert.deepEqual(Object.keys(r.brakes).sort(), ['limit', 'memory', 'running']);
  const w = S.loadWake('demo', r.wakeId);
  assert.equal(w.status, 'context'); assert.equal(w.project.id, IDS.project);
  const doc = fs.readFileSync(r.path, 'utf8');
  for (const h of HEADINGS.filter((h) => h !== 'ANSWERED SINCE YOUR LAST WAKE')) assert.ok(doc.includes(h), `missing ${h}`);
  for (const s of ['NOTE-FROM-DB', 'Pending in the app', 'Please focus on goal one', IDS.ideaAccepted, IDS.ideaVerdict,
    'autopilot/x-1: 1 ahead', 'with 1 uncommitted path', 'Unmeasured KPI', 'text from template', 'text from slug-only',
    'never touch secrets/', 'CLAUDE.md', `"wakeId":"${r.wakeId}"`, 'Charter slugs: project-kpi-stewardship, accepted-idea-delivery, made-up-charter',
    'first headless wake']) {
    assert.ok(doc.includes(s), `doc lacks ${s}`);
  }
  assert.ok(!doc.includes('# demo'), 'CLAUDE.md is referenced by path, never inlined');
  assert.ok(doc.length <= X.MAX_CONTEXT_CHARS);
});

test('context: due follows the latest nextWakeAt; the prior note and answered asks are quoted', async () => {
  const first = S.loadWakes('demo').at(-1);
  S.saveWake('demo', { wakeId: first.wakeId, status: 'decided', nextWakeAt: new Date(Date.now() + 3600e3).toISOString(), note: 'MY-PRIOR-NOTE',
    decision: { wakeId: first.wakeId, dispatch: [], defer: CHARTERS.map((c) => ({ charterSlug: c.slug, reason: `wait ${c.slug}` })), asks: [], ideaVerdicts: [], say: null, note: 'MY-PRIOR-NOTE', nextWakeMinutes: 60 } });
  const ask = S.raiseAsk('demo', { wakeId: first.wakeId, source: 'master', kind: 'scope', question: 'Which scope?', context: 'c', options: [{ label: 'A', action: 'a' }, { label: 'B', action: 'b' }] });
  S.updateAsk('demo', ask.askId, { state: 'answered', answer: { choice: 'A', notes: 'go A', at: new Date(Date.now() + 1000).toISOString() } });
  S.appendChannel('demo', 'TERMINAL-SAID-THIS', 'operator');
  const r = await X.cmdContext({ flags: { project: 'demo' } });
  assert.equal(r.due, false);
  const doc = fs.readFileSync(r.path, 'utf8');
  for (const s of ['"MY-PRIOR-NOTE"', 'You chose to sleep 60 minutes', 'ANSWERED SINCE YOUR LAST WAKE', 'chosen: A - notes: go A',
    'TERMINAL-SAID-THIS', 'deferred', 'wait accepted-idea-delivery']) assert.ok(doc.includes(s), `doc lacks ${s}`);
  assert.equal(X.isDue(S.loadWakes('demo'), Date.now() + 2 * 3600e3), true);
});

test('context degrades honestly for a project with no master persona and no goals (the pof shape)', async () => {
  S.saveBrief('bare', demoBrief([{ slug: 'project-kpi-stewardship', priority: 1 }]));
  const r = await X.cmdContext({ flags: { project: 'bare' } });
  const doc = fs.readFileSync(r.path, 'utf8');
  assert.match(doc, /has no App Master persona in the app/);
  assert.match(doc, /goals: 0 set on this project/);
  assert.match(doc, /- none open: nothing you asked is waiting on the operator/);
  assert.match(doc, /base branch: master \(dev_projects.main_branch is main/);
  assert.match(doc, /unmerged autopilot branches: none/);
});

test('renderContext is pure, steps down its budget, and ends cut lists with +N more', () => {
  const now = '2026-10-05T10:00:00.000Z';
  const big = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const input = {
    wakeId: 'w-pure', now, project: { slug: 'big', id: 'pid', name: 'Big', root: 'C:/x/big', baseBranch: 'main' }, master: { id: 'm', name: 'App Master Big' },
    brief: demoBrief([]), lastWake: { at: '2026-10-04T10:00:00.000Z', nextWakeMinutes: 240, note: 'QUOTED-NOTE' },
    charters: big(8, (i) => ({ slug: `charter-${i}`, title: `Charter ${i}`, priority: i % 5 + 1, need: 'n'.repeat(900), coreAction: 'c'.repeat(900), pacingNote: 'p'.repeat(500), source: 'db' })),
    asks: { open: big(9, (i) => ({ kind: 'scope', question: `open ask ${i} ${'q'.repeat(300)}`, raisedAt: now })), appPending: [], answered: [] },
    channel: { journal: big(9, (i) => ({ at: now, message: `said ${i} ${'m'.repeat(900)}`, from: 'operator' })), app: [] },
    runs: { live: [], recent: [] },
    snapshot: {
      goals: big(40, (i) => ({ id: `goal-${i}-xxxx`, title: `Goal ${i} ${'t'.repeat(200)}`, status: 'in-progress', progress: 10, ideas: 1, tasks: 0, completed_tasks: 0 })),
      acceptedNoTask: { count: 70, oldest: big(8, (i) => ({ id: `idea-${i}`, title: 'x'.repeat(300) })) },
      pendingCount: 50, unratedCount: 5, pendingSample: big(8, (i) => ({ id: `pend-${i}`, title: 'y'.repeat(300), effort: 1, impact: 2, risk: 3 })),
      kpis: { active: 90, unmeasured: 80, unmeasuredNames: big(5, (i) => `kpi ${i}`) }, inFlightTasks: [],
      gitBranches: { total: 30, branches: big(10, (i) => ({ branch: `autopilot/b-${i}`, at: now, ahead: 1, behind: 2 })) },
      checkout: { branch: 'main', dirty: 3 }, readErrors: [],
    },
    machine: { memory: { usedPct: 70, freeGb: 3, totalGb: 64, dispatchNeedGb: 4, stop: true }, limit: { limited: true, reason: 'usage limit', resetsAt: now }, running: { project: 0, global: 1 } },
    docs: ['C:/x/big/CLAUDE.md'],
  };
  const a = X.renderContext(input), b = X.renderContext(input);
  assert.equal(a, b, 'pure: same input, same text');
  assert.ok(a.length <= X.MAX_CONTEXT_CHARS, `doc is ${a.length} chars`);
  assert.ok(X.renderAt(input, X.BUDGET_LEVELS[0]).length > X.MAX_CONTEXT_CHARS, 'the fixture really needed the step-down');
  for (const h of HEADINGS.filter((h) => !h.startsWith('ANSWERED'))) assert.ok(a.includes(h), `missing ${h}`);
  assert.match(a, /\+\d+ more/);
  assert.match(a, /"QUOTED-NOTE"/);
  assert.match(a, /TRIPPED NOW/);
  assert.match(a, /LIMITED \(usage limit\)/);
  assert.match(a, /AWAITING A MERGE \(30 unmerged/);
});

test('limit mark: absent, standing, and expired (reads cleared)', () => {
  assert.equal(B.readLimitMark().limited, false);
  fs.writeFileSync(C.limitPath(), JSON.stringify({ limitedAt: C.nowIso(), reason: 'hit your limit', resetsAt: new Date(Date.now() + 3600e3).toISOString() }));
  assert.equal(B.readLimitMark().limited, true);
  fs.writeFileSync(C.limitPath(), JSON.stringify({ limitedAt: C.nowIso(), reason: 'old', resetsAt: '2020-01-01T00:00:00Z' }));
  const m = B.readLimitMark();
  assert.equal(m.limited, false); assert.equal(m.expired, true);
  fs.rmSync(C.limitPath());
});

test('status: per project record, stream age, and a text digest where quiet projects take one line', async () => {
  const run = S.newRun(D.resolveProject('demo'), { wakeId: 'w1', charterSlug: 'project-kpi-stewardship', reason: 'r', brief: 'b', model: C.MODELS.builder });
  S.updateRun(run, { state: 'running' });
  fs.writeFileSync(path.join(C.runDir('demo', run.runId), 'stream.jsonl'), '{}\n');
  const st = await G.cmdStatus({ flags: {} });
  assert.deepEqual(st.projects.map((p) => p.slug), ['bare', 'demo']);
  const demo = st.projects.find((p) => p.slug === 'demo');
  assert.equal(demo.running.length, 1); assert.equal(demo.running[0].runId8, C.shortId(run.runId));
  assert.equal(demo.running[0].streamAgeMin, 0);
  assert.equal(demo.asksOpen, 0); assert.equal(demo.lastNote, 'MY-PRIOR-NOTE');
  assert.equal(st.caps.running, 1); assert.equal(st.caps.global, C.GLOBAL_CAP);
  assert.ok('memory' in st.brakes && 'limit' in st.brakes);
  const txt = await G.cmdStatus({ flags: { text: true } });
  assert.equal(txt.__text, true);
  assert.match(txt.text, /^Machine: [\d.]+ GB free/);
  assert.match(txt.text, /^bare - quiet, no decision yet, due now.$/m);
  assert.match(txt.text, /Running [0-9a-f]{8} project-kpi-stewardship \(claude-sonnet-5-5\), last output 0 min ago/);
  const one = await G.cmdStatus({ flags: { project: 'Demo' } });
  assert.deepEqual(one.projects.map((p) => p.slug), ['demo']);
});

test('two builders per project: the context shows each live run\'s model and paths, the free slots, and the paths/model contract', () => {
  const now = '2026-10-06T10:00:00.000Z';
  const doc = X.renderContext({
    wakeId: 'w-two', now, project: { slug: 'two', id: 'pid', name: 'Two', root: 'C:/x/two', baseBranch: 'main' }, master: { id: 'm' },
    brief: demoBrief([]), lastWake: null, charters: [{ slug: 'accepted-idea-delivery', title: 'Delivery', priority: 1, source: 'template' }],
    runs: { live: [
      { runId: 'aaaaaaaa-1111', charterSlug: 'codebase-security-scan', state: 'running', model: 'claude-opus-5', paths: ['src/auth/', 'src/api/'], createdAt: now },
      { runId: 'bbbbbbbb-2222', charterSlug: 'old-run', state: 'exited', createdAt: now },
    ], recent: [] },
    snapshot: { checkout: { branch: 'main', dirty: 0 } },
    machine: { memory: { freeGb: 30, dispatchNeedGb: 5.5 }, limit: { limited: false }, running: { project: 1, global: 3 } },
  });
  assert.match(doc, /aaaaaaaa codebase-security-scan running \(claude-opus-5\).*; paths: src\/auth\/, src\/api\//);
  assert.match(doc, /bbbbbbbb old-run exited .*paths: none declared \(the whole repo\)/);
  assert.match(doc, new RegExp(`dispatch AT MOST ${C.MAX_DISPATCH} charters \\(${C.PER_PROJECT_CAP} builders per project, ${C.GLOBAL_CAP} in all; running now: 1 here, 3 in all; free slots: 1 here, 5 in all\\)`));
  assert.match(doc, /Two at once ONLY when each is independent/);
  assert.match(doc, /MODEL: per dispatch, `model` "opus" for discovery/);
  assert.match(doc, /1 of 2 in this project \(1 slot\(s\) free\), 3 of 8 across all projects \(5 free\)/);
  assert.match(doc, /"model":"sonnet\|opus","paths":\[/);
  assert.match(doc, /with two each carries non-empty disjoint paths/);
  assert.deepEqual(X.freeSlots({ project: 2, global: 9 }), { project: 0, global: 0 });
});

test('status --text names each running run\'s model and its paths', async () => {
  const run = S.newRun(D.resolveProject('demo'), { wakeId: 'w2', charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', model: C.MODELS.master, paths: ['src/x/'] });
  S.updateRun(run, { state: 'running' });
  const st = await G.cmdStatus({ flags: {} });
  assert.deepEqual(st.projects.find((p) => p.slug === 'demo').running.find((r) => r.runId8 === C.shortId(run.runId)).paths, ['src/x/']);
  const txt = await G.cmdStatus({ flags: { text: true } });
  assert.match(txt.text, new RegExp(`Running ${C.shortId(run.runId)} accepted-idea-delivery \\(claude-opus-5\\).*; paths src/x/\\.`));
});

test('recipes: each charter quotes its v3 recipe need and core action; a charter with none says so, built-ins give their purpose', async () => {
  const d = D.openDb();
  try {
    const m = D.recipesBySlug(d, ['project-kpi-stewardship', 'accepted-idea-delivery', 'council-review']);
    assert.deepEqual(m.get('project-kpi-stewardship'), { name: 'Project KPI and coverage stewardship', need: 'RECIPE-NEED-KPI', coreAction: 'RECIPE-CORE-KPI' }, 'the newest row of a slug wins');
    assert.equal(m.has('council-review'), false);
    // council-review has an app-master template on disk (and, in the real DB, a recipe row): its text
    // comes from there; ux-proposal has neither and is built in. Both carry the built-in purpose, which
    // the context prints only when no recipe row exists.
    const cs = D.chartersFor(d, IDS.project, demoBrief([{ slug: 'council-review', priority: null }, { slug: 'ux-proposal', priority: null }]));
    assert.deepEqual(cs.map((c) => [c.source, c.recipe, Boolean(c.purpose)]), [['template', null, true], ['builtin', null, true]]);
  } finally { d.close(); }
  S.saveBrief('demo', demoBrief([...CHARTERS, { slug: 'council-lite-review', priority: null }, { slug: 'ux-proposal', priority: null }]));
  const r = await X.cmdContext({ flags: { project: 'demo' } });
  const doc = fs.readFileSync(r.path, 'utf8');
  assert.match(doc, /- slug: project-kpi-stewardship[\s\S]*?recipe "Project KPI and coverage stewardship" need: RECIPE-NEED-KPI\n  recipe core action: RECIPE-CORE-KPI/);
  assert.match(doc, /recipe "Accepted idea delivery to the main branch" need: RECIPE-NEED-DELIVERY/);
  assert.ok(!doc.includes('OLD-NEED'), 'an older recipe row is not quoted');
  assert.match(doc, /- slug: made-up-charter[\s\S]*?recipe: no recipe_definitions row for this slug\n/);
  assert.match(doc, /- slug: council-lite-review[\s\S]*?title: Council-lite review of one feature · text from builtin[\s\S]*?recipe: no recipe_definitions row for this slug; its built-in purpose: Run the lite council on one feature/);
  assert.match(doc, /- slug: ux-proposal[\s\S]*?its built-in purpose: File one \[UX\] idea/);
  // every budget level keeps the recipe quote: the master works to it even in a crowded context
  for (const C of X.BUDGET_LEVELS) assert.ok(C.recipeNeed > 0 && C.recipeCore > 0);
  assert.ok(doc.length <= X.MAX_CONTEXT_CHARS);
});

test('cleanup', () => { fixture.close(); fs.rmSync(env.tmp, { recursive: true, force: true }); });
