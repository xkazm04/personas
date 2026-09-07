#!/usr/bin/env node
// Gate daemon: HTTP front + per-engine worker_threads holding warm verification state
// for ONE base checkout. See scripts/gate/README.md and
// docs/architecture/warm-verification-service.md.
//
//   node scripts/gate/daemon.mjs [--base <path>]
//
// Routes (127.0.0.1 only, token in `x-gate-token` or `?__token=`):
//   GET  /status   per-worker state + queue depths + fingerprint + rss + uptime
//   POST /gate     { root, gates: string[], files?: string[] } -> verdict per gate
//   POST /stop

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { computeOverlay, summarizeOverlay, gitHead, baseRootOf, toPosix, OverlayError } from './overlay.mjs';
import { computeFingerprint } from './fingerprint.mjs';
import { writeHandshake, removeHandshake } from './handshake.mjs';

const PORT_RANGE = [17330, 17345];
const QUEUE_DEPTH = 32;
const IDLE_MS = 45 * 60 * 1000;
// Measured 2026-09-07 with all four workers warm on this repo: 3.4 GB RSS
// (tsc heap alone about 1 GB, census index 9k files). A 4 GB cap sat one
// request away from a self-restart and a cold 60 s rebuild, so the default
// is 6 GB; GATE_RSS_CAP_MB overrides it.
const RSS_CAP_BYTES = (Number(process.env.GATE_RSS_CAP_MB) || 6144) * 1024 * 1024;
const WATCH_DIRS = ['src', 'src-tauri/src', 'scripts', 'docs'];
const WATCH_DEBOUNCE_MS = 300;
const GATE_NAMES = ['tsc', 'eslint', 'census', 'vitest'];
const MAX_BODY = 8 * 1024 * 1024;

function log(...args) {
  process.stderr.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') out.base = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const baseRoot = args.base ? toPosix(args.base) : baseRootOf(process.cwd());
const token = crypto.randomBytes(32).toString('hex');
const startedAt = Date.now();
let lastRequestAt = Date.now();
let fingerprint = '';
try {
  fingerprint = computeFingerprint(baseRoot);
} catch (e) {
  log('fingerprint failed:', e.message);
}

// ---------------------------------------------------------------------------
// workers
class WorkerSlot {
  constructor(name) {
    this.name = name;
    this.url = new URL(`./workers/${name}.mjs`, import.meta.url);
    this.state = 'unavailable';
    this.reason = null;
    this.worker = null;
    this.queue = [];
    this.inflight = null;
    this.nextId = 1;
    this.readyMs = null;
    this.lastStatus = null;
    this.respawns = 0;
    this.readyWaiters = [];
    this.spawn();
  }

  spawn() {
    if (!fs.existsSync(this.url)) {
      this.state = 'unavailable';
      this.reason = `worker file missing: ${path.basename(this.url.pathname)}`;
      log(`worker ${this.name}: ${this.reason}`);
      return;
    }
    this.state = 'warming';
    this.reason = null;
    const t0 = Date.now();
    let w;
    try {
      w = new Worker(this.url, { workerData: { baseRoot } });
    } catch (e) {
      this.state = 'unavailable';
      this.reason = `spawn failed: ${e.message}`;
      log(`worker ${this.name}: ${this.reason}`);
      return;
    }
    this.worker = w;
    w.on('message', (m) => this.onMessage(m, t0));
    w.on('error', (e) => {
      log(`worker ${this.name} error: ${(e && e.stack) || e}`);
    });
    w.on('exit', (code) => {
      log(`worker ${this.name} exited with ${code}`);
      this.failAll(`worker ${this.name} exited (${code})`);
      this.worker = null;
      if (this.state !== 'unavailable' && this.respawns < 3) {
        this.respawns++;
        log(`worker ${this.name}: respawn #${this.respawns}`);
        this.spawn();
      } else {
        this.state = 'dead';
        this.reason = this.reason || `exited (${code})`;
      }
    });
  }

  onMessage(m, t0) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'ready') {
      this.state = 'ready';
      this.readyMs = m.ms ?? Date.now() - t0;
      this.lastStatus = { ...m, type: undefined };
      log(`worker ${this.name}: ready in ${this.readyMs} ms ${JSON.stringify({ ...m, type: undefined, ms: undefined })}`);
      for (const r of this.readyWaiters.splice(0)) r();
      this.pump();
      return;
    }
    if (m.type === 'fatal') {
      this.state = 'unavailable';
      this.reason = String(m.error).split('\n')[0];
      log(`worker ${this.name}: fatal: ${m.error}`);
      this.failAll(this.reason);
      for (const r of this.readyWaiters.splice(0)) r();
      return;
    }
    if (m.type === 'log') {
      log(`worker ${this.name}: ${m.message}`);
      return;
    }
    if (m.id !== undefined && this.inflight && this.inflight.id === m.id) {
      const job = this.inflight;
      this.inflight = null;
      if (m.ok) job.resolve(m.result);
      else job.reject(new Error(m.error));
      this.pump();
    }
  }

  failAll(reason) {
    const err = new Error(reason);
    if (this.inflight) {
      this.inflight.reject(err);
      this.inflight = null;
    }
    for (const j of this.queue.splice(0)) j.reject(err);
  }

  get available() {
    return this.state === 'ready' || this.state === 'warming';
  }

  /** Serialized request; throws synchronously when the queue is full. */
  request(msg) {
    if (!this.available) return Promise.reject(new Error(this.reason || `worker ${this.name} ${this.state}`));
    if (this.queue.length >= QUEUE_DEPTH) {
      const e = new Error(`worker ${this.name} queue full (${QUEUE_DEPTH})`);
      e.code = 'QUEUE_FULL';
      throw e;
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, msg, resolve, reject });
      this.pump();
    });
  }

  pump() {
    if (this.inflight || this.state !== 'ready' || !this.worker) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inflight = job;
    try {
      this.worker.postMessage({ id: job.id, ...job.msg });
    } catch (e) {
      this.inflight = null;
      job.reject(e);
      this.pump();
    }
  }

  invalidate(paths) {
    if (this.worker && this.state === 'ready') {
      try {
        this.worker.postMessage({ type: 'invalidate', paths });
      } catch (e) {
        log(`worker ${this.name}: invalidate failed: ${e.message}`);
      }
    }
  }

  summary() {
    return {
      state: this.state,
      reason: this.reason,
      queue: this.queue.length,
      inflight: this.inflight ? 1 : 0,
      readyMs: this.readyMs,
      respawns: this.respawns,
      last: this.lastStatus,
    };
  }

  terminate() {
    if (this.worker) {
      this.state = 'unavailable';
      this.reason = 'stopping';
      return this.worker.terminate().catch(() => {});
    }
    return Promise.resolve();
  }
}

const workers = new Map(GATE_NAMES.map((n) => [n, new WorkerSlot(n)]));

// ---------------------------------------------------------------------------
// base watch -> invalidate
const pendingPaths = new Set();
let watchTimer = null;
const watchers = [];
function flushInvalidate() {
  watchTimer = null;
  const paths = [...pendingPaths];
  pendingPaths.clear();
  if (!paths.length) return;
  for (const w of workers.values()) w.invalidate(paths);
  log(`invalidate ${paths.length} path(s)`);
}
for (const rel of WATCH_DIRS) {
  const dir = path.join(baseRoot, rel);
  if (!fs.existsSync(dir)) continue;
  try {
    const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      pendingPaths.add(toPosix(path.join(dir, String(filename))));
      if (!watchTimer) watchTimer = setTimeout(flushInvalidate, WATCH_DEBOUNCE_MS);
    });
    w.on('error', (e) => log(`watch ${rel}: ${e.message}`));
    watchers.push(w);
  } catch (e) {
    log(`watch ${rel} failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// http
function authorized(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return false;
  const url = new URL(req.url, 'http://127.0.0.1');
  const t = req.headers['x-gate-token'] || url.searchParams.get('__token');
  if (typeof t !== 'string' || t.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token));
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('invalid JSON body: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

function rssMb() {
  return Math.round(process.memoryUsage().rss / 1048576);
}

function statusBody() {
  const w = {};
  for (const [n, slot] of workers) w[n] = slot.summary();
  return {
    pid: process.pid,
    port: server.address() ? server.address().port : null,
    baseRoot,
    baseHead: safeHead(),
    fingerprint,
    startedAt: new Date(startedAt).toISOString(),
    uptimeMs: Date.now() - startedAt,
    lastRequestAt: new Date(lastRequestAt).toISOString(),
    rssMb: rssMb(),
    workers: w,
  };
}

function safeHead() {
  try {
    return gitHead(baseRoot);
  } catch {
    return null;
  }
}

async function handleGate(body) {
  const t0 = performance.now();
  const root = toPosix(body.root || baseRoot);
  const gates = Array.isArray(body.gates) && body.gates.length ? body.gates : ['tsc', 'eslint', 'census'];
  const files = Array.isArray(body.files) ? body.files : undefined;
  const baseHead = gitHead(baseRoot);
  const overlay = computeOverlay({ baseRoot, baseHead, root });
  const summary = summarizeOverlay(overlay);
  const overlayMs = Math.round(performance.now() - t0);

  // reserve a queue slot on every requested worker before dispatching any (429 is all-or-nothing)
  const jobs = [];
  const response = {
    root,
    base: overlay.base,
    overlay: summary,
    overlayMs,
  };
  for (const g of gates) {
    if (!GATE_NAMES.includes(g)) {
      response[g] = { unavailable: true, reason: `unknown gate ${g}` };
      continue;
    }
    const slot = workers.get(g);
    if (!slot.available) {
      response[g] = { unavailable: true, reason: slot.reason || slot.state };
      continue;
    }
    jobs.push({ g, slot });
  }
  const promises = [];
  for (const { g, slot } of jobs) {
    // may throw QUEUE_FULL synchronously -> propagated as 429 by the caller
    const p = slot.request({ type: 'gate', root, base: overlay.base, overlay, files });
    promises.push(
      p.then(
        (result) => {
          slot.lastStatus = { ...slot.lastStatus, lastMs: result && result.ms, at: new Date().toISOString() };
          response[g] = result;
        },
        (e) => {
          response[g] = { unavailable: true, reason: String((e && e.message) || e) };
        },
      ),
    );
  }
  await Promise.all(promises);
  response.ms = Math.round(performance.now() - t0);
  return response;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!authorized(req)) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }
  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      const body = statusBody();
      if (url.searchParams.get('deep')) {
        // ask each ready worker (through its queue, so this waits behind a running build)
        await Promise.all(
          [...workers].map(async ([n, slot]) => {
            if (slot.state !== 'ready') return;
            try {
              body.workers[n].status = await slot.request({ type: 'status' });
            } catch (e) {
              body.workers[n].status = { error: String((e && e.message) || e) };
            }
          }),
        );
      }
      send(res, 200, body);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/stop') {
      send(res, 200, { ok: true, stopping: true });
      setImmediate(() => shutdown('stop requested'));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/gate') {
      lastRequestAt = Date.now();
      const body = await readBody(req);
      let result;
      try {
        result = await handleGate(body);
      } catch (e) {
        if (e instanceof OverlayError) {
          send(res, 409, { error: e.message, code: e.code });
          return;
        }
        if (e && e.code === 'QUEUE_FULL') {
          send(res, 429, { error: e.message });
          return;
        }
        throw e;
      }
      lastRequestAt = Date.now();
      const rss = rssMb();
      log(
        `gate root=${result.root} gates=${Object.keys(result)
          .filter((k) => GATE_NAMES.includes(k))
          .join(',')} overlay=${result.overlay.total} ms=${result.ms} rss=${rss}MB`,
      );
      send(res, 200, result);
      if (process.memoryUsage().rss > RSS_CAP_BYTES && typeof globalThis.gc === 'function') globalThis.gc();
      if (process.memoryUsage().rss > RSS_CAP_BYTES) {
        log(`rss ${rss} MB above cap; exiting so the client restarts a fresh daemon`);
        setImmediate(() => shutdown('rss cap', 3));
      }
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    log(`request failed: ${(e && e.stack) || e}`);
    if (!res.headersSent) send(res, 500, { error: String((e && e.message) || e) });
  }
});

server.on('error', (e) => log(`server error: ${e.message}`));

function listenScan(port) {
  return new Promise((resolve, reject) => {
    if (port > PORT_RANGE[1]) {
      reject(new Error(`no free port in ${PORT_RANGE[0]}..${PORT_RANGE[1]}`));
      return;
    }
    const onError = (e) => {
      server.removeListener('listening', onListening);
      if (e.code === 'EADDRINUSE' || e.code === 'EACCES') resolve(listenScan(port + 1));
      else reject(e);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

// ---------------------------------------------------------------------------
// lifecycle
let stopping = false;
async function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  log(`shutdown: ${reason}`);
  clearInterval(idleTimer);
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      // already closed
    }
  }
  removeHandshake(process.pid);
  await Promise.all([...workers.values()].map((w) => w.terminate()));
  server.close();
  setTimeout(() => process.exit(code), 100).unref();
}

const idleTimer = setInterval(() => {
  if (Date.now() - lastRequestAt > IDLE_MS) shutdown('idle for 45 min');
}, 60 * 1000);
idleTimer.unref();

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', () => removeHandshake(process.pid));
process.on('uncaughtException', (e) => log(`uncaught: ${(e && e.stack) || e}`));
process.on('unhandledRejection', (e) => log(`unhandled rejection: ${(e && e.stack) || e}`));

const port = await listenScan(PORT_RANGE[0]);
writeHandshake({
  port,
  token,
  pid: process.pid,
  baseRoot,
  fingerprint,
  startedAt: new Date(startedAt).toISOString(),
});
log(`gate daemon pid=${process.pid} listening on 127.0.0.1:${port} base=${baseRoot} fingerprint=${fingerprint.slice(0, 12)}`);
