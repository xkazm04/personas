// The mutual-test suite: both devices run every test, each records its OWN verdict through
// /mesh/probe, and a test passes only when BOTH sides' verdicts are passed. The two CLIs coordinate
// over the apps' CLI mailbox only (topics `onboard/<testId>/<step>`), never through the human.
//
// Shape of one run (persisted in state.run, so a killed session resumes at its step):
//   1. hello barrier   - each side mails `onboard/run/hello {nonce}` until the peer acks it; the
//                        run id is both nonces sorted, so stale mail from older runs is ignored.
//   2. per test, in order: act (this side against the peer) -> POST /mesh/probe -> mail
//      `onboard/<testId>/verdict` -> wait for the peer's verdict -> combine.
//
// Every wait is time-boxed. A timeout is a FAILED verdict naming the step it stalled on.

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { MeshError, isTerminal, jobReceipt, short8 } from './client.mjs';

export const TEST_IDS = ['t1_ping', 't2_snapshot', 't3_toggle', 't4_queue_move', 't5_fleet_push', 't6_kill_wake', 't7_cli_mail'];

/** The contract's snapshot staleness bound (D2). Never scaled: it is the app's rule, not a budget. */
export const SNAPSHOT_FRESH_MS = 45_000;

export const DEFAULT_TIMING = Object.freeze({
  pollMs: 2_000,
  helloMs: 10 * 60_000,
  helloResendMs: 5_000,
  pingMs: 90_000,
  snapshotMs: 60_000,
  verbMs: 90_000,
  toggleSeenMs: 90_000,
  entryVisibleMs: 30_000,
  moveAcceptMs: 60_000,
  entryGoneMs: 30_000,
  moveTerminalMs: 15 * 60_000,
  pushMs: 30 * 60_000,
  verifyMs: 2 * 60_000,
  runningMs: 5 * 60_000,
  killTerminalMs: 2 * 60_000,
  echoMs: 3 * 60_000,
  verdictSlackMs: 3 * 60_000,
});

/** DEFAULT_TIMING with every budget multiplied by `scale` (tests run the same code fast). */
export function scaledTiming(scale = 1, overrides = {}) {
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_TIMING)) out[k] = Math.max(1, Math.round(v * scale));
  return { ...out, ...overrides };
}

/** How long one test may take on the SLOWER side; the peer-verdict wait is this plus slack. */
export function testBudgetMs(testId, t) {
  switch (testId) {
    case 't1_ping': return t.pingMs;
    case 't2_snapshot': return t.snapshotMs;
    case 't3_toggle': return 2 * (t.verbMs + t.toggleSeenMs);
    case 't4_queue_move': return t.entryVisibleMs + t.moveAcceptMs + t.entryGoneMs + t.moveTerminalMs;
    case 't5_fleet_push': return t.pushMs + t.verifyMs;
    case 't6_kill_wake': return t.runningMs + t.killTerminalMs;
    case 't7_cli_mail': return t.echoMs;
    default: return t.pingMs;
  }
}

export class StepTimeout extends Error {
  constructor(step, ms, observed) {
    super(`timed out after ${Math.round(ms / 1000)} s at step ${step}${observed ? ` (last seen: ${observed})` : ''}`);
    this.step = step;
    this.observed = observed;
  }
}
export class StepFailure extends Error {
  constructor(step, detail) {
    super(detail);
    this.step = step;
  }
}
class Skip extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nonce8 = () => crypto.randomBytes(4).toString('hex');

/** `git` in `cwd`; never throws, returns {code, stdout, stderr}. */
export function defaultGit(args, { cwd } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  return { code: r.status === null ? -1 : r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || r.error?.message || '').trim() };
}

/** github.com/owner/repo, lowercased, for comparing an `origin` URL with a project's githubUrl. */
export function normalizeGitUrl(url) {
  if (!url) return null;
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^git@([^:]+):/, '$1/').replace(/^[a-z+]+:\/\//, '').replace(/^[^@/]+@/, '');
  u = u.replace(/\.git$/, '').replace(/\/+$/, '');
  return u;
}

const normPath = (p) => (p ? String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : null);

/**
 * The project both devices share (this repo): by githubUrl against this checkout's `origin`, then by
 * root path, then by a unique name match. Reads `/mesh/projects`; when that route is not served it
 * falls back to the dev-tools door's `GET /dev-tools/projects` (snake_case DevProject rows).
 */
export async function findSharedProject(client, repo = {}) {
  let projects;
  try {
    projects = (await client.projects()).projects;
  } catch (e) {
    if (!(e instanceof MeshError) || e.code !== 'not_found') throw e;
    projects = (await client.devToolsProjects()).map((p) => ({ id: p.id, name: p.name, githubUrl: p.github_url ?? null, rootPath: p.root_path }));
  }
  const want = normalizeGitUrl(repo.originUrl);
  const byUrl = want ? projects.filter((p) => normalizeGitUrl(p.githubUrl) === want) : [];
  if (byUrl.length === 1) return byUrl[0];
  const root = normPath(repo.root);
  const byRoot = root ? projects.filter((p) => normPath(p.rootPath) === root) : [];
  if (byRoot.length === 1) return byRoot[0];
  const base = root ? root.split('/').pop() : null;
  const byName = base ? projects.filter((p) => String(p.name || '').toLowerCase() === base) : [];
  if (byName.length === 1) return byName[0];
  return {
    none: true,
    reason: `no registered project matches this checkout (origin ${repo.originUrl || 'unknown'}); registered: ${projects.map((p) => p.name).join(', ') || 'none'}. Register the repo in Personas (Dev Tools > Projects) with its GitHub URL.`,
  };
}

function combine(local, peer) {
  if (local.outcome === 'failed' || peer.outcome === 'failed') {
    const who = [local.outcome === 'failed' ? 'this side' : null, peer.outcome === 'failed' ? 'peer side' : null].filter(Boolean).join(' and ');
    return { outcome: 'failed', detail: `failed on ${who}` };
  }
  if (local.outcome === 'passed' && peer.outcome === 'passed') return { outcome: 'passed', detail: 'passed on both sides' };
  return { outcome: 'skipped', detail: `this side ${local.outcome}, peer side ${peer.outcome}` };
}

/**
 * Run (or resume) the suite on this device's half.
 * @returns {Promise<{runId:string|null, aborted:object|null, tests:Array}>}
 */
export async function runSuite({
  client, state, save, selfPeerId, peerId,
  options = {}, timing = DEFAULT_TIMING, repo = {}, git = defaultGit, log = () => {},
}) {
  const requested = (options.only && options.only.length ? options.only : TEST_IDS).filter((t) => TEST_IDS.includes(t));
  if (state.run && state.run.done && !options.fresh) {
    state.history.push(state.run);
    state.run = null;
  }
  if (state.run && options.fresh) {
    state.history.push(state.run);
    state.run = null;
  }
  if (!state.run) {
    state.run = {
      nonce: nonce8(), sinceMs: Date.now(), startedAtMs: Date.now(),
      requested, allowPush: !!options.allowPush,
      runId: null, peerNonce: null, tests: {}, effective: null, aborted: null, done: false,
    };
    save();
  }
  const run = state.run;

  const readMail = async (prefix) => {
    const { mail } = await client.mail({ since: run.sinceMs, topic: prefix });
    const out = [];
    for (const m of mail || []) {
      if (m.peerId !== peerId) continue;
      let body;
      try { body = JSON.parse(m.body); } catch { continue; }
      out.push({ ...body, topic: m.topic, receivedAtMs: m.receivedAtMs });
    }
    return out;
  };
  const send = (topic, body) => client.sendMail(peerId, topic, { ...body, from: selfPeerId });

  // 1. hello barrier
  if (!run.runId) {
    log('waiting for the peer CLI to join the run (hello barrier)');
    const deadline = Date.now() + timing.helloMs;
    let nextHello = 0;
    const acked = new Set();
    let ack = null;
    let peerHello = null;
    while (!ack || !peerHello) {
      if (Date.now() > deadline) {
        run.aborted = { step: 'hello', detail: `the peer CLI never joined the run within ${Math.round(timing.helloMs / 1000)} s: run /mesh-onboard on the other machine` };
        run.done = true;
        save();
        return summarize(run);
      }
      try {
        if (!ack && Date.now() >= nextHello) {
          await send('onboard/run/hello', { kind: 'hello', nonce: run.nonce, tests: run.requested, allowPush: run.allowPush });
          nextHello = Date.now() + timing.helloResendMs;
        }
        const mails = await readMail('onboard/run/');
        for (const m of mails) {
          if (m.kind === 'hello' && !acked.has(m.nonce)) {
            await send('onboard/run/ack', { kind: 'ack', ackOf: m.nonce, nonce: run.nonce });
            acked.add(m.nonce);
          }
        }
        ack = mails.find((m) => m.kind === 'ack' && m.ackOf === run.nonce) || null;
        if (ack) peerHello = mails.find((m) => m.kind === 'hello' && m.nonce === ack.nonce) || null;
      } catch (e) {
        // Before the responder confirms, mail is refused with peer_not_paired: keep waiting.
        if (!(e instanceof MeshError)) throw e;
        log(`hello: ${e.code}`);
      }
      if (!ack || !peerHello) await sleep(timing.pollMs);
    }
    run.peerNonce = ack.nonce;
    run.runId = [run.nonce, ack.nonce].sort().join('-');
    const peerTests = Array.isArray(peerHello.tests) ? peerHello.tests : TEST_IDS;
    run.effective = run.requested.filter((t) => peerTests.includes(t));
    run.peerAllowPush = !!peerHello.allowPush;
    save();
    log(`run ${run.runId} agreed; tests: ${run.effective.join(', ')}`);
  }

  // 2. the tests
  for (const testId of run.effective) {
    const rec = (run.tests[testId] ||= { steps: {}, local: null, probe: null, verdictSent: false, peer: null, combined: null });
    if (rec.combined) continue;
    if (!rec.local) {
      log(`${testId}: acting against the peer`);
      rec.local = await actOne(testId, { client, rec, save, selfPeerId, peerId, options, timing, repo, git, log, run, readMail, send });
      save();
    }
    if (!rec.probe) {
      try {
        await client.probe({
          peerId, testId,
          passed: rec.local.outcome === 'passed',
          detail: rec.local.outcome === 'skipped' ? `skipped: ${rec.local.detail}` : rec.local.detail,
        });
        rec.probe = { recorded: true };
      } catch (e) {
        rec.probe = { recorded: false, error: e.message };
      }
      save();
    }
    if (!rec.verdictSent) {
      await sendWithRetry(() => send(`onboard/${testId}/verdict`, { kind: 'verdict', runId: run.runId, testId, ...rec.local }), timing);
      rec.verdictSent = true;
      save();
    }
    if (!rec.peer) {
      const waitMs = testBudgetMs(testId, timing) + timing.verdictSlackMs;
      const deadline = Date.now() + waitMs;
      log(`${testId}: waiting for the peer's verdict`);
      while (!rec.peer) {
        let mails = [];
        try { mails = await readMail(`onboard/${testId}/`); } catch (e) { if (!(e instanceof MeshError)) throw e; }
        // t7 keeps echoing here too, so a peer still in its own t7 never waits on us.
        if (testId === 't7_cli_mail') await echoPings(rec, mails, run, send);
        const v = mails.find((m) => m.kind === 'verdict' && m.runId === run.runId && m.testId === testId);
        if (v) rec.peer = { outcome: v.outcome, detail: v.detail ?? null, stalledAt: v.stalledAt ?? null };
        else if (Date.now() > deadline) rec.peer = { outcome: 'failed', detail: `the peer's verdict never arrived within ${Math.round(waitMs / 1000)} s`, stalledAt: 'wait_peer_verdict' };
        else await sleep(timing.pollMs);
      }
      save();
    }
    rec.combined = combine(rec.local, rec.peer);
    save();
    log(`${testId}: ${rec.combined.outcome} (this side ${rec.local.outcome}, peer ${rec.peer.outcome})`);
  }
  run.done = true;
  run.finishedAtMs = Date.now();
  save();
  return summarize(run);
}

async function sendWithRetry(fn, timing) {
  let last;
  for (let i = 0; i < 5; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(timing.pollMs); }
  }
  throw last;
}

async function echoPings(rec, mails, run, send) {
  rec.steps.echoed ||= { done: true, value: [] };
  for (const m of mails) {
    if (m.kind !== 'ping' || m.runId !== run.runId || rec.steps.echoed.value.includes(m.nonce)) continue;
    await send('onboard/t7_cli_mail/echo', { kind: 'echo', runId: run.runId, nonce: m.nonce });
    rec.steps.echoed.value.push(m.nonce);
  }
}

export function summarize(run) {
  const tests = (run.effective || []).map((id) => {
    const r = run.tests[id] || {};
    return { id, local: r.local || null, peer: r.peer || null, combined: r.combined || null };
  });
  const count = (o) => tests.filter((t) => t.combined && t.combined.outcome === o).length;
  return {
    runId: run.runId, aborted: run.aborted, done: !!run.done, tests,
    passed: count('passed'), failed: count('failed') + (run.aborted ? 1 : 0), skipped: count('skipped'),
  };
}

/** Run one test's ACTING half and turn its end into a local verdict. Never throws a test error. */
async function actOne(testId, env) {
  const { rec, save, timing, client, log } = env;
  const ctx = {
    ...env,
    async step(name, fn) {
      const s = rec.steps[name];
      if (s && s.done) return s.value;
      log(`${testId}: ${name}`);
      let value;
      try { value = await fn(); } catch (e) { if (e && typeof e === 'object' && !e.step && !(e instanceof Skip)) e.step = name; throw e; }
      rec.steps[name] = { done: true, value: value === undefined ? null : value, atMs: Date.now() };
      save();
      return value;
    },
    async waitFor(name, probe, timeoutMs) {
      return ctx.step(name, async () => {
        const deadline = Date.now() + timeoutMs;
        let observed = null;
        for (;;) {
          try {
            const r = await probe();
            if (r.done) return r.value === undefined ? true : r.value;
            observed = r.observed || null;
          } catch (e) {
            if (e instanceof StepFailure) throw e;
            if (!(e instanceof MeshError)) throw e;
            observed = e.message;
          }
          if (Date.now() > deadline) throw new StepTimeout(name, timeoutMs, observed);
          await sleep(timing.pollMs);
        }
      });
    },
    waitJob(name, jobId, timeoutMs) {
      return ctx.waitFor(name, async () => {
        const j = await client.job(jobId);
        return isTerminal(j.status)
          ? { done: true, value: slimJob(j) }
          : { done: false, observed: `job ${short8(jobId)} ${j.status}` };
      }, timeoutMs);
    },
    fail(step, detail) { throw new StepFailure(step, detail); },
    skip(reason) { throw new Skip(reason); },
  };
  try {
    const detail = await ACTS[testId](ctx);
    return { outcome: 'passed', detail, stalledAt: null };
  } catch (e) {
    if (e instanceof Skip) return { outcome: 'skipped', detail: e.message, stalledAt: null };
    const step = e.step || 'unexpected';
    const tail = e.cleanup ? ` [cleanup: ${e.cleanup}]` : '';
    return { outcome: 'failed', detail: `${e.message}${tail}`, stalledAt: step };
  }
}

function slimJob(j) {
  return { id: j.id, status: j.status, summary: j.summary ?? null, refusalReason: j.refusalReason ?? null, receipt: jobReceipt(j) };
}

async function peerView(client, peerId) {
  const d = await client.devices();
  return (d.devices || []).find((v) => v.peerId === peerId && !v.isSelf) || null;
}
async function selfView(client) {
  const d = await client.devices();
  return (d.devices || []).find((v) => v.isSelf) || null;
}

async function sendJob(fn) {
  const j = await fn();
  return { id: j.id, status: j.status, refusalReason: j.refusalReason ?? null };
}

function requireCompleted(ctx, step, job) {
  if (job.status !== 'completed') ctx.fail(step, `job ${short8(job.id)} ended ${job.status}: ${job.refusalReason || job.summary || 'no reason given'}`);
}

async function sharedProject(ctx) {
  const p = await ctx.step('find_project', () => findSharedProject(ctx.client, ctx.repo));
  if (p.none) ctx.fail('find_project', p.reason);
  return p;
}

/** Best-effort cleanup inside a failure path: runs fn, never throws, notes the outcome on the error. */
async function cleanup(e, label, fn) {
  try { e.cleanup = `${label}: ${await fn()}`; } catch (c) { e.cleanup = `${label} failed: ${c.message}`; }
  return e;
}

const ACTS = {
  // t1: provoked capability, never self-report.
  async t1_ping(ctx) {
    const { client, peerId, timing } = ctx;
    const sent = await ctx.step('send_ping', () => sendJob(() => client.verb(peerId, { verb: 'ping' })));
    if (sent.status === 'refused') ctx.fail('send_ping', `the peer refused the ping: ${sent.refusalReason}`);
    const job = await ctx.waitJob('wait_ping_terminal', sent.id, timing.pingMs);
    requireCompleted(ctx, 'wait_ping_terminal', job);
    const r = job.receipt;
    if (!r) ctx.fail('read_receipt', 'the ping job completed without a receipt');
    if (!r.ok) ctx.fail('read_receipt', `the ping receipt says ok=false: ${r.detail}`);
    if (!/\d+\.\d+\.\d+/.test(r.detail || '')) ctx.fail('read_receipt', `the ping receipt names no version: ${r.detail}`);
    return `peer answered ping: ${r.detail}`;
  },

  async t2_snapshot(ctx) {
    const { client, peerId, timing } = ctx;
    const seen = await ctx.waitFor('wait_live_snapshot', async () => {
      const v = await peerView(client, peerId);
      if (!v) return { done: false, observed: 'the peer is not in /mesh/devices' };
      if (v.liveness !== 'live' || !v.snapshot) return { done: false, observed: `liveness ${v.liveness}, snapshot ${v.snapshot ? 'present' : 'null'}` };
      const now = Date.now();
      const sentAge = now - v.snapshot.sentAtMs;
      const recvAge = v.receivedAtMs == null ? null : now - v.receivedAtMs;
      // Freshness is judged on this machine's clock (receivedAtMs) when the app gives it; the
      // sender's sentAtMs is only comparable to `now` if the two clocks agree.
      const age = recvAge == null ? sentAge : recvAge;
      if (age > SNAPSHOT_FRESH_MS) return { done: false, observed: `snapshot ${Math.round(age / 1000)} s old` };
      return { done: true, value: { sentAge, recvAge, appVersion: v.snapshot.appVersion, agents: v.snapshot.agents.length, queued: v.snapshot.queued } };
    }, timing.snapshotMs);
    const skew = seen.recvAge == null ? '' : `, sentAtMs age ${Math.round(seen.sentAge / 1000)} s`;
    return `peer snapshot live, ${Math.round((seen.recvAge ?? seen.sentAge) / 1000)} s old${skew}; app ${seen.appVersion}, ${seen.agents} agents, ${seen.queued} queued`;
  },

  // t3: toggle a DISABLED agent on and back off; state is restored exactly, an enabled agent is never touched.
  async t3_toggle(ctx) {
    const { client, peerId, timing, rec } = ctx;
    const pick = await ctx.step('pick_agent', async () => {
      const v = await peerView(client, peerId);
      if (!v || !v.snapshot) return { none: true, reason: 'no snapshot of the peer to pick an agent from' };
      const agents = v.snapshot.agents || [];
      const candidates = agents.filter((a) => a.enabled === false && !a.running && a.projectEnabled !== false);
      if (!candidates.length) {
        const off = agents.filter((a) => a.enabled === false).length;
        return { none: true, reason: `the peer has no disabled agent to toggle (${agents.length} agents, ${off} disabled, none eligible); an enabled agent is never toggled off` };
      }
      // "Least recently relevant": the snapshot carries no last-run time, so an agent with no
      // measured runs (dominant null) is preferred, then the name order keeps it deterministic.
      candidates.sort((a, b) => (a.dominant === null ? 0 : 1) - (b.dominant === null ? 0 : 1) || String(a.name).localeCompare(String(b.name)));
      return { personaId: candidates[0].personaId, name: candidates[0].name };
    });
    if (pick.none) ctx.skip(pick.reason);
    const seenAs = (enabled, name) => ctx.waitFor(name, async () => {
      const v = await peerView(client, peerId);
      const a = v && v.snapshot && v.snapshot.agents.find((x) => x.personaId === pick.personaId);
      if (!a) return { done: false, observed: 'the agent is not in the peer snapshot' };
      return a.enabled === enabled ? { done: true } : { done: false, observed: `enabled=${a.enabled}` };
    }, timing.toggleSeenMs);
    const setEnabled = async (enabled, sentStep, receiptStep) => {
      const sent = await ctx.step(sentStep, () => sendJob(() => client.verb(peerId, { verb: 'persona_set_enabled', personaId: pick.personaId, enabled })));
      if (sent.status === 'refused') ctx.fail(sentStep, `the peer refused: ${sent.refusalReason}`);
      const job = await ctx.waitJob(receiptStep, sent.id, timing.verbMs);
      requireCompleted(ctx, receiptStep, job);
      if (!job.receipt || !job.receipt.ok) ctx.fail(receiptStep, `the verb receipt says not ok: ${job.receipt ? job.receipt.detail : 'no receipt'}`);
    };
    try {
      await setEnabled(true, 'enable_sent', 'enable_receipt');
      await seenAs(true, 'enable_seen');
      await setEnabled(false, 'disable_sent', 'disable_receipt');
      await seenAs(false, 'disable_seen');
    } catch (e) {
      const enabledByUs = rec.steps.enable_sent && rec.steps.enable_sent.done;
      const restored = rec.steps.disable_seen && rec.steps.disable_seen.done;
      if (enabledByUs && !restored) {
        await cleanup(e, 'restore', async () => {
          const j = await client.verb(peerId, { verb: 'persona_set_enabled', personaId: pick.personaId, enabled: false });
          const deadline = Date.now() + timing.verbMs;
          let cur = j;
          while (!isTerminal(cur.status) && Date.now() < deadline) { await sleep(timing.pollMs); cur = await client.job(j.id); }
          return `disable sent again, job ${cur.status}`;
        });
      }
      throw e;
    }
    return `toggled "${pick.name}" on and back off on the peer; it is disabled again, as it was`;
  },

  async t4_queue_move(ctx) {
    const { client, peerId, timing } = ctx;
    const project = await sharedProject(ctx);
    const { sessionId } = await ctx.step('enqueue', async () => ({ sessionId: (await client.enqueueTest(project.id)).sessionId }));
    const inQueue = async () => {
      const v = await selfView(client);
      const q = (v && v.snapshot && v.snapshot.queue) || [];
      return q.some((e) => e.sessionId === sessionId);
    };
    await ctx.waitFor('entry_visible', async () => ((await inQueue()) ? { done: true } : { done: false, observed: 'the held entry is not in this device\'s queue' }), timing.entryVisibleMs);
    const sent = await ctx.step('move_sent', () => sendJob(() => client.queueMove(sessionId, peerId)));
    if (sent.status === 'refused') ctx.fail('move_sent', `the peer refused the move: ${sent.refusalReason}; held entry ${short8(sessionId)} stays queued here and will run the one-word prompt locally in 10 min`);
    await ctx.waitFor('move_accepted', async () => {
      const j = await client.job(sent.id);
      if (j.status === 'refused') throw new StepFailure('move_accepted', `the peer refused the move: ${j.refusalReason}`);
      return j.status === 'queued' ? { done: false, observed: 'move job still queued (peer offline?)' } : { done: true, value: j.status };
    }, timing.moveAcceptMs);
    await ctx.waitFor('entry_gone', async () => ((await inQueue()) ? { done: false, observed: 'the moved entry is still queued here' } : { done: true }), timing.entryGoneMs);
    const job = await ctx.waitJob('wait_peer_terminal', sent.id, timing.moveTerminalMs);
    requireCompleted(ctx, 'wait_peer_terminal', job);
    return `held entry ${short8(sessionId)} moved, accepted, cancelled here, and ran to completed on the peer`;
  },

  async t5_fleet_push(ctx) {
    const { client, peerId, timing, options, repo, git, rec } = ctx;
    if (!options.allowPush) ctx.skip('push not authorized on this side; re-run with --allow-push to commit, push and delete a throwaway branch');
    const project = await sharedProject(ctx);
    if (!project.githubUrl) ctx.fail('find_project', `project ${project.name} has no GitHub URL; the peer resolves the project by it`);
    const tag = await ctx.step('nonce', async () => nonce8());
    const prompt = `Create the file mesh-probe/${tag}.txt containing the single line "mesh onboarding probe ${tag}". `
      + `Commit only that file with the message "chore(mesh): onboarding push probe ${tag}". Make no other change. `
      + 'When done, end your final message with FLEET:DONE.';
    const sent = await ctx.step('dispatch_sent', () => sendJob(() => client.dispatch(peerId, {
      projectId: project.id, githubUrl: project.githubUrl, projectName: project.name,
      prompt, mode: 'headless', branch: '', personaId: null,
    })));
    if (sent.status === 'refused') ctx.fail('dispatch_sent', `the peer refused the session: ${sent.refusalReason}`);
    const cwd = project.rootPath || repo.root;
    try {
      const job = await ctx.waitJob('wait_push_terminal', sent.id, timing.pushMs);
      requireCompleted(ctx, 'wait_push_terminal', job);
      const r = await ctx.waitFor('wait_verified', async () => {
        const rc = jobReceipt(await client.job(sent.id));
        if (!rc) return { done: false, observed: 'no receipt yet' };
        if (!rc.pushedSha) throw new StepFailure('wait_verified', `nothing was pushed: ${rc.pushError || 'no pushedSha'}`);
        return rc.verified === null || rc.verified === undefined ? { done: false, observed: 'pushed, verification pending' } : { done: true, value: rc };
      }, timing.verifyMs);
      if (r.verified !== true) ctx.fail('wait_verified', `the pushed SHA ${String(r.pushedSha).slice(0, 7)} did not verify on this side`);
      if (!/^remote\/[a-z0-9]+\/[a-z0-9]+$/.test(r.branch || '')) ctx.fail('delete_branch', `refusing to delete branch "${r.branch}": not a remote/<peer8>/<job8> probe branch`);
      await deleteBranch(ctx, cwd, r.branch);
      return `pushed ${String(r.pushedSha).slice(0, 7)} on ${r.branch}, verified on both sides, remote branch deleted`;
    } catch (e) {
      const branch = rec.steps.wait_verified && rec.steps.wait_verified.value && rec.steps.wait_verified.value.branch;
      if (branch && /^remote\//.test(branch) && !(rec.steps.verify_gone && rec.steps.verify_gone.done)) {
        await cleanup(e, 'branch delete', async () => {
          const d = git(['push', 'origin', '--delete', branch], { cwd });
          return d.code === 0 ? `deleted ${branch}` : d.stderr.split('\n')[0];
        });
      }
      throw e;
    }
  },

  async t6_kill_wake(ctx) {
    const { client, peerId, timing, rec } = ctx;
    const project = await sharedProject(ctx);
    const sent = await ctx.step('dispatch_sent', () => sendJob(() => client.dispatch(peerId, {
      projectId: project.id, githubUrl: project.githubUrl || '', projectName: project.name,
      prompt: 'Mesh onboarding kill probe. Wait for input: run no command, edit no file, and do nothing until a message arrives.',
      mode: 'interactive', branch: '', personaId: null,
    })));
    if (sent.status === 'refused') ctx.fail('dispatch_sent', `the peer refused the session: ${sent.refusalReason}`);
    try {
      await ctx.waitFor('wait_running', async () => {
        const j = await client.job(sent.id);
        if (isTerminal(j.status)) throw new StepFailure('wait_running', `the waiting session ended on its own (${j.status}) before it could be killed`);
        return j.status === 'running' ? { done: true } : { done: false, observed: `job ${j.status}` };
      }, timing.runningMs);
      const cmd = await ctx.step('kill_sent', () => client.sessionCommand(sent.id, 'kill', null));
      if (!cmd.accepted) ctx.fail('kill_sent', `the peer did not accept kill: ${cmd.reason}`);
      const job = await ctx.waitJob('wait_killed_terminal', sent.id, timing.killTerminalMs);
      return `interactive session reached running; kill accepted; job ended ${job.status}. Wake not exercised: no door hibernates a session on demand, and wake on a killed session proves nothing`;
    } catch (e) {
      if (!(rec.steps.kill_sent && rec.steps.kill_sent.done)) {
        await cleanup(e, 'kill', async () => {
          const c = await client.sessionCommand(sent.id, 'kill', null);
          return c.accepted ? 'kill accepted' : `kill refused: ${c.reason}`;
        });
      }
      throw e;
    }
  },

  // t7: a mail round trip; it also answers the peer's ping, so both directions close.
  async t7_cli_mail(ctx) {
    const { timing, run, readMail, send, rec } = ctx;
    const nonce = await ctx.step('ping_sent', async () => {
      const n = crypto.randomBytes(8).toString('hex');
      await send('onboard/t7_cli_mail/ping', { kind: 'ping', runId: run.runId, nonce: n });
      return n;
    });
    const sentAt = Date.now();
    const deadline = sentAt + timing.echoMs;
    let echoed = rec.steps.echo_seen && rec.steps.echo_seen.done;
    let answered = false;
    while (!(echoed && answered)) {
      const mails = await readMail('onboard/t7_cli_mail/');
      await echoPings(rec, mails, run, send);
      answered = rec.steps.echoed.value.length > 0;
      if (!echoed && mails.some((m) => m.kind === 'echo' && m.runId === run.runId && m.nonce === nonce)) {
        echoed = true;
        rec.steps.echo_seen = { done: true, value: Date.now() - sentAt, atMs: Date.now() };
        ctx.save();
      }
      if (echoed && answered) break;
      if (Date.now() > deadline) {
        if (echoed) break; // our round trip closed; the peer's ping may still come during the verdict wait
        throw new StepTimeout('wait_echo', timing.echoMs, answered ? 'the peer\'s ping was answered, our echo never came' : 'no echo and no ping from the peer');
      }
      await sleep(timing.pollMs);
    }
    return `nonce ${nonce.slice(0, 8)} echoed back by the peer CLI${answered ? '; the peer\'s ping was echoed too' : ''}`;
  },
};

async function deleteBranch(ctx, cwd, branch) {
  const { git } = ctx;
  await ctx.step('delete_branch', async () => {
    const d = git(['push', 'origin', '--delete', branch], { cwd });
    if (d.code !== 0) ctx.fail('delete_branch', `git push origin --delete ${branch} failed: ${d.stderr.split('\n')[0]}`);
    return true;
  });
  await ctx.step('verify_gone', async () => {
    const l = git(['ls-remote', '--heads', 'origin', branch], { cwd });
    if (l.code !== 0) ctx.fail('verify_gone', `git ls-remote failed: ${l.stderr.split('\n')[0]}`);
    if (l.stdout) ctx.fail('verify_gone', `${branch} is still on origin after the delete`);
    return true;
  });
}
