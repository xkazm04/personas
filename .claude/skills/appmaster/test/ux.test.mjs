// The UX gate (pof): the context shows uxPending, the pending ideas titled `[UX]`; decide REFUSES a
// ux-proposal dispatch while more than 10 wait (machine-enforced), accepts it at 10, and falls back to
// the count its wake recorded when the app DB cannot be read. Fixture DB; temp state root.
// Run: node --test .claude/skills/appmaster/test/ux.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setupEnv, makeRepo, makeDb, demoBrief, IDS } from './wp1-fixture.mjs';

const env = setupEnv('ux');
makeRepo(env.demoRoot, 'main');
let app = makeDb(env);
process.env.APPMASTER_FAKE_FREE_GB = '64';
const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const V = await import('../lib/decision.mjs');
const X = await import('../lib/context.mjs');

const CHARTERS = [{ slug: 'ux-proposal', priority: 1 }, { slug: 'accepted-idea-delivery', priority: 2 }];
S.saveBrief('demo', demoBrief(CHARTERS));
const project = { slug: 'demo', id: IDS.project, name: 'Demo', root: env.demoRoot, baseBranch: 'main' };
const uxIdea = (n, status = 'pending', title = `[UX] proposal ${n}`) => app.prepare('insert into dev_ideas (id, project_id, title, status, created_at) values (?,?,?,?,?)').run(`ux-${n}`, IDS.project, title, status, '2026-10-06');
for (let n = 1; n <= 11; n++) uxIdea(n);
uxIdea(90, 'pending', 'Not a [UX] proposal');      // the prefix must lead the title
uxIdea(91, 'accepted', '[UX] already accepted');  // only pending ones wait on the operator
uxIdea(92, 'pending', '  [UX] leading spaces');    // leading whitespace is ignored
app.prepare("update dev_ideas set status = 'rejected' where id = 'ux-11'").run();   // 10 [UX] + the spaced one = 11
// a milestone in the app: these wakes are ordinary ones, not a PLAN WAKE
app.prepare("insert into dev_milestones (id, project_id, name, status, order_index, created_at) values ('ms-1', ?, 'M1', 'active', 0, '2026-10-01')").run(IDS.project);

const decision = (wakeId) => ({
  wakeId, dispatch: [{ charterSlug: 'ux-proposal', reason: 'r', brief: 'Propose the onboarding layout.', ideaIds: [], paths: ['src/app/layout/'] }],
  defer: [{ charterSlug: 'accepted-idea-delivery', reason: 'later' }], asks: [], ideaVerdicts: [], say: null, note: 'n', nextWakeMinutes: 30,
});
async function decide(wakeId) {
  const file = path.join(env.tmp, `${wakeId}.json`);
  fs.writeFileSync(file, JSON.stringify(decision(wakeId)));
  return V.cmdDecide({ flags: { project: 'demo', wake: wakeId, file } });
}

test('the context shows uxPending and the wake line records it', async () => {
  const r = await X.cmdContext({ flags: { project: 'demo' } });
  const doc = fs.readFileSync(r.path, 'utf8');
  assert.match(doc, /uxPending \(pending \[UX\] ideas awaiting the operator\): 11; ux-proposal is REFUSED until the operator reviews them down to 10/);
  assert.equal(S.loadWake('demo', r.wakeId).uxPending, 11);
});

test('decide refuses ux-proposal at 11 pending [UX] ideas, naming the count', async () => {
  const r = await X.cmdContext({ flags: { project: 'demo' } });
  await assert.rejects(decide(r.wakeId), (e) => {
    assert.equal(e.reason, 'invalid decision');
    assert.ok(e.extra.errors.some((x) => /ux-proposal is refused while 11 \[UX\] ideas are pending review \(more than 10\)/.test(x)), JSON.stringify(e.extra.errors));
    return true;
  });
  assert.equal(S.loadWake('demo', r.wakeId).status, 'context', 'nothing was decided');
});

test('decide accepts ux-proposal at 10 (the gate counts the DB as it is NOW)', async () => {
  const r = await X.cmdContext({ flags: { project: 'demo' } });   // recorded 11
  app.prepare("update dev_ideas set status = 'accepted' where id = 'ux-1'").run();   // the operator reviewed one
  const out = await decide(r.wakeId);
  assert.equal(out.runIds.length, 1);
  assert.equal(S.loadRun('demo', out.runIds[0]).charterSlug, 'ux-proposal');
  S.updateRun(S.loadRun('demo', out.runIds[0]), { state: 'released' });
});

test('an unreadable DB falls back to the count the wake recorded, and with none the gate refuses', async () => {
  const r = await X.cmdContext({ flags: { project: 'demo' } });   // records 10
  assert.equal(S.loadWake('demo', r.wakeId).uxPending, 10);
  app.prepare("update dev_ideas set status = 'pending' where id = 'ux-1'").run();   // 11 again in the DB
  app.close();
  const moved = `${env.dbPath}.away`;
  fs.renameSync(env.dbPath, moved);
  try {
    const out = await decide(r.wakeId);
    assert.equal(out.runIds.length, 1, 'the DB is unreadable: the wake\'s recorded 10 decides');
    S.updateRun(S.loadRun('demo', out.runIds[0]), { state: 'released' });
    S.saveWake('demo', { wakeId: 'w-blind', slug: 'demo', at: C.nowIso(), status: 'context', project });
    await assert.rejects(decide('w-blind'), (e) => e.extra.errors.some((x) => /ux-proposal cannot be checked against the UX gate/.test(x)));
  } finally { fs.renameSync(moved, env.dbPath); app = new DatabaseSync(env.dbPath); }
});

test('cleanup', () => { app.close(); fs.rmSync(env.tmp, { recursive: true, force: true }); });
