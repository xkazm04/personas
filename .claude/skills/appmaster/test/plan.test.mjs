// The PLAN WAKE: a project with no plan in the journal and no milestone in the app is asked for one;
// decide validates its bounds and queues ONE outbox entry; replay posts milestones then goals, records
// every id it creates, never posts one twice, and leaves the entry queued while a route answers 404.
// Fixture DB + fake doors; temp state root. Run: node --test .claude/skills/appmaster/test/plan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setupEnv, makeRepo, makeDb, demoBrief, IDS } from './wp1-fixture.mjs';

const env = setupEnv('plan');
makeRepo(env.demoRoot, 'main');
makeRepo(env.bareRoot, 'master');
const app = makeDb(env);   // the "app": writable, test-only
const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const D = await import('../lib/dbread.mjs');
const X = await import('../lib/context.mjs');
const V = await import('../lib/decision.mjs');
const O = await import('../lib/outbox.mjs');

const CHARTERS = [{ slug: 'project-kpi-stewardship', priority: 1 }];
S.saveBrief('demo', demoBrief(CHARTERS));
const goal = (t) => ({ title: `Goal ${t}`, measure: `measure ${t}` });
const milestone = (n, goals = 2) => ({ name: `Milestone ${n}`, goal: `achieve ${n}`, goals: Array.from({ length: goals }, (_, k) => goal(`${n}.${k}`)) });
const planOf = (n, goals = 2) => ({ milestones: Array.from({ length: n }, (_, i) => milestone(i + 1, goals)) });
const decision = (wakeId, over = {}) => ({
  wakeId, dispatch: [], defer: [{ charterSlug: 'project-kpi-stewardship', reason: 'planning first' }],
  asks: [], ideaVerdicts: [], say: null, note: 'planned', nextWakeMinutes: 60, ...over,
});
const ctx = (planWake) => ({ wakeId: 'w', brief: { charters: CHARTERS }, planWake });
const errorsOf = (d, planWake = true) => V.validateDecision(d, ctx(planWake)).errors;

// ---------------------------------------------------------------- bounds

test('plan bounds: 0 and 6 milestones are refused, 1 and 5 accepted; goals 0 and 6 refused', () => {
  assert.deepEqual(errorsOf(decision('w', { plan: planOf(1) })), []);
  assert.deepEqual(errorsOf(decision('w', { plan: planOf(5, 5) })), []);
  assert.ok(errorsOf(decision('w', { plan: planOf(0) })).some((e) => /plan\.milestones has 0; 1-5 required/.test(e)));
  assert.ok(errorsOf(decision('w', { plan: planOf(6) })).some((e) => /plan\.milestones has 6; 1-5 required/.test(e)));
  assert.ok(errorsOf(decision('w', { plan: planOf(1, 0) })).some((e) => /goals has 0; 1-5 required/.test(e)));
  assert.ok(errorsOf(decision('w', { plan: planOf(1, 6) })).some((e) => /goals has 6; 1-5 required/.test(e)));
});

test('plan strings are bounded and checked: lengths, required fields, dates, unique names and titles, no extra keys', () => {
  const cases = {
    'long name': [{ milestones: [{ ...milestone(1), name: 'n'.repeat(C.PLAN.nameMax + 1) }] }, /name is 121 characters; at most 120/],
    'long measure': [{ milestones: [{ ...milestone(1), goals: [{ title: 't', measure: 'm'.repeat(C.PLAN.measureMax + 1) }] }] }, /measure is 301 characters; at most 300/],
    'empty goal': [{ milestones: [{ ...milestone(1), goal: ' ' }] }, /\.goal must be a non-empty string/],
    'missing measure': [{ milestones: [{ ...milestone(1), goals: [{ title: 't' }] }] }, /\.measure must be a non-empty string/],
    'bad date': [{ milestones: [{ ...milestone(1), targetDate: '2026-13-40' }] }, /targetDate must be a date YYYY-MM-DD/],
    'duplicate name': [{ milestones: [milestone(1), { ...milestone(2), name: 'milestone 1' }] }, /repeats an earlier milestone's name/],
    'duplicate title': [{ milestones: [milestone(1), { ...milestone(2), goals: [goal('1.0')] }] }, /repeats an earlier goal's title/],
    'extra key': [{ milestones: [{ ...milestone(1), owner: 'x' }] }, /unknown key "owner"/],
    'not an object': ['three milestones', /plan must be an object/],
  };
  for (const [name, [plan, re]] of Object.entries(cases)) {
    const errs = errorsOf(decision('w', { plan }));
    assert.ok(errs.some((e) => re.test(e)), `${name}: ${JSON.stringify(errs)}`);
  }
  assert.deepEqual(errorsOf(decision('w', { plan: { milestones: [{ ...milestone(1), targetDate: '2026-11-30' }] } })), []);
});

test('a plan is required on a plan wake and refused on any other', () => {
  assert.ok(errorsOf(decision('w'), true).some((e) => /this is a PLAN WAKE: plan is required/.test(e)));
  assert.ok(errorsOf(decision('w', { plan: planOf(1) }), false).some((e) => /plan is accepted only on a PLAN WAKE/.test(e)));
  assert.deepEqual(errorsOf(decision('w'), false), [], 'an ordinary wake without a plan is fine');
  assert.deepEqual(errorsOf(decision('w', { plan: null }), false), [], 'null means no plan');
});

// ---------------------------------------------------------------- the context

test('milestonesOf: an unreadable table is an error, never "no milestones"', () => {
  const d = new DatabaseSync(':memory:');
  try { const m = D.milestonesOf(d, 'x'); assert.deepEqual(m.rows, []); assert.match(m.error, /no such table/); } finally { d.close(); }
});

let planWakeId;
test('context: a project with no plan and no milestones opens with PLAN WAKE and the wake line remembers it', async () => {
  const r = await X.cmdContext({ flags: { project: 'demo' } });
  assert.equal(r.planWake, true);
  const doc = fs.readFileSync(r.path, 'utf8');
  assert.ok(doc.startsWith('PLAN WAKE: this project has no plan yet'), doc.slice(0, 200));
  assert.match(doc, /"plan":\{"milestones":\[\{"name":"<milestone>"/);
  assert.match(doc, /`plan` is REQUIRED this wake \(PLAN WAKE\)/);
  assert.equal(S.loadWake('demo', r.wakeId).planWake, true);
  planWakeId = r.wakeId;
});

test('decide on the plan wake queues ONE plan entry; the next context shows YOUR PLAN, not another PLAN WAKE', async () => {
  const file = path.join(env.tmp, 'plan-decision.json');
  fs.writeFileSync(file, JSON.stringify(decision(planWakeId)));
  await assert.rejects(V.cmdDecide({ flags: { project: 'demo', wake: planWakeId, file } }), (e) => e.reason === 'invalid decision' && e.extra.errors.some((x) => /PLAN WAKE: plan is required/.test(x)));
  const plan = { milestones: [{ ...milestone(1), targetDate: '2026-11-30' }, milestone(2, 1)] };
  fs.writeFileSync(file, JSON.stringify(decision(planWakeId, { plan })));
  const out = await V.cmdDecide({ flags: { project: 'demo', wake: planWakeId, file } });
  const entries = S.loadOutbox('demo').filter((e) => e.kind === 'plan');
  assert.equal(entries.length, 1);
  assert.ok(out.outbox.includes(entries[0].id));
  assert.deepEqual(entries[0].payload, { projectId: IDS.project, plan });
  const r = await X.cmdContext({ flags: { project: 'demo' } });
  assert.equal(r.planWake, false, 'the journal holds a plan now');
  const doc = fs.readFileSync(r.path, 'utf8');
  assert.ok(!doc.includes('PLAN WAKE:'));
  assert.match(doc, /YOUR PLAN \(decided .* at wake [0-9a-f-]{8}; in the app: queued/);
  assert.match(doc, /1\. Milestone 1 \(target 2026-11-30\) - not in the app yet; goals done 0\/2: achieve 1/);
  assert.match(doc, /- Goal 1\.0 - measure: measure 1\.0/);
  assert.ok(!doc.includes('"plan":{'), 'the template asks for no plan off a plan wake');
});

test('context: milestones already in the app are not a plan wake; they are shown as the plan', async () => {
  S.saveBrief('bare', demoBrief(CHARTERS));
  app.prepare('insert into dev_milestones (id, project_id, name, status, order_index, created_at) values (?,?,?,?,?,?)').run('ms-app-1', IDS.bare, 'Ship the beta', 'active', 0, '2026-10-01');
  const r = await X.cmdContext({ flags: { project: 'bare' } });
  assert.equal(r.planWake, false);
  const doc = fs.readFileSync(r.path, 'utf8');
  assert.match(doc, /MILESTONES IN THE APP \(1; your plan is these/);
  assert.match(doc, /- Ship the beta \(active\)/);
});

// ---------------------------------------------------------------- replay

/** Fake doors standing in for the app's new routes (writes through the test's own handle). */
function doors({ missing = false, failGoalAt = null } = {}) {
  const calls = [];
  let n = 0, goals = 0;
  return {
    calls,
    async devTools(route, body) {
      calls.push([route, body]);
      if (missing) { const e = new Error(`${route} -> 404: Not Found`); e.status = 404; throw e; }
      if (route === '/milestones') {
        const id = `ms-${++n}-${Math.random().toString(16).slice(2, 8)}`;
        app.prepare('insert into dev_milestones (id, project_id, name, goal, target_date, created_at) values (?,?,?,?,?,?)').run(id, body.projectId, body.name, body.goal ?? null, body.targetDate ?? null, C.nowIso());
        return { milestoneId: id };
      }
      if (route === '/goals') {
        if (failGoalAt !== null && goals++ === failGoalAt) throw Object.assign(new Error('/goals -> 500: boom'), { status: 500 });
        const id = `g-${++n}-${Math.random().toString(16).slice(2, 8)}`;
        app.prepare('insert into dev_goals (id, project_id, title, status, progress, created_at) values (?,?,?,?,?,?)').run(id, body.projectId, body.title, 'open', 0, C.nowIso());
        app.prepare('insert into dev_milestone_items (milestone_id, item_kind, item_id) values (?,?,?)').run(body.milestoneId, 'goal', id);
        return { goalId: id };
      }
      throw new Error(`unexpected route ${route}`);
    },
  };
}
const ro = () => D.openDb();
const planEntry = (plan, projectId = IDS.project) => ({ id: 'plan:x', kind: 'plan', slug: 'demo', projectId, payload: { projectId, plan }, source: {}, queuedAt: C.nowIso(), state: 'queued', attempts: 0 });

test('replay: while the routes answer 404 the entry stays queued with "route missing (404)" and creates nothing', async () => {
  const db = ro();
  try {
    const d = doors({ missing: true });
    const r = await O.replayEntry(planEntry(planOf(2)), { doors: d, db });
    assert.equal(r.state, 'queued');
    assert.match(r.evidence, /^route missing \(404\): POST \/dev-tools\/milestones/);
    assert.deepEqual(r.created, { milestones: {}, goals: {} });
    assert.equal(d.calls.length, 1, 'it stops at the first 404');
  } finally { db.close(); }
});

test('replay posts milestones then goals, records every id, and a second replay posts nothing', async () => {
  const db = ro();
  try {
    const d = doors();
    const plan = { milestones: [{ ...milestone('A'), targetDate: '2026-12-01' }, milestone('B', 1)] };
    const first = await O.replayEntry(planEntry(plan), { doors: d, db });
    assert.equal(first.state, 'replayed', first.evidence);
    assert.deepEqual(d.calls.map(([route]) => route), ['/milestones', '/goals', '/goals', '/milestones', '/goals']);
    assert.deepEqual(d.calls[0][1], { projectId: IDS.project, name: 'Milestone A', goal: 'achieve A', targetDate: '2026-12-01' });
    assert.equal(d.calls[1][1].milestoneId, first.created.milestones[0], 'each goal names its milestone');
    assert.equal(d.calls[1][1].description, 'Measure: measure A.0', 'the measure travels in the description');
    assert.equal(Object.keys(first.created.milestones).length, 2);
    assert.deepEqual(Object.keys(first.created.goals).sort(), ['0.0', '0.1', '1.0']);
    assert.match(first.evidence, /db: 2 milestone\(s\) .* and 3 goal\(s\) .* \(5 posted now, 0 found already there\)/);
    const again = await O.replayEntry({ ...planEntry(plan), created: first.created }, { doors: d, db });
    assert.equal(again.state, 'replayed');
    assert.equal(d.calls.length, 5, 'a created id is never posted again');
    // and a crash between a post and the journal line: the rows are found by name / linked title, not reposted
    const lost = await O.replayEntry(planEntry(plan), { doors: d, db });
    assert.equal(lost.state, 'replayed');
    assert.equal(d.calls.length, 5);
    assert.match(lost.evidence, /0 posted now, 5 found already there/);
  } finally { db.close(); }
});

test('a replay that fails halfway keeps what it created and the next one resumes without a duplicate', async () => {
  const db = ro();
  try {
    const plan = { milestones: [milestone('C', 3)] };
    const flaky = doors({ failGoalAt: 1 });
    const r1 = await O.replayEntry(planEntry(plan), { doors: flaky, db });
    assert.equal(r1.state, 'failed');
    assert.match(r1.evidence, /door error on goal 0\.1: \/goals -> 500/);
    assert.equal(Object.keys(r1.created.milestones).length, 1);
    assert.deepEqual(Object.keys(r1.created.goals), ['0.0']);
    const good = doors();
    const r2 = await O.replayEntry({ ...planEntry(plan), created: r1.created }, { doors: good, db });
    assert.equal(r2.state, 'replayed', r2.evidence);
    assert.deepEqual(good.calls.map(([route, b]) => `${route} ${b.title ?? b.name}`), ['/goals Goal C.1', '/goals Goal C.2']);
    assert.equal(app.prepare("select count(*) n from dev_milestones where name = 'Milestone C'").get().n, 1, 'one milestone, not two');
  } finally { db.close(); }
});

test('outbox replay persists `created` on the entry; a dry run says what it would post and writes nothing', async () => {
  const e = S.queueOutbox('demo', IDS.project, 'plan', { projectId: IDS.project, plan: { milestones: [milestone('D', 1)] } }, { wakeId: 'w-d' });
  const db = ro();
  try {
    const dry = await O.cmdOutbox({ _: ['replay'], flags: { 'dry-run': true } }, { db, doors: doors() });
    assert.match(dry.entries.find((x) => x.id === e.id).evidence, /^would POST 2 milestone\/goal row\(s\)/);
    const r404 = await O.cmdOutbox({ _: ['replay'], flags: {} }, { appUp: async () => true, db, doors: doors({ missing: true }) });
    assert.equal(r404.entries.find((x) => x.id === e.id).state, 'queued');
    assert.match(S.loadOutbox('demo').find((x) => x.id === e.id).evidence, /^route missing \(404\)/);
    await O.cmdOutbox({ _: ['replay'], flags: {} }, { appUp: async () => true, db, doors: doors() });
    const after = S.loadOutbox('demo').find((x) => x.id === e.id);
    assert.equal(after.state, 'replayed');
    assert.equal(Object.keys(after.created.milestones).length, 1);
    assert.equal(Object.keys(after.created.goals).length, 1);
  } finally { db.close(); }
});

test('cleanup', () => { app.close(); fs.rmSync(env.tmp, { recursive: true, force: true }); });
