// The state door's skill side: the beat is derived from the journal, posted through the dev-tools
// bridge, and NEVER throws, blocks or changes an exit code - with a fake door, a throwing door, a
// hanging door, no app at all, and a fake bridge server reached through the real handshake path.
// Run: node --test .claude/skills/appmaster/test/heartbeat.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { setupEnv, demoBrief } from './wp1-fixture.mjs';

const env = setupEnv('heartbeat');   // temp state root; the handshake path points at a missing file
const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const H = await import('../lib/heartbeat.mjs');
const CLI = await import('../appmaster.mjs');

const PID = 'p-demo-0001';
const project = { slug: 'demo', id: PID, name: 'Demo', root: env.demoRoot, baseBranch: 'main' };
S.saveBrief('demo', demoBrief([{ slug: 'project-kpi-stewardship', priority: 1 }]));
S.saveWake('demo', { wakeId: 'w0', slug: 'demo', at: C.nowIso(), contextPath: 'x', status: 'context', project });
S.saveWake('demo', { wakeId: 'w0', status: 'decided', note: '  Wake 0. Dispatched the KPI pass.  ', nextWakeAt: '2026-10-06T14:00:00.000Z' });

/** A fake door with bridge.devTools' signature that records every call. */
function fakePost(answer = { suppressing: true }) {
  const calls = [];
  const post = async (route, body) => { calls.push([route, body]); return answer; };
  return { calls, post };
}

test('idle: no live run; the note and the next wake come from the latest decided wake', () => {
  assert.deepEqual(H.beatState('demo'), {
    state: 'idle', note: 'Wake 0. Dispatched the KPI pass.', nextWakeAt: '2026-10-06T14:00:00.000Z', runId: null,
  });
  assert.equal(H.projectIdOf('demo'), PID);
});

test('running while a run is running, exited or verifying; a planned run is not yet running', () => {
  const run = S.newRun(project, { wakeId: 'w0', charterSlug: 'c', reason: 'r', brief: 'b', model: 'm' });
  assert.equal(H.beatState('demo').state, 'idle', 'planned has not started');
  for (const state of ['running', 'exited', 'verifying']) {
    S.saveRun({ ...run, state });
    const b = H.beatState('demo');
    assert.equal(b.state, 'running', state);
    assert.equal(b.runId, C.shortId(run.runId));
  }
  S.saveRun({ ...run, state: 'merged' });
  assert.equal(H.beatState('demo').state, 'idle');
});

test('beat posts the derived state to the project route; an explicit state wins', async () => {
  const f = fakePost();
  const r = await H.beat('demo', null, null, { post: f.post });
  assert.deepEqual(r, { slug: 'demo', posted: true, state: 'idle', suppressing: true });
  assert.equal(f.calls[0][0], `/app-master/${PID}/heartbeat`);
  assert.deepEqual(f.calls[0][1], { state: 'idle', note: 'Wake 0. Dispatched the KPI pass.', nextWakeAt: '2026-10-06T14:00:00.000Z' });
  await H.beat('demo', null, 'ended', { post: f.post });
  assert.equal(f.calls[1][1].state, 'ended');
});

test('beat never throws: a door that throws, rejects, or answers garbage is {posted:false} or posted', async () => {
  const sync = await H.beat('demo', null, null, { post: () => { throw new Error('boom'); } });
  assert.equal(sync.posted, false); assert.match(sync.reason, /boom/);
  const rej = await H.beat('demo', null, null, { post: async () => { throw new Error('/app-master -> 404: Not Found'); } });
  assert.equal(rej.posted, false); assert.match(rej.reason, /404/);
  const odd = await H.beat('demo', null, null, { post: async () => null });
  assert.equal(odd.posted, true); assert.equal(odd.suppressing, false);
  const bad = await H.beat('demo', null, 'sleeping', { post: fakePost().post });
  assert.equal(bad.posted, false);
  const nobody = await H.beat('no-such-slug', null, null, { post: fakePost().post });
  assert.equal(nobody.posted, false); assert.match(nobody.reason, /no project id/);
});

test('beat gives up on a door that never answers, inside its time budget', async () => {
  const t = Date.now();
  const r = await H.beat('demo', null, null, { post: () => new Promise(() => {}), timeoutMs: 200 });
  assert.equal(r.posted, false); assert.match(r.reason, /no answer within 200 ms/);
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
});

test('with the app down (no handshake file) the real bridge path is a quick {posted:false}', async () => {
  const t = Date.now();
  const r = await H.beat('demo');
  assert.equal(r.posted, false);
  assert.ok(Date.now() - t < 1000, 'no network wait when the handshake file is absent');
});

test('through a fake bridge server: the real devTools door, the token header, and a hanging app', async (t) => {
  const seen = [];
  let hang = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, token: req.headers['x-personas-local-token'], body: JSON.parse(body || '{}') });
      if (hang) return;   // never answers
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ state: 'idle', suppressing: true }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.closeAllConnections?.(); server.close(); fs.rmSync(process.env.APPMASTER_HANDSHAKE, { force: true }); });
  fs.writeFileSync(process.env.APPMASTER_HANDSHAKE, JSON.stringify({ port: server.address().port, token: 'tok', pid: process.pid }));

  const ok = await H.beat('demo');
  assert.equal(ok.posted, true); assert.equal(ok.suppressing, true);
  assert.equal(seen[0].url, `/dev-tools/app-master/${PID}/heartbeat`);
  assert.equal(seen[0].token, 'tok');

  hang = true;
  const t0 = Date.now();
  const late = await H.beat('demo', null, null, { timeoutMs: 300 });
  assert.equal(late.posted, false);
  assert.ok(Date.now() - t0 < 1500, `a hanging app held the beat ${Date.now() - t0} ms`);
});

test('slugsAfter: a run names its slug, watch rows name theirs, decide names --project', () => {
  assert.deepEqual(H.slugsAfter('dispatch', {}, { slug: 'demo', runId: 'x' }), ['demo']);
  assert.deepEqual(H.slugsAfter('watch', {}, [{ slug: 'demo' }, { slug: 'demo' }]), ['demo']);
  assert.deepEqual(H.slugsAfter('watch', {}, []), ['demo'], 'an empty watch still beats every managed project');
  assert.deepEqual(H.slugsAfter('decide', { flags: { project: 'demo' } }, { wakeId: 'w0' }), ['demo']);
  assert.deepEqual(H.slugsAfter('decide', { flags: {} }, null), []);
});

test('the CLI: heartbeat is a subcommand, a bad --state is an error, and an app-down beat exits 0', async () => {
  const log = console.log; const err = console.error;
  const out = [];
  console.log = (s) => out.push(String(s)); console.error = () => {};
  try {
    fs.rmSync(process.env.APPMASTER_HANDSHAKE, { force: true });
    assert.equal(await CLI.run(['heartbeat', '--state', 'ended']), C.EXIT.OK);
    const parsed = JSON.parse(out.at(-1));
    assert.deepEqual(parsed.beats.map((b) => [b.slug, b.posted]), [['demo', false]]);
    assert.equal(await CLI.run(['heartbeat', '--state', 'sleeping']), C.EXIT.ERROR);
    // a wired subcommand keeps its own output and exit code with the app down
    assert.equal(await CLI.run(['watch']), C.EXIT.OK);
    assert.ok(Array.isArray(JSON.parse(out.at(-1))), 'watch still prints its rows, nothing else');
  } finally { console.log = log; console.error = err; }
});
