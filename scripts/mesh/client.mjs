// The `/mesh` door client: the ONE way the onboarding CLI talks to its own Personas app.
//
// Contract: the Director's frozen `/mesh` wire contract (spark device-mesh, WP0). Port and token
// come from the handshake file the app writes; resolution order is
//   1. env PERSONAS_HANDSHAKE (an explicit path),
//   2. <PERSONAS_DATA_DIR>/local-http.json when PERSONAS_DATA_DIR is set (dev-only one-box rule),
//   3. ~/.personas/local-http.json.
//
// The local token is a secret: it is sent as a header and NEVER placed in an error message, a log
// line or a returned object. Importing this file touches neither the network nor the handshake.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** The app waits up to 45 s for a peer's ack on a verb/move/dispatch; leave headroom above it. */
export const ACK_REQUEST_TIMEOUT_MS = 60_000;
/** Body cap of one `cli_mail` (16 KB), enforced by the app with a 400; checked here first. */
export const CLI_MAIL_MAX_BYTES = 16 * 1024;

const TERMINAL = new Set(['completed', 'failed', 'refused', 'cancelled']);
const NON_TERMINAL = new Set(['queued', 'pending', 'running']);

/** Every typed failure of the door carries a machine `code` plus the HTTP status (0 = no response). */
export class MeshError extends Error {
  constructor(message, { code = 'internal', status = 0, route = null } = {}) {
    super(message);
    this.name = 'MeshError';
    this.code = code;
    this.status = status;
    this.route = route;
  }
}
/** No handshake file: the app is not running (or runs under another data dir). */
export class HandshakeError extends MeshError {
  constructor(message, file) {
    super(message, { code: 'app_not_running' });
    this.name = 'HandshakeError';
    this.file = file;
  }
}
/** The handshake exists but nothing answers on its port. */
export class UnreachableError extends MeshError {
  constructor(message, route) {
    super(message, { code: 'unreachable', route });
    this.name = 'UnreachableError';
  }
}
/** The app accepted the connection but did not answer within the request's budget. */
export class RequestTimeoutError extends MeshError {
  constructor(message, route) {
    super(message, { code: 'request_timeout', route });
    this.name = 'RequestTimeoutError';
  }
}

/** Up to eight lowercase alphanumerics of an id: the same rule as the app's `short8` (remote_exec.rs). */
export function short8(id) {
  return String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase();
}

/** True for every `RemoteJobStatus` except queued / pending / running. Unknown tokens count as terminal. */
export function isTerminal(status) {
  if (TERMINAL.has(status)) return true;
  return !NON_TERMINAL.has(status);
}

/** The lexicographically smaller peerId initiates (the app's `should_dial` rule, D6). */
export function roleFor(selfPeerId, peerId) {
  return String(selfPeerId) < String(peerId) ? 'initiator' : 'responder';
}

/** A typed code in any human spelling ("042917", "042 917", "042-917") -> "042-917", or null. */
export function normalizeCode(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length !== 6) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

/**
 * The receipt of a job, parsed. The app's RemoteJob carries a `mesh_verb` outcome in `meshReceipt`
 * (contract amendment A1) and a `fleet_session` outcome in `receipt`; the original contract named
 * `receiptJson` (a JSON string), still read as a fallback. Null when none is present.
 */
export function jobReceipt(job) {
  if (!job) return null;
  if (job.meshReceipt && typeof job.meshReceipt === 'object') return job.meshReceipt;
  if (typeof job.receiptJson === 'string' && job.receiptJson) {
    try { return JSON.parse(job.receiptJson); } catch { return null; }
  }
  if (job.receipt && typeof job.receipt === 'object') return job.receipt;
  return null;
}

/** Where the handshake is read from, per the contract's resolution order. */
export function resolveHandshakePath(env = process.env) {
  if (env.PERSONAS_HANDSHAKE) return env.PERSONAS_HANDSHAKE;
  if (env.PERSONAS_DATA_DIR) return path.join(env.PERSONAS_DATA_DIR, 'local-http.json');
  return path.join(os.homedir(), '.personas', 'local-http.json');
}

/** {port, token, pid, file}. Throws HandshakeError when the file is absent or unreadable. */
export function readHandshake(env = process.env) {
  const file = resolveHandshakePath(env);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch {
    throw new HandshakeError(`no handshake file at ${file}: the Personas app is not running`, file);
  }
  let h;
  try { h = JSON.parse(raw); } catch {
    throw new HandshakeError(`the handshake file at ${file} is not JSON`, file);
  }
  if (!h || !h.port || !h.token) throw new HandshakeError(`the handshake file at ${file} lacks port/token`, file);
  return { port: Number(h.port), token: String(h.token), pid: h.pid ? Number(h.pid) : null, file };
}

/** False only when the handshake names a pid that is provably gone. */
export function pidAlive(pid) {
  if (!pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function codeForStatus(status) {
  if (status === 401) return 'unauthorized';
  if (status === 400) return 'bad_request';
  if (status === 404) return 'not_found';
  if (status === 409) return 'code_mismatch';
  if (status === 403) return 'refused';
  return 'internal';
}

export class MeshClient {
  /**
   * @param {{port:number, token:string, host?:string, fetchImpl?:Function, timeoutMs?:number}} opts
   */
  constructor({ port, token, host = '127.0.0.1', fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
    this.origin = `http://${host}:${port}`;
    this.base = `${this.origin}/mesh`;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    // Not enumerable, so a JSON.stringify / console.log of the client never prints the token.
    Object.defineProperty(this, 'token', { value: token, enumerable: false });
  }

  /** A client bound to the running app's handshake. Throws HandshakeError / UnreachableError. */
  static fromHandshake(env = process.env, opts = {}) {
    const h = readHandshake(env);
    if (!pidAlive(h.pid)) {
      throw new HandshakeError(`the handshake at ${h.file} names pid ${h.pid}, which is not running: the Personas app is not running`, h.file);
    }
    return new MeshClient({ port: h.port, token: h.token, ...opts });
  }

  async request(method, route, { body, query, headers = {}, timeoutMs, prefix = '/mesh' } = {}) {
    let url = this.origin + prefix + route;
    if (query) {
      const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
      if (qs) url += `?${qs}`;
    }
    const budget = timeoutMs || this.timeoutMs;
    let res;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { 'x-personas-local-token': this.token, 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(budget),
      });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new RequestTimeoutError(`${method} ${prefix}${route}: no answer within ${budget} ms`, route);
      }
      throw new UnreachableError(`${method} ${prefix}${route}: the app does not answer (${(e && e.cause && e.cause.code) || (e && e.message) || 'connection failed'})`, route);
    }
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { json = null; } }
    if (!res.ok) {
      // The /mesh handlers answer {error, code}; the shared auth layer and an unrouted path answer
      // plain text or an empty body, so the code falls back to the HTTP status.
      const code = (json && typeof json.code === 'string' && json.code) || codeForStatus(res.status);
      const message = (json && typeof json.error === 'string' && json.error) || (text ? text.slice(0, 300) : `HTTP ${res.status}`);
      const err = new MeshError(`${method} ${prefix}${route} -> ${res.status} ${code}: ${message}`, { code, status: res.status, route });
      err.unrouted = res.status === 404 && !text;
      throw err;
    }
    return json;
  }

  status() { return this.request('GET', '/status'); }
  diagnostics() { return this.request('GET', '/diagnostics'); }
  devices() { return this.request('GET', '/devices'); }
  connect(peerId) { return this.request('POST', '/connect', { body: { peerId }, timeoutMs: ACK_REQUEST_TIMEOUT_MS }); }
  pairRequest(peerId) { return this.request('POST', '/pair/request', { body: { peerId }, timeoutMs: ACK_REQUEST_TIMEOUT_MS }); }
  pairPending() { return this.request('GET', '/pair/pending'); }
  pairConfirm(peerId, code) { return this.request('POST', '/pair/confirm', { body: { peerId, code }, timeoutMs: ACK_REQUEST_TIMEOUT_MS }); }
  verb(peerId, payload) { return this.request('POST', '/verb', { body: { peerId, payload }, timeoutMs: ACK_REQUEST_TIMEOUT_MS }); }
  dispatch(peerId, payload) { return this.request('POST', '/dispatch', { body: { peerId, payload }, timeoutMs: ACK_REQUEST_TIMEOUT_MS }); }
  sessionCommand(jobId, command, text = null) {
    return this.request('POST', '/session-command', { body: { jobId, command, text }, timeoutMs: ACK_REQUEST_TIMEOUT_MS });
  }
  queueMove(sessionId, peerId) { return this.request('POST', '/queue/move', { body: { sessionId, peerId }, timeoutMs: ACK_REQUEST_TIMEOUT_MS }); }
  enqueueTest(projectId) {
    return this.request('POST', '/queue/enqueue-test', { body: { projectId }, headers: { 'x-mesh-onboard': '1' } });
  }
  /** Cancel a held `mesh-onboard` entry this device still holds (amendment A4). -> {cancelled}. */
  cancelTest(sessionId) {
    return this.request('POST', '/queue/cancel-test', { body: { sessionId }, headers: { 'x-mesh-onboard': '1' } });
  }
  projects() { return this.request('GET', '/projects'); }
  /** The dev-tools door's project list (snake_case DevProject rows); the fallback when /mesh/projects is not served. */
  devToolsProjects() { return this.request('GET', '/projects', { prefix: '/dev-tools' }); }
  sendMail(peerId, topic, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    if (Buffer.byteLength(text, 'utf8') > CLI_MAIL_MAX_BYTES) {
      return Promise.reject(new MeshError(`cli_mail body over ${CLI_MAIL_MAX_BYTES} bytes`, { code: 'bad_request', route: '/mail' }));
    }
    return this.request('POST', '/mail', { body: { peerId, topic, body: text }, timeoutMs: ACK_REQUEST_TIMEOUT_MS });
  }
  mail({ since, topic } = {}) { return this.request('GET', '/mail', { query: { since, topic } }); }
  job(id) { return this.request('GET', `/jobs/${encodeURIComponent(id)}`); }
  /** A skip is `passed:false, skipped:true` (amendment A2). */
  probe({ peerId, testId, passed, skipped = false, detail }) {
    return this.request('POST', '/probe', {
      body: { peerId, testId, passed: !!passed && !skipped, skipped: !!skipped, detail: detail ?? null, atMs: Date.now() },
    });
  }
}
