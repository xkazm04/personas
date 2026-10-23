// An in-memory implementation of the frozen `/mesh` door contract, for `node --test scripts/mesh`.
//
// Each StubDoor is one "app": a real HTTP server on 127.0.0.1 behind the same token check as the
// real local_http auth layer, plus a handshake file {port, token, pid} in its own data dir. Two
// doors linked with `link(a, b)` see each other on a fake LAN, pair through the fingerprint
// ceremony (the responder types the initiator's code), and carry verbs, mail, dispatches and queue
// moves to each other as remote jobs that progress on timers.
//
// Knobs (set on the instance): hidden, stall (Set of job kinds or verbs that never finish),
// refuseMove, pushSha, jobStepMs (how long each job hop takes), checks (the diagnostics).

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { short8 } from './client.mjs';

const ERR = (status, code, error) => ({ status, body: { error, code } });

function jobRow({ id, peer, kind, payload }) {
  const now = new Date().toISOString();
  return {
    id, direction: 'outbound', peerId: peer.peerId, peerDisplayName: peer.displayName, kind, instruction: '',
    payloadJson: payload === undefined ? null : JSON.stringify(payload),
    receipt: null, meshReceipt: null, status: 'pending', summary: null, refusalReason: null, lastSeq: 0,
    createdAt: now, updatedAt: now, completedAt: null,
  };
}

export class StubDoor {
  constructor({ peerId, displayName, appVersion = '0.42.0', features = 'desktop,p2p', agents = [], projects = [], dataDir } = {}) {
    this.peerId = peerId || `12D3Koo${crypto.randomBytes(12).toString('hex')}`;
    this.displayName = displayName || `stub-${short8(this.peerId)}`;
    this.appVersion = appVersion;
    this.features = features;
    this.token = crypto.randomBytes(16).toString('hex');
    this.ownsDataDir = !dataDir;
    this.dataDir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-stub-'));
    this.agents = agents.map((a) => ({ projectId: null, projectEnabled: null, dominant: null, running: false, ...a }));
    this.projects = projects;
    this.queue = [];
    this.jobs = new Map();
    this.mailbox = [];
    this.probes = [];
    this.pairings = new Map();
    this.paired = new Set();
    this.connected = new Set();
    this.lan = null;
    this.checks = [
      { id: 'p2p_built', ok: true, detail: 'p2p compiled in', fix: null },
      { id: 'network_running', ok: true, detail: 'running', fix: null },
      { id: 'udp_bound', ok: true, detail: 'QUIC on 4242', fix: null },
      { id: 'firewall_rule', ok: true, detail: 'rule present', fix: null },
      { id: 'network_profile', ok: true, detail: 'Private', fix: null },
      { id: 'mdns_sees_peers', ok: true, detail: '1 peer', fix: null },
    ];
    // knobs
    this.hidden = false;
    this.stall = new Set();
    this.refuseMove = false;
    this.pushSha = true;
    this.jobStepMs = 15;
    this.calls = [];
    this.timers = new Set();
  }

  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
    this.handshakeFile = path.join(this.dataDir, 'local-http.json');
    fs.writeFileSync(this.handshakeFile, JSON.stringify({ port: this.port, token: this.token, pid: process.pid }));
    return this;
  }

  async stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise((r) => this.server.close(r));
    }
    // A data dir this door created is this door's to remove (rmSync does not follow links).
    if (this.ownsDataDir) fs.rmSync(this.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  /** The env a CLI on this "machine" runs with. */
  env(extra = {}) {
    return { PERSONAS_HANDSHAKE: this.handshakeFile, PERSONAS_DATA_DIR: this.dataDir, ...extra };
  }

  other(peerId) {
    return this.lan ? this.lan.find((d) => d !== this && d.peerId === peerId) : null;
  }

  // ---- HTTP plumbing --------------------------------------------------------------------------
  async handle(req, res) {
    const send = (status, body) => {
      const text = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' });
      res.end(text);
    };
    if (req.headers['x-personas-local-token'] !== this.token) {
      return send(401, 'missing or invalid local token; see ~/.personas/local-http.json');
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { return send(400, { error: 'body is not JSON', code: 'bad_request' }); } }
    const url = new URL(req.url, 'http://x');
    this.calls.push({ method: req.method, path: url.pathname, body });
    let out;
    try {
      out = this.route(req.method, url, body, req.headers);
    } catch (e) {
      out = ERR(500, 'internal', e.message);
    }
    if (!out) return send(404); // axum's unrouted 404: empty body
    send(out.status || 200, out.body);
  }

  route(method, url, body, headers) {
    const p = url.pathname;
    const key = `${method} ${p}`;
    if (p.startsWith('/mesh/jobs/') && method === 'GET') {
      const j = this.jobs.get(decodeURIComponent(p.slice('/mesh/jobs/'.length)));
      return j ? { body: j } : ERR(404, 'not_found', 'no such job');
    }
    switch (key) {
      case 'GET /mesh/status':
        return { body: { appVersion: this.appVersion, p2p: true, networkRunning: true, peerId: this.peerId, displayName: this.displayName, quicPort: 4242, dataDirIsolated: true } };
      case 'GET /mesh/diagnostics':
        return { body: { checks: this.checks } };
      case 'GET /mesh/devices':
        return { body: this.devicesView() };
      case 'POST /mesh/connect': {
        // An explicit LAN address reaches a peer mDNS cannot see (hidden): the
        // dialled peer then shows up in discovery, as the real door records it.
        if (body && body.address) {
          const byAddr = (this.lan || []).find((d) => d !== this && d.address === body.address);
          if (!byAddr) return { body: { connected: false, detail: `nothing answered at ${body.address}` } };
          this.dialled = this.dialled || new Set();
          this.dialled.add(byAddr.peerId);
          this.connected.add(byAddr.peerId); byAddr.connected.add(this.peerId);
          return { body: { connected: true, detail: `connected to ${byAddr.peerId}` } };
        }
        const o = this.other(body && body.peerId);
        if (!o || o.hidden) return { body: { connected: false, detail: 'peer not discovered' } };
        this.connected.add(o.peerId); o.connected.add(this.peerId);
        return { body: { connected: true, detail: null } };
      }
      case 'POST /mesh/pair/request': return this.pairRequest(body);
      case 'GET /mesh/pair/pending':
        return { body: { pending: [...this.pairings.entries()].filter(([, v]) => v.expiresAtMs > Date.now()).map(([peerId, v]) => ({ peerId, displayName: this.other(peerId)?.displayName || null, role: v.role, expiresAtMs: v.expiresAtMs })) } };
      case 'POST /mesh/pair/confirm': return this.pairConfirm(body);
      case 'POST /mesh/verb': return this.outbound(body.peerId, 'mesh_verb', body.payload);
      case 'POST /mesh/dispatch': return this.outbound(body.peerId, 'fleet_session', body.payload);
      case 'POST /mesh/mail': {
        if (Buffer.byteLength(String(body.body || ''), 'utf8') > 16 * 1024) return ERR(400, 'bad_request', 'mail body over 16 KB');
        return this.outbound(body.peerId, 'cli_mail', { topic: body.topic, body: body.body });
      }
      case 'GET /mesh/mail': {
        const since = Number(url.searchParams.get('since') || 0);
        const topic = url.searchParams.get('topic') || '';
        return { body: { mail: this.mailbox.filter((m) => m.receivedAtMs >= since && m.topic.startsWith(topic)) } };
      }
      case 'POST /mesh/session-command': return this.sessionCommand(body);
      case 'POST /mesh/queue/enqueue-test': {
        if (headers['x-mesh-onboard'] !== '1') return ERR(403, 'refused', 'onboarding only: x-mesh-onboard header missing');
        const proj = this.projects.find((x) => x.id === body.projectId);
        if (!proj) return ERR(404, 'not_found', 'no such project');
        const sessionId = `sess-${crypto.randomBytes(6).toString('hex')}`;
        this.queue.push({ sessionId, title: 'mesh-onboard', projectLabel: proj.name, rank: this.queue.length, machineUnits: 1, gpu: 'none', prompt: 'Reply with the single word MESH-OK and exit.', runLabel: 'mesh-onboard', project: proj });
        return { body: { sessionId } };
      }
      case 'POST /mesh/queue/move': return this.queueMove(body);
      case 'POST /mesh/queue/cancel-test': {
        if (headers['x-mesh-onboard'] !== '1') return ERR(403, 'refused', 'onboarding only: x-mesh-onboard header missing');
        const idx = this.queue.findIndex((e) => e.sessionId === body.sessionId);
        if (idx < 0) return { body: { cancelled: false } };
        if (this.queue[idx].runLabel !== 'mesh-onboard') return ERR(400, 'bad_request', 'cancel-test only cancels mesh-onboard entries');
        this.queue.splice(idx, 1);
        return { body: { cancelled: true } };
      }
      case 'GET /mesh/projects': return { body: { projects: this.projects } };
      case 'POST /mesh/probe':
        this.probes.push(body);
        return { body: { recorded: true } };
      default:
        return null;
    }
  }

  // ---- views ---------------------------------------------------------------------------------
  snapshot() {
    return {
      peerId: this.peerId, displayName: this.displayName, appVersion: this.appVersion, sentAtMs: Date.now() - 500,
      host: { cpuShare: 0.1, ramShare: 0.3, gpuShare: null },
      running: [...this.jobs.values()].filter((j) => j.status === 'running').length,
      queued: this.queue.length,
      agents: this.agents.map((a) => ({ ...a })),
      queue: this.queue.map(({ sessionId, title, projectLabel, rank, machineUnits, gpu }) => ({ sessionId, title, projectLabel, rank, machineUnits, gpu })),
    };
  }

  devicesView() {
    const self = { peerId: this.peerId, displayName: this.displayName, isSelf: true, isHome: true, reachability: 'connected', liveness: 'live', snapshot: this.snapshot(), receivedAtMs: Date.now(), lastProbe: this.probes.at(-1) || null };
    const devices = [self];
    for (const id of this.paired) {
      const o = this.other(id);
      const up = o && this.connected.has(id);
      devices.push({ peerId: id, displayName: o ? o.displayName : id, isSelf: false, isHome: false, reachability: up ? 'connected' : 'offline', liveness: up ? 'live' : 'unknown', snapshot: up ? o.snapshot() : null, receivedAtMs: up ? Date.now() - 400 : null, lastProbe: null });
    }
    const discovered = (this.lan || []).filter((d) => d !== this && (!d.hidden || (this.dialled && this.dialled.has(d.peerId)))).map((d) => ({ peerId: d.peerId, displayName: d.displayName, lastSeenMs: Date.now(), paired: this.paired.has(d.peerId), connected: this.connected.has(d.peerId) }));
    return { devices, discovered };
  }

  // ---- pairing --------------------------------------------------------------------------------
  pairRequest(body) {
    const o = this.other(body && body.peerId);
    if (!o || o.hidden) return ERR(404, 'not_found', 'peer not discovered');
    if (!this.connected.has(o.peerId)) return ERR(400, 'bad_request', 'peer not connected');
    const n = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const code = `${n.slice(0, 3)}-${n.slice(3)}`;
    const expiresAtMs = Date.now() + 5 * 60_000;
    this.pairings.set(o.peerId, { role: 'initiator', code, expiresAtMs });
    this.later(this.jobStepMs, () => o.pairings.set(this.peerId, { role: 'responder', code, expiresAtMs }));
    return { body: { code } };
  }

  pairConfirm(body) {
    const entry = this.pairings.get(body.peerId);
    if (!entry || entry.expiresAtMs < Date.now()) return ERR(404, 'no_pending_pairing', 'no pending pairing with that peer');
    if (entry.role !== 'responder') return ERR(400, 'bad_request', 'confirm happens on the responding device');
    if (entry.code !== body.code) return ERR(409, 'code_mismatch', 'the code does not match');
    const o = this.other(body.peerId);
    this.pairings.delete(body.peerId);
    this.paired.add(body.peerId);
    if (o) { o.pairings.delete(this.peerId); o.paired.add(this.peerId); }
    return { body: { paired: true } };
  }

  // ---- remote jobs ----------------------------------------------------------------------------
  outbound(peerId, kind, payload) {
    if (!this.paired.has(peerId)) return ERR(409, 'peer_not_paired', 'that device is not paired');
    const o = this.other(peerId);
    const id = `job-${crypto.randomBytes(8).toString('hex')}`;
    const j = jobRow({ id, peer: o, kind, payload });
    this.jobs.set(id, j);
    const stalled = this.stall.has(kind) || (kind === 'mesh_verb' && this.stall.has(payload.verb));
    if (kind === 'fleet_session') this.runFleet(j, o, payload, stalled);
    else if (!stalled) this.later(this.jobStepMs, () => { this.set(j, 'running'); this.later(this.jobStepMs, () => this.execute(j, o, kind, payload)); });
    else this.later(this.jobStepMs, () => this.set(j, 'running'));
    return { body: j };
  }

  set(j, status, extra = {}) {
    Object.assign(j, { status, updatedAt: new Date().toISOString() }, extra);
    if (!['queued', 'pending', 'running'].includes(status)) j.completedAt = new Date().toISOString();
  }

  execute(j, o, kind, payload) {
    if (kind === 'cli_mail') {
      o.mailbox.push({ jobId: j.id, peerId: this.peerId, topic: payload.topic, body: payload.body, receivedAtMs: Date.now() });
      return this.set(j, 'completed', { summary: 'delivered' });
    }
    if (kind === 'mesh_verb') {
      let receipt;
      if (payload.verb === 'ping') receipt = { verb: 'ping', ok: true, detail: `${o.appVersion} ${o.features}` };
      else if (payload.verb === 'persona_set_enabled') {
        const a = o.agents.find((x) => x.personaId === payload.personaId);
        if (a) a.enabled = !!payload.enabled;
        receipt = { verb: payload.verb, ok: !!a, detail: a ? null : 'no such persona' };
      } else receipt = { verb: payload.verb, ok: false, detail: 'not modelled by the stub' };
      return this.set(j, 'completed', { meshReceipt: receipt, summary: receipt.detail });
    }
    return this.set(j, 'failed', { summary: `unknown kind ${kind}` });
  }

  runFleet(j, o, payload, stalled) {
    const branch = `remote/${short8(this.peerId)}/${short8(j.id)}`;
    this.later(this.jobStepMs, () => {
      this.set(j, 'running');
      if (stalled) return;
      if (payload.mode === 'interactive') return; // runs until killed
      this.later(this.jobStepMs * 2, () => {
        const pushes = /commit/i.test(payload.prompt || '') && this.pushSha;
        const receipt = { sessionId: `sess-${short8(j.id)}`, branch, pushedSha: pushes ? crypto.randomBytes(20).toString('hex') : null, pushError: pushes ? null : 'no commits', verified: pushes ? true : null };
        this.set(j, 'completed', { receipt, summary: 'FLEET:DONE' });
      });
    });
  }

  sessionCommand(body) {
    const j = this.jobs.get(body.jobId);
    if (!j) return ERR(404, 'not_found', 'no such job');
    if (body.command === 'kill') {
      if (j.status !== 'running') return { body: { accepted: false, reason: `session is ${j.status}` } };
      this.later(this.jobStepMs, () => this.set(j, 'cancelled', { summary: 'killed' }));
      return { body: { accepted: true, reason: null } };
    }
    if (body.command === 'wake') return { body: { accepted: false, reason: 'the session is not hibernated' } };
    return { body: { accepted: j.status === 'running', reason: j.status === 'running' ? null : `session is ${j.status}` } };
  }

  queueMove(body) {
    const idx = this.queue.findIndex((e) => e.sessionId === body.sessionId);
    if (idx < 0) return ERR(404, 'not_found', 'no such queued entry');
    if (!this.paired.has(body.peerId)) return ERR(409, 'peer_not_paired', 'that device is not paired');
    const entry = this.queue[idx];
    const o = this.other(body.peerId);
    const id = `job-${crypto.randomBytes(8).toString('hex')}`;
    const j = jobRow({ id, peer: o, kind: 'fleet_session', payload: { prompt: entry.prompt, mode: 'headless' } });
    this.jobs.set(id, j);
    if (this.refuseMove) {
      this.set(j, 'refused', { refusalReason: 'project_not_found' });
      return { body: j };
    }
    this.queue.splice(idx, 1); // cancelled here: moved:<peer8>, only after the peer accepted
    this.runFleet(j, o, { prompt: entry.prompt, mode: 'headless' }, this.stall.has('fleet_session'));
    return { body: j };
  }
}

/** Put doors on one LAN (each sees the others unless `hidden`). */
export function link(...doors) {
  for (const d of doors) d.lan = doors;
  return doors;
}

/** Two started, linked stub doors with a shared personas project. */
export async function stubPair({ aAgents, bAgents, origin = 'https://github.com/xkazm04/personas.git' } = {}) {
  const projects = (tag) => [{ id: `proj-${tag}`, name: 'personas', githubUrl: origin, rootPath: `/work/${tag}/personas` }];
  const agents = (prefix) => [
    { personaId: `${prefix}-on`, name: 'Always On', enabled: true, dominant: 'cpu' },
    { personaId: `${prefix}-off`, name: 'Dormant Helper', enabled: false, dominant: null },
  ];
  const a = new StubDoor({ peerId: 'AAAAAAAAstubpeerone', displayName: 'Desk A', agents: aAgents || agents('a'), projects: projects('a') });
  const b = new StubDoor({ peerId: 'BBBBBBBBstubpeertwo', displayName: 'Desk B', agents: bAgents || agents('b'), projects: projects('b') });
  link(a, b);
  await a.start();
  await b.start();
  return [a, b];
}
