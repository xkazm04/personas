// The standup arm list: no active standup changes nothing; an armed one stops WAKES of other projects only.
// Run: node --test .claude/skills/appmaster/test/standup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-standup-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.PERSONAS_DB = path.join(tmp, 'no-such.db');
for (const s of ['pof', 'kp']) {
  fs.mkdirSync(path.join(tmp, 'state', s), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'state', s, 'brief.json'), JSON.stringify({ project: s, headless: true }));
}
const SU = await import('../lib/standup.mjs');
const D = await import('../lib/digest.mjs');
const S = await import('../lib/store.mjs');
const plan = (o) => { const f = path.join(tmp, 'plan.json'); fs.writeFileSync(f, JSON.stringify(o)); return f; };

test('no standup: everything is armed and due', async () => {
  assert.equal(SU.activeStandup(), null);
  assert.equal(SU.isArmed('pof'), true);
  const st = await D.cmdStatus({ flags: {} });
  assert.deepEqual(st.projects.map((p) => [p.slug, p.armed, p.due]), [['kp', true, true], ['pof', true, true]]);
  assert.equal(st.standup, undefined);
});

test('arm refuses a bad plan and names the errors', async () => {
  const r = await SU.cmdStandup({ _: ['arm'], flags: { file: plan({ date: 'x', armed: [{ slug: 'nope' }, { slug: 'nope' }] }) } });
  assert.equal(r.refused, 'invalid standup plan');
  assert.equal(r.errors.length, 4);
  assert.equal(SU.activeStandup(), null);
});

test('armed: only named projects are due; accounting still sees every managed project', async () => {
  const r = await SU.cmdStandup({ _: ['arm'], flags: { file: plan({ date: '2026-10-18', armed: [{ slug: 'kp' }] }) } });
  assert.deepEqual(r.armed.armed, ['kp']);
  const st = await D.cmdStatus({ flags: {} });
  assert.deepEqual(st.projects.map((p) => [p.slug, p.armed, p.due]), [['kp', true, true], ['pof', false, false]]);
  assert.deepEqual(S.listSlugs(), ['kp', 'pof']);
  assert.match((await D.cmdStatus({ flags: { text: true } })).text, /Standup 2026-10-18 armed: kp/);
});

test('end restores the old behaviour and keeps the record', async () => {
  const r = await SU.cmdStandup({ _: ['end'], flags: {} });
  assert.equal(r.ended, true);
  assert.equal(SU.activeStandup(), null);
  assert.equal(SU.isArmed('pof'), true);
  assert.equal((await SU.cmdStandup({ _: ['show'], flags: {} })).active, null);
});
