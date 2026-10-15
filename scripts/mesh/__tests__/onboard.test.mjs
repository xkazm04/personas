// /mesh-onboard against two in-memory stub doors wired to each other (scripts/mesh/stub-door.mjs).
// Covers: the happy path (t1-t7, t5 skipped), a wrong code then a retype, a peer that never
// appears, t3 with no disabled agent, a stalled job, resume-from-state after a real process kill,
// and t5 with --allow-push against a fake git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../onboard.mjs';
import { StubDoor, link, stubPair } from '../stub-door.mjs';
import { loadState, statePath } from '../state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ONBOARD = path.join(HERE, '..', 'onboard.mjs');
const SCALE = 0.005;

async function cli(door, argv, { scale = SCALE, git } = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    env: door.env({ MESH_ONBOARD_TIME_SCALE: String(scale) }),
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
    repo: { originUrl: 'git@github.com:xkazm04/personas.git', root: door.projects[0] ? door.projects[0].rootPath : null },
    git,
  });
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 1, `exactly one JSON line on stdout, got: ${out}`);
  return { code, json: JSON.parse(lines[0]), err };
}

async function pairUp(a, b) {
  assert.equal((await cli(a, ['preflight'])).code, 0);
  assert.equal((await cli(b, ['preflight'])).code, 0);
  const da = await cli(a, ['discover']);
  assert.equal(da.code, 0, da.err);
  assert.deepEqual([da.json.peerId, da.json.role, da.json.paired], [b.peerId, 'initiator', false]);
  const dbs = await cli(b, ['discover']);
  assert.equal(dbs.json.role, 'responder');
  const ra = await cli(a, ['pair', '--peer', b.peerId]);
  assert.equal(ra.code, 0, ra.err);
  assert.match(ra.json.code, /^\d{3}-\d{3}$/);
  const rb = await cli(b, ['pair', '--peer', a.peerId]);
  assert.equal(rb.json.awaitingCode, true);
  return ra.json.code;
}

const byId = (json) => Object.fromEntries(json.tests.map((t) => [t.id, t]));

test('happy path: pair once, all of t1-t7 pass with t5 skipped, verdicts recorded, reports written', async (t) => {
  const [a, b] = await stubPair();
  t.after(() => Promise.all([a.stop(), b.stop()]));
  const code = await pairUp(a, b);
  assert.equal((await cli(b, ['pair', '--peer', a.peerId, '--confirm', code.replace('-', '')])).code, 0, 'a code typed without the dash is accepted');
  assert.equal((await cli(a, ['pair', '--peer', b.peerId, '--wait'])).json.paired, true);

  const [ta, tb] = await Promise.all([cli(a, ['test', '--peer', b.peerId]), cli(b, ['test', '--peer', a.peerId])]);
  for (const r of [ta, tb]) {
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 1));
    const m = byId(r.json);
    for (const id of ['t1_ping', 't2_snapshot', 't3_toggle', 't4_queue_move', 't6_kill_wake', 't7_cli_mail']) {
      assert.equal(m[id].result, 'passed', `${id}: ${JSON.stringify(m[id])}`);
    }
    assert.equal(m.t5_fleet_push.result, 'skipped');
    assert.match(m.t5_fleet_push.thisSide.detail, /--allow-push/);
    assert.equal(r.json.runId, ta.json.runId, 'both sides agreed on one run id');
  }
  // every verdict reached its own app's /mesh/probe; t3 restored the peer's agent exactly
  assert.equal(a.probes.length, 7);
  assert.equal(b.probes.length, 7);
  assert.equal(a.probes.find((p) => p.testId === 't5_fleet_push').passed, false);
  assert.match(a.probes.find((p) => p.testId === 't5_fleet_push').detail, /^skipped:/);
  assert.equal(a.probes.find((p) => p.testId === 't5_fleet_push').skipped, true, 'amendment A2: a skip says so');
  assert.equal(a.probes.find((p) => p.testId === 't1_ping').skipped, false);
  assert.equal(b.agents.find((x) => x.personaId === 'b-off').enabled, false);
  assert.equal(b.agents.find((x) => x.personaId === 'b-on').enabled, true, 'an enabled agent is never touched');
  assert.equal(a.queue.length, 0, 'the moved test entry left this queue');
  assert.match(byId(ta.json).t6_kill_wake.thisSide.detail, /Wake not exercised/);
  // the token never leaves the door
  assert.ok(!JSON.stringify(ta.json).includes(a.token));

  const rep = await cli(a, ['report', '--peer', b.peerId]);
  assert.equal(rep.code, 0);
  const md = fs.readFileSync(rep.json.path, 'utf8');
  assert.match(path.basename(rep.json.path), /^onboard-\d{4}-\d{2}-\d{2}-bbbbbbbb\.md$/);
  assert.match(md, /Totals: 6 passed, 0 failed, 1 skipped/);
  const st = await cli(a, ['status', '--peer', b.peerId]);
  assert.equal(st.json.nextStep, null, 'every step done');
  const list = await cli(a, ['status']);
  assert.equal(list.json.states[0].peerId, b.peerId);
});

test('pairing: a wrong code is refused and the human retypes within the TTL', async (t) => {
  const [a, b] = await stubPair();
  t.after(() => Promise.all([a.stop(), b.stop()]));
  const code = await pairUp(a, b);
  const wrong = code === '000-000' ? '111-111' : '000-000';
  const bad = await cli(b, ['pair', '--peer', a.peerId, '--confirm', wrong]);
  assert.equal(bad.code, 3);
  assert.equal(bad.json.error, 'code_mismatch');
  assert.equal(bad.json.retype, true);
  assert.ok(bad.json.secondsLeft > 0, 'the pending entry stays, with time left');
  const garbled = await cli(b, ['pair', '--peer', a.peerId, '--confirm', '12-34']);
  assert.equal(garbled.code, 3);
  assert.equal(garbled.json.error, 'bad_code_format');
  const good = await cli(b, ['pair', '--peer', a.peerId, '--confirm', code]);
  assert.equal(good.code, 0);
  assert.equal(good.json.paired, true);
  assert.equal((await cli(a, ['pair', '--peer', b.peerId, '--wait'])).json.paired, true);
  assert.ok(loadState(a.peerId, path.join(b.dataDir, 'mesh')).steps.paired);
  const initiatorTyping = await cli(a, ['pair', '--peer', b.peerId, '--confirm', code]);
  assert.equal(initiatorTyping.json.paired, true, 'already paired answers paired, whoever asks');
});

test('a peer that never appears: discover times out with the diagnostics fix; a test run aborts at hello', async (t) => {
  const [a, b] = await stubPair();
  t.after(() => Promise.all([a.stop(), b.stop()]));
  b.hidden = true;
  a.checks.find((c) => c.id === 'mdns_sees_peers').ok = false;
  a.checks.find((c) => c.id === 'mdns_sees_peers').fix = 'Set the network profile to Private';
  const pre = await cli(a, ['preflight']);
  assert.equal(pre.code, 0, 'mdns_sees_peers alone only warns');
  assert.equal(pre.json.warnings[0].id, 'mdns_sees_peers');
  const d = await cli(a, ['discover', '--timeout', '1']);
  assert.equal(d.code, 4);
  assert.equal(d.json.step, 'discover');
  assert.equal(d.json.error, 'timeout');
  assert.equal(d.json.fix, 'Set the network profile to Private');

  // paired, but the peer's CLI never runs: the hello barrier is time-boxed
  b.hidden = false;
  a.paired.add(b.peerId); b.paired.add(a.peerId); a.connected.add(b.peerId); b.connected.add(a.peerId);
  const r = await cli(a, ['test', '--peer', b.peerId]);
  assert.equal(r.code, 1);
  assert.equal(r.json.aborted.step, 'hello');
  assert.match(r.json.aborted.detail, /never joined/);
});

test('multicast blocked: discover --address dials the named LAN address and finds the hidden peer', async (t) => {
  const [a, b] = await stubPair();
  t.after(() => Promise.all([a.stop(), b.stop()]));
  b.hidden = true;
  b.address = '10.0.0.141:4242';
  const none = await cli(a, ['discover', '--timeout', '1']);
  assert.equal(none.code, 4, 'mDNS alone cannot see it');
  assert.match(none.json.fix, /--address/);
  const d = await cli(a, ['discover', '--timeout', '5', '--address', '10.0.0.141:4242']);
  assert.equal(d.code, 0, JSON.stringify(d.json));
  assert.equal(d.json.peerId, b.peerId);
  assert.equal(d.json.connected, true);
});

test('preflight red: a blocking check stops with its exact fix', async (t) => {
  const a = await new StubDoor({ projects: [] }).start();
  t.after(() => a.stop());
  const fw = a.checks.find((c) => c.id === 'firewall_rule');
  Object.assign(fw, { ok: false, detail: 'no inbound UDP rule', fix: 'netsh advfirewall firewall add rule name="Personas P2P" dir=in action=allow protocol=UDP localport=4242' });
  const r = await cli(a, ['preflight']);
  assert.equal(r.code, 1);
  assert.equal(r.json.failing[0].id, 'firewall_rule');
  assert.match(r.json.failing[0].fix, /netsh advfirewall/);
  fw.detail = 'could not read';
  assert.equal((await cli(a, ['preflight'])).code, 0, 'an unreadable firewall is a warning, not a block');
});

test('app not running / bad token: typed errors with a fix, token never echoed', async (t) => {
  const a = await new StubDoor({ projects: [] }).start();
  t.after(() => a.stop());
  let out = '';
  const io = (env) => ({ env, stdout: { write: (s) => { out += s; } }, stderr: { write: () => {} } });
  out = '';
  assert.equal(await main(['preflight'], io({ PERSONAS_HANDSHAKE: path.join(a.dataDir, 'nope.json') })), 1);
  assert.equal(JSON.parse(out).error, 'app_not_running');
  assert.match(JSON.parse(out).fix, /Start the Personas app/);
  const forged = path.join(a.dataDir, 'forged.json');
  fs.writeFileSync(forged, JSON.stringify({ port: a.port, token: 'wrong-token', pid: process.pid }));
  out = '';
  assert.equal(await main(['preflight'], io({ PERSONAS_HANDSHAKE: forged })), 1);
  assert.equal(JSON.parse(out).error, 'unauthorized');
  assert.ok(!out.includes('wrong-token') && !out.includes(a.token));
});

test('t3 with no disabled agent on the peer: this side skips, never toggles an enabled agent', async (t) => {
  const [a, b] = await stubPair({ bAgents: [{ personaId: 'b-on', name: 'Busy', enabled: true }] });
  t.after(() => Promise.all([a.stop(), b.stop()]));
  const code = await pairUp(a, b);
  await cli(b, ['pair', '--peer', a.peerId, '--confirm', code]);
  const [ta, tb] = await Promise.all([
    cli(a, ['test', '--peer', b.peerId, '--only', 't3_toggle']),
    cli(b, ['test', '--peer', a.peerId, '--only', 't3_toggle']),
  ]);
  const ma = byId(ta.json).t3_toggle;
  assert.equal(ma.thisSide.outcome, 'skipped');
  assert.match(ma.thisSide.detail, /no disabled agent/);
  assert.equal(ma.peerSide.outcome, 'passed');
  assert.equal(ma.result, 'skipped', 'passed needs BOTH sides passed');
  assert.equal(byId(tb.json).t3_toggle.result, 'skipped');
  assert.equal(b.agents[0].enabled, true);
  assert.equal(a.calls.filter((c) => c.path === '/mesh/verb').length, 0, 'no verb was sent to the peer');
});

test('a stalled job is a FAILED verdict naming the step it stalled on', async (t) => {
  const [a, b] = await stubPair();
  t.after(() => Promise.all([a.stop(), b.stop()]));
  const code = await pairUp(a, b);
  await cli(b, ['pair', '--peer', a.peerId, '--confirm', code]);
  a.stall.add('ping');
  const [ta, tb] = await Promise.all([
    cli(a, ['test', '--peer', b.peerId, '--only', 't1_ping,t7_cli_mail']),
    cli(b, ['test', '--peer', a.peerId, '--only', 't1_ping,t7_cli_mail']),
  ]);
  assert.equal(ta.code, 1);
  const t1 = byId(ta.json).t1_ping;
  assert.equal(t1.result, 'failed');
  assert.equal(t1.thisSide.stalledAt, 'wait_ping_terminal');
  assert.match(t1.thisSide.detail, /timed out .* at step wait_ping_terminal/);
  assert.equal(t1.peerSide.outcome, 'passed');
  assert.equal(byId(tb.json).t1_ping.result, 'failed', 'the peer sees the same combined failure');
  assert.equal(byId(ta.json).t7_cli_mail.result, 'passed', 'the suite carries on after a failure');
  assert.equal(a.probes.find((p) => p.testId === 't1_ping').passed, false);
});

test('resume from state after the CLI process is killed mid-test', async (t) => {
  const [a, b] = await stubPair();
  t.after(() => Promise.all([a.stop(), b.stop()]));
  const code = await pairUp(a, b);
  await cli(b, ['pair', '--peer', a.peerId, '--confirm', code]);
  a.jobStepMs = 250; // A's verbs travel slowly, so the kill lands while A waits on its enable receipt
  const scale = 0.02;
  const bRun = cli(b, ['test', '--peer', a.peerId, '--only', 't3_toggle'], { scale });
  const child = spawn(process.execPath, [ONBOARD, 'test', '--peer', b.peerId, '--only', 't3_toggle'], {
    env: { ...process.env, ...a.env({ MESH_ONBOARD_TIME_SCALE: String(scale) }) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((r) => child.on('exit', r));
  const file = statePath(b.peerId, path.join(a.dataDir, 'mesh'));
  const deadline = Date.now() + 15_000;
  let killedAt = null;
  while (Date.now() < deadline) {
    try {
      const st = JSON.parse(fs.readFileSync(file, 'utf8'));
      const s = st.run && st.run.tests.t3_toggle && st.run.tests.t3_toggle.steps;
      if (s && s.enable_sent && s.enable_sent.done && !s.enable_receipt) { killedAt = 'enable_receipt'; break; }
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(killedAt, 'enable_receipt', 'the child reached the enable step before the kill');
  child.kill('SIGKILL');
  await exited;
  const enables = () => a.calls.filter((c) => c.path === '/mesh/verb' && c.body.payload.verb === 'persona_set_enabled' && c.body.payload.enabled === true).length;
  assert.equal(enables(), 1);

  const resumed = await cli(a, ['test', '--peer', b.peerId, '--only', 't3_toggle'], { scale });
  const tb = await bRun;
  assert.equal(enables(), 1, 'the resumed run did not send the enable again: it resumed at its step');
  assert.equal(byId(resumed.json).t3_toggle.result, 'passed', JSON.stringify(resumed.json));
  assert.equal(byId(tb.json).t3_toggle.result, 'passed');
  assert.equal(resumed.json.runId, tb.json.runId, 'the resumed side kept the agreed run id');
  assert.equal(b.agents.find((x) => x.personaId === 'b-off').enabled, false, 'the agent is restored');
});

test('t5 with --allow-push: verified push, then the remote branch is deleted and proven gone', async (t) => {
  const [a, b] = await stubPair();
  t.after(() => Promise.all([a.stop(), b.stop()]));
  const code = await pairUp(a, b);
  await cli(b, ['pair', '--peer', a.peerId, '--confirm', code]);
  const gitCalls = [];
  const git = (args, opts) => { gitCalls.push({ args, cwd: opts.cwd }); return { code: 0, stdout: '', stderr: '' }; };
  const [ta, tb] = await Promise.all([
    cli(a, ['test', '--peer', b.peerId, '--only', 't5_fleet_push', '--allow-push'], { git }),
    cli(b, ['test', '--peer', a.peerId, '--only', 't5_fleet_push'], { git }),
  ]);
  const t5 = byId(ta.json).t5_fleet_push;
  assert.equal(t5.thisSide.outcome, 'passed', t5.thisSide.detail);
  assert.equal(t5.peerSide.outcome, 'skipped', 'B did not pass --allow-push');
  assert.equal(byId(tb.json).t5_fleet_push.thisSide.outcome, 'skipped');
  const del = gitCalls.find((c) => c.args.includes('--delete'));
  assert.match(del.args.at(-1), /^remote\/aaaaaaaa\/[a-z0-9]{1,8}$/);
  assert.equal(del.cwd, '/work/a/personas', 'deleted from THIS machine\'s checkout');
  assert.ok(gitCalls.some((c) => c.args[0] === 'ls-remote'));
  const dispatched = a.calls.find((c) => c.path === '/mesh/dispatch');
  assert.equal(dispatched.body.payload.branch, '', 'the branch is minted server-side');
  assert.equal(dispatched.body.payload.githubUrl, 'https://github.com/xkazm04/personas.git');
});

test('t4 refused move: FAILED at move_sent, the held entry was never lost, and cancel-test cleans it up', async (t) => {
  const [a, b] = await stubPair();
  t.after(() => Promise.all([a.stop(), b.stop()]));
  const code = await pairUp(a, b);
  await cli(b, ['pair', '--peer', a.peerId, '--confirm', code]);
  a.refuseMove = true;
  const [ta] = await Promise.all([
    cli(a, ['test', '--peer', b.peerId, '--only', 't4_queue_move']),
    cli(b, ['test', '--peer', a.peerId, '--only', 't4_queue_move']),
  ]);
  const t4 = byId(ta.json).t4_queue_move;
  assert.equal(t4.result, 'failed');
  assert.equal(t4.thisSide.stalledAt, 'move_sent');
  assert.match(t4.thisSide.detail, /project_not_found/);
  assert.ok(a.calls.some((c) => c.path === '/mesh/queue/cancel-test' && c.body.sessionId), 'the refused move is cleaned up (A4)');
  assert.match(t4.thisSide.detail, /\[cleanup: cancel-test: held entry cancelled here\]/);
  assert.equal(a.queue.length, 0, 'the held entry stayed until cancel-test removed it, never moved');
  assert.equal(t4.peerSide.outcome, 'passed');
});

test('stub sanity: unlinked door sees no peers', async (t) => {
  const solo = await new StubDoor({ projects: [] }).start();
  t.after(() => solo.stop());
  link(solo);
  const d = await cli(solo, ['discover', '--timeout', '1']);
  assert.equal(d.code, 4);
});
