// WP1: outbox replay against a FIXTURE app DB and FAKE doors. The fake doors write the fixture
// through their own handle (standing in for the app); replayEntry only ever reads it, read-only.
// Run: node --test .claude/skills/appmaster/test/outbox.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupEnv, makeDb, demoBrief, IDS } from './wp1-fixture.mjs';

const env = setupEnv('outbox');
const app = makeDb(env);   // the "app": writable, test-only
const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const D = await import('../lib/dbread.mjs');
const O = await import('../lib/outbox.mjs');
const B = await import('../lib/bridge.mjs');

const project = { slug: 'demo', id: IDS.project, name: 'Demo', root: env.demoRoot, baseBranch: 'main' };
S.saveBrief('demo', demoBrief([{ slug: 'project-kpi-stewardship', priority: 1 }]));
S.saveWake('demo', { wakeId: 'w0', slug: 'demo', at: C.nowIso(), contextPath: 'x', status: 'context', project });
const ro = D.openDb();   // what replayEntry reads through

let seq = 0;   // row ids unique across every fake app in this file
/** A fake app: records calls; `apply` decides whether the door's effect really lands in the DB. */
function fakeDoors({ apply = true } = {}) {
  const calls = [];
  const exec = (sql, ...p) => { if (apply) app.prepare(sql).run(...p); };
  return {
    calls,
    async invoke(command, params) {
      calls.push([command, params]);
      if (command === 'dev_tools_update_idea') exec('update dev_ideas set status = ? where id = ?', params.status, params.id);
      if (command === 'dev_tools_create_task') exec('insert into dev_tasks (id, project_id, title, description, source_idea_id, status) values (?,?,?,?,?,?)', `t-${++seq}`, params.projectId, params.title, params.description, params.sourceIdeaId, params.status);
      if (command === 'update_manual_review_status') exec('update persona_manual_reviews set status = ? where id = ?', params.status, params.id);
      if (command === 'post_persona_channel_message') exec("insert into team_channel_messages (id, persona_id, author_kind, body, created_at) values (?,?,'user',?,?)", `cm-${++seq}`, params.personaId, params.content, '2026-10-05 10:00:00');
      return { big: 400 };   // the echo is never evidence
    },
    async devTools(route, body) {
      calls.push([route, body]);
      const m = route.match(/^\/ideas\/([^/]+)\/outcome$/);
      if (m) exec('insert into dev_tasks (id, project_id, title, description, source_idea_id, status) values (?,?,?,?,?,?)', `t-${++seq}`, IDS.project, 'delivered', `--- App Master outcome: delivered ---\ncommit: ${body.commit}\n`, decodeURIComponent(m[1]), 'completed');
      return { ok: true };
    },
  };
}
const entry = (kind, payload) => ({ id: `${kind}:x`, kind, slug: 'demo', projectId: IDS.project, payload, source: {}, queuedAt: C.nowIso(), state: 'queued', attempts: 0 });

test('importing bridge.mjs touched nothing; appUp is false at once when the handshake file is missing', async () => {
  const t = Date.now();
  assert.equal(await B.appUp(), false);
  assert.ok(Date.now() - t < 1000, 'no port scan when the handshake file is absent');
});

test('idea-verdict: pre-check skips an effect already applied, without calling a door', async () => {
  const doors = fakeDoors();
  const r = await O.replayEntry(entry('idea-verdict', { ideaId: IDS.ideaAccepted, status: 'accepted', reason: 'r' }), { doors, db: ro });
  assert.equal(r.state, 'skipped'); assert.match(r.evidence, /^already applied/);
  assert.equal(doors.calls.length, 0);
});

test('idea-verdict: door + post-check proves the effect; a door whose effect never lands is failed', async () => {
  const lying = fakeDoors({ apply: false });
  const f = await O.replayEntry(entry('idea-verdict', { ideaId: IDS.ideaVerdict, status: 'rejected', reason: 'dup' }), { doors: lying, db: ro });
  assert.equal(f.state, 'failed'); assert.match(f.evidence, /^post-check: idea .* is pending after the door answered/);
  assert.deepEqual(lying.calls[0], ['dev_tools_update_idea', { id: IDS.ideaVerdict, status: 'rejected', rejectionReason: 'dup' }]);
  const doors = fakeDoors();
  const ok = await O.replayEntry(entry('idea-verdict', { ideaId: IDS.ideaVerdict, status: 'rejected', reason: 'dup' }), { doors, db: ro });
  assert.equal(ok.state, 'replayed'); assert.match(ok.evidence, /^db: idea .* status rejected/);
  const sup = await O.replayEntry(entry('idea-verdict', { ideaId: IDS.ideaVerdict, status: 'accepted', reason: 'x' }), { doors, db: ro });
  assert.equal(sup.state, 'skipped'); assert.match(sup.evidence, /^superseded: idea .* is rejected/);
  const gone = await O.replayEntry(entry('idea-verdict', { ideaId: 'nope', status: 'accepted', reason: 'x' }), { doors, db: ro });
  assert.equal(gone.state, 'skipped'); assert.match(gone.evidence, /no idea nope/);
});

test('a missing door marks skipped; a throwing door marks failed', async () => {
  const none = await O.replayEntry(entry('idea-verdict', { ideaId: IDS.ideaPending, status: 'accepted', reason: 'r' }), { doors: {}, db: ro });
  assert.equal(none.state, 'skipped'); assert.match(none.evidence, /^no door: doors.invoke is absent/);
  const raise = await O.replayEntry(entry('ask', { askId: 'a1', question: 'Never filed?', context: '', options: [] }), { doors: fakeDoors(), db: ro });
  assert.equal(raise.state, 'skipped'); assert.equal(raise.evidence, O.NO_DOOR.askRaise);
  const masterSay = await O.replayEntry(entry('say', { message: 'from the master' }), { doors: fakeDoors(), db: ro });
  assert.equal(masterSay.state, 'skipped'); assert.equal(masterSay.evidence, O.NO_DOOR.masterSay);
  const boom = { invoke: async () => { throw new Error('bridge down'); } };
  const t = await O.replayEntry(entry('idea-verdict', { ideaId: IDS.ideaPending, status: 'accepted', reason: 'r' }), { doors: boom, db: ro });
  assert.equal(t.state, 'failed'); assert.equal(t.evidence, 'door error: bridge down');
});

test('task-complete: the outcome door per idea, a project task without ideas, pre-check on the SHA', async () => {
  const doors = fakeDoors();
  const p = { ideaIds: [IDS.ideaAccepted, 'idea-not-in-db'], sha: 'abc1234def', title: 'Deliver it', runId: 'run-1', branch: 'autopilot/x-1' };
  const r = await O.replayEntry(entry('task-complete', p), { doors, db: ro });
  assert.equal(r.state, 'replayed'); assert.match(r.evidence, /not in the app DB: idea-not/);
  assert.equal(doors.calls[0][0], `/ideas/${IDS.ideaAccepted}/outcome`);
  assert.deepEqual(doors.calls[0][1].commit, 'abc1234def');
  const again = await O.replayEntry(entry('task-complete', p), { doors, db: ro });
  assert.equal(again.state, 'skipped'); assert.match(again.evidence, /^already applied/);
  const bare = await O.replayEntry(entry('task-complete', { ideaIds: [], sha: 'fff0001', title: 'Sweep', runId: 'run-2', branch: 'autopilot/y' }), { doors, db: ro });
  assert.equal(bare.state, 'replayed');
  assert.equal(doors.calls.at(-1)[0], 'dev_tools_create_task'); assert.match(doors.calls.at(-1)[1].description, /commit: fff0001/);
});

test('ask resolve and operator say: located, posted, verified; no review row is skipped', async () => {
  const doors = fakeDoors();
  const noRow = await O.replayEntry(entry('ask', { op: 'resolve', askId: 'a2', question: 'Raised headless', choice: 'Yes', notes: '' }), { doors, db: ro });
  assert.equal(noRow.state, 'skipped'); assert.match(noRow.evidence, /no review row to resolve/);
  const res = await O.replayEntry(entry('ask', { op: 'resolve', askId: 'a3', question: 'Pending in the app', choice: 'Yes', notes: 'go' }), { doors, db: ro });
  assert.equal(res.state, 'replayed');
  assert.deepEqual(doors.calls.at(-1), ['update_manual_review_status', { id: IDS.review, status: 'resolved', reviewerNotes: 'Yes: go' }]);
  const dup = await O.replayEntry(entry('ask', { op: 'resolve', askId: 'a3', question: 'Pending in the app', choice: 'Yes', notes: 'go' }), { doors, db: ro });
  assert.equal(dup.state, 'skipped'); assert.match(dup.evidence, /already applied: review .* is resolved/);
  const say = await O.replayEntry(entry('say', { message: 'operator words', from: 'operator', channelId: 'c9' }), { doors, db: ro });
  assert.equal(say.state, 'replayed');
  assert.equal(doors.calls.at(-1)[1].personaId, IDS.master);
  const sayAgain = await O.replayEntry(entry('say', { message: 'operator words', from: 'operator', channelId: 'c9' }), { doors, db: ro });
  assert.equal(sayAgain.state, 'skipped');
});

test('outbox list and replay --dry-run with the app down; a real replay is refused', async () => {
  S.queueOutbox('demo', IDS.project, 'idea-verdict', { ideaId: IDS.ideaPending, status: 'accepted', reason: 'cheap' }, { wakeId: 'w0' });
  S.queueOutbox('demo', IDS.project, 'say', { message: 'hello app', from: 'operator', channelId: 'c1' }, {});
  S.queueOutbox('demo', IDS.project, 'ask', { op: 'raise', askId: 'a9', question: 'q', context: '', options: [] }, { wakeId: 'w0' });
  const list = await O.cmdOutbox({ _: ['list'], flags: {} });
  assert.equal(list.counts.queued, 3);
  assert.ok(list.entries.every((e) => typeof e.ageMin === 'number' && e.source));
  const bytes = fs.readFileSync(C.outboxPath('demo'), 'utf8');
  const dry = await O.cmdOutbox({ _: ['replay'], flags: { 'dry-run': true } });
  assert.equal(dry.dryRun, true); assert.equal(dry.entries.length, 3);
  assert.deepEqual(dry.entries.map((e) => e.wouldBe).sort(), ['queued', 'queued', 'skipped']);
  assert.match(dry.entries.find((e) => e.kind === 'idea-verdict').evidence, /^would invoke dev_tools_update_idea/);
  assert.equal(fs.readFileSync(C.outboxPath('demo'), 'utf8'), bytes, 'a dry run writes nothing');
  await assert.rejects(O.cmdOutbox({ _: ['replay'], flags: {} }), (e) => e instanceof C.Refusal && e.reason === 'app is not running' && e.extra.queued === 3);
});

test('outbox replay records each entry once: state, attempts+1, evidence; failed entries wait for the next run', async () => {
  const lying = fakeDoors({ apply: false });
  const r1 = await O.cmdOutbox({ _: ['replay'], flags: {} }, { appUp: async () => true, doors: lying, db: ro });
  const byKind = Object.fromEntries(r1.entries.map((e) => [e.kind, e]));
  assert.equal(byKind['idea-verdict'].state, 'failed'); assert.equal(byKind['idea-verdict'].attempts, 1);
  assert.equal(byKind.say.state, 'failed');
  assert.equal(byKind.ask.state, 'skipped');
  assert.equal(lying.calls.length, 2, 'one door call per entry, no retry inside the run');
  const doors = fakeDoors();
  const r2 = await O.cmdOutbox({ _: ['replay'], flags: {} }, { appUp: async () => true, doors, db: ro });
  assert.deepEqual(r2.entries.map((e) => [e.kind, e.state, e.attempts]).sort(), [['idea-verdict', 'replayed', 2], ['say', 'replayed', 2]]);
  const r3 = await O.cmdOutbox({ _: ['replay'], flags: {} }, { appUp: async () => true, doors, db: ro });
  assert.equal(r3.entries.length, 0, 'nothing left to replay');
  assert.equal(S.loadOutbox('demo').find((e) => e.kind === 'idea-verdict').evidence.startsWith('db: idea'), true);
});

test('cleanup', () => { ro.close(); app.close(); fs.rmSync(env.tmp, { recursive: true, force: true }); });
