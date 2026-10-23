#!/usr/bin/env node
// personas-run - a `claude -p` stand-in that hands the run to the Personas fleet (spark one-control).
//
// Set it where a tool names its Claude CLI (LENS_SCAN_CLAUDE_BIN, APPMASTER_CLAUDE_BIN, BP_CLAUDE_BIN; a
// `.mjs` path runs under node). Instead of starting `claude`, it enqueues the run through the app's
// authenticated `/fleet/enqueue` door, so the fleet's ONE admission queue (its cap, budgets and five-hour
// window) governs it, then stays alive for the whole session and relays the session's stdout byte for
// byte, exiting with the session's exit code. To its caller it looks like `claude -p`.
//
// Exit codes: the session's own; 1 a failed or lost run; 2 a usage error (bad flag, no origin, no
// prompt); 3 the app is not running (no handshake, nothing listening); 130 cancelled by a signal.
//
// Node builtins only. The local token is sent as a header and never printed.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT = Object.freeze({ FAILED: 1, USAGE: 2, NO_APP: 3, CANCELLED: 130 });
export const ORIGINS = Object.freeze(['lens_scan', 'app_master']);
export const OUTPUT_FORMATS = Object.freeze(['text', 'stream-json']);
/** One long-poll asks the door to hold for this long (the door caps it at 30 s). */
export const POLL_WAIT_MS = 20_000;
/** How long the relay keeps retrying while the app is unreachable mid-run (a restart, a rebuild). */
const DEFAULT_RECONNECT_MS = 10 * 60_000;
const RETRY_DELAY_MS = 2_000;
// The door's allowlist, mirrored from door.rs `env_key_allowed`: bp's job id, the four EXACT keys the headless
// App Master's workerEnv sets on a builder (a capped cargo, the shared target, no background-wait park, its
// run label), and the two families. Exact keys, never a family: CARGO_HOME, CLAUDE_CODE_OAUTH_TOKEN stay out.
const ENV_KEY =
  /^(BP_JOB_ID|CARGO_BUILD_JOBS|CARGO_TARGET_DIR|CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS|PERSONAS_RUN_LABEL|LENS_SCAN_[A-Z0-9_]*|APPMASTER_[A-Z0-9_]*)$/;
const MAX_ENV_VALUE = 4096;

export const USAGE = `personas-run - hand a \`claude -p\` run to the Personas fleet

usage: personas-run -p [-] [--output-format text|stream-json] [--verbose] [--model <m>]
                    [--session-id <uuid>] [--dangerously-skip-permissions] [prompt]

The prompt is read from stdin unless given as the last argument. The run is admitted through
the app's /fleet/enqueue door (the fleet's one queue), then relayed to stdout until it ends.

environment:
  PERSONAS_RUN_ORIGIN   lens_scan | app_master (default: lens_scan when BP_JOB_ID is set)
  PERSONAS_RUN_LABEL    optional run label shown on the fleet board (also forwarded)
  PERSONAS_DATA_DIR     read <dir>/local-http.json before ~/.personas/local-http.json
  PERSONAS_RUN_RECONNECT_MS  how long to retry an unreachable app mid-run (default 600000)
  BP_JOB_ID, CARGO_BUILD_JOBS, CARGO_TARGET_DIR, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS,
  PERSONAS_RUN_LABEL, LENS_SCAN_*, APPMASTER_*  forwarded to the session's environment

exit: the session's code; 1 failed/lost; 2 usage; 3 app not running; 130 cancelled.
`;

/** A refusal this process makes before or instead of a run: its exit code and one stderr line. */
export class RunError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** The claude-style argv the callers pass. Throws a usage RunError on anything the door cannot honour. */
export function parseArgs(argv) {
  const out = { help: false, outputFormat: 'text', model: null, sessionId: null, prompt: null };
  const valueOf = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith('-') && v !== '-')) throw new RunError(`${flag} needs a value`, EXIT.USAGE);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const a = eq > 0 ? raw.slice(0, eq) : raw;
    const inline = eq > 0 ? raw.slice(eq + 1) : undefined;
    const take = (flag) => {
      if (inline !== undefined) return inline;
      const v = valueOf(i, flag);
      i++;
      return v;
    };
    switch (a) {
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '-p':
      case '--print':
      case '-': // the prompt is on stdin, which is where it is read from anyway
      case '--verbose': // stream-json always carries it in the fleet's argv
      case '--dangerously-skip-permissions': // the fleet decides permissions, not the caller
        break;
      case '--output-format':
        out.outputFormat = take(a);
        if (!OUTPUT_FORMATS.includes(out.outputFormat)) {
          throw new RunError(`--output-format ${out.outputFormat} is not supported by the fleet door (text | stream-json)`, EXIT.USAGE);
        }
        break;
      case '--model':
        out.model = take(a);
        break;
      case '--session-id':
        out.sessionId = take(a);
        break;
      default:
        if (a.startsWith('-')) throw new RunError(`${a} is not supported by the fleet door`, EXIT.USAGE);
        if (out.prompt !== null) throw new RunError('more than one prompt argument', EXIT.USAGE);
        out.prompt = raw;
    }
  }
  return out;
}

/** The origin the run is admitted under. Throws a usage RunError when none can be named. */
export function resolveOrigin(env) {
  const named = (env.PERSONAS_RUN_ORIGIN || '').trim();
  if (named) {
    if (!ORIGINS.includes(named)) throw new RunError(`PERSONAS_RUN_ORIGIN=${named} is not one of ${ORIGINS.join(' | ')}`, EXIT.USAGE);
    return named;
  }
  if ((env.BP_JOB_ID || '').trim()) return 'lens_scan';
  throw new RunError('set PERSONAS_RUN_ORIGIN (lens_scan | app_master): this run has no origin', EXIT.USAGE);
}

/** Handshake files in the app's own order: <PERSONAS_DATA_DIR>/local-http.json, then ~/.personas/local-http.json. */
export function handshakeCandidates(env, home = os.homedir()) {
  const out = [];
  const dir = (env.PERSONAS_DATA_DIR || '').trim();
  if (dir) out.push(path.join(dir, 'local-http.json'));
  out.push(path.join(home, '.personas', 'local-http.json'));
  return out;
}

/** {port, token} of the running app. Throws an exit-3 RunError when no handshake can be read. */
export function readHandshake(env, home) {
  for (const file of handshakeCandidates(env, home)) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    try {
      const h = JSON.parse(raw);
      if (Number.isInteger(h.port) && typeof h.token === 'string' && h.token) return { port: h.port, token: h.token };
    } catch {
      /* a half-written file: try the next one */
    }
  }
  throw new RunError('the Personas app is not running (no local-http.json handshake) - start it, then retry', EXIT.NO_APP);
}

/** The allowlisted keys (ENV_KEY) of this process's environment - the door's allowlist. */
export function forwardedEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (ENV_KEY.test(k) && typeof v === 'string' && Buffer.byteLength(v) <= MAX_ENV_VALUE && !v.includes('\0')) out[k] = v;
  }
  return out;
}

/** The enqueue body. Pure. */
export function enqueueBody({ cwd, prompt, origin, args, env }) {
  const body = { cwd, prompt, origin, outputFormat: args.outputFormat, env: forwardedEnv(env) };
  if (args.model) body.model = args.model;
  if (args.sessionId) body.sessionId = args.sessionId;
  const label = (env.PERSONAS_RUN_LABEL || '').trim();
  if (label) body.runLabel = label;
  return body;
}

const isUnreachable = (e) => ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT'].includes(e?.code);

/** One request to the door: resolves {status, headers, body: Buffer}. */
function request(hs, method, route, { json, signal } = {}) {
  return new Promise((resolve, reject) => {
    const payload = json === undefined ? null : Buffer.from(JSON.stringify(json), 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port: hs.port,
        method,
        path: route,
        agent: false,
        signal,
        headers: {
          'x-personas-local-token': hs.token,
          connection: 'close',
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function refusal(res) {
  try {
    const j = JSON.parse(res.body.toString('utf8'));
    return `${j.error || 'refused'}${j.code ? ` (${j.code})` : ''}`;
  } catch {
    return `HTTP ${res.status}${res.body.length ? `: ${res.body.toString('utf8').slice(0, 300)}` : ''}`;
  }
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function write(stream, buf) {
  return new Promise((resolve) => {
    if (stream.write(buf)) resolve();
    else stream.once('drain', resolve);
  });
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/**
 * The whole shim. Resolves the exit code; never calls process.exit, so stdout drains first.
 * `signals` is an EventEmitter for SIGINT/SIGTERM/SIGHUP/SIGBREAK (the process by default; the tests
 * pass their own).
 */
export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  cwd = process.cwd(),
  signals = process,
  home,
} = {}) {
  const say = (m) => stderr.write(`personas-run: ${m}\n`);
  let args;
  try {
    args = parseArgs(argv);
    if (args.help) {
      stdout.write(USAGE);
      return 0;
    }
  } catch (e) {
    say(e.message);
    return e.exitCode ?? EXIT.USAGE;
  }

  let origin, hs, prompt;
  try {
    origin = resolveOrigin(env);
    prompt = args.prompt ?? (stdin.isTTY ? '' : await readAll(stdin));
    if (!prompt.trim()) throw new RunError('no prompt (pass it on stdin)', EXIT.USAGE);
    hs = readHandshake(env, home);
  } catch (e) {
    say(e.message);
    return e.exitCode ?? EXIT.FAILED;
  }

  // Enqueue.
  let sessionId;
  try {
    const res = await request(hs, 'POST', '/fleet/enqueue', { json: enqueueBody({ cwd, prompt, origin, args, env }) });
    if (res.status === 401) {
      say('the app refused the local token (a stale handshake?) - restart Personas, then retry');
      return EXIT.NO_APP;
    }
    if (res.status !== 200) {
      say(`the fleet door refused the run: ${refusal(res)}`);
      return EXIT.FAILED;
    }
    const j = JSON.parse(res.body.toString('utf8'));
    sessionId = j.sessionId;
    if (j.state === 'queued') say(`queued in the fleet at rank ${j.rank ?? '?'} (session ${sessionId})`);
  } catch (e) {
    say(isUnreachable(e) ? `the Personas app is not answering on port ${hs.port} - start it, then retry` : `enqueue failed: ${e.message}`);
    return isUnreachable(e) ? EXIT.NO_APP : EXIT.FAILED;
  }

  // From here a signal cancels the fleet session before this process goes.
  const stop = new AbortController();
  let cancelled = false;
  const onSignal = () => {
    if (cancelled) return;
    cancelled = true;
    stop.abort();
  };
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
  for (const s of SIGNALS) signals.on(s, onSignal);
  const cleanup = () => {
    for (const s of SIGNALS) signals.removeListener(s, onSignal);
  };

  const cancelSession = async () => {
    try {
      const res = await request(readHandshakeOr(env, home, hs), 'POST', `/fleet/sessions/${sessionId}/cancel`);
      if (res.status !== 200) say(`cancel of ${sessionId} was refused: ${refusal(res)}`);
    } catch (e) {
      say(`could not cancel ${sessionId}: ${e.message}`);
    }
  };

  const reconnectMs = Number(env.PERSONAS_RUN_RECONNECT_MS) >= 0 && env.PERSONAS_RUN_RECONNECT_MS !== undefined && env.PERSONAS_RUN_RECONNECT_MS !== ''
    ? Number(env.PERSONAS_RUN_RECONNECT_MS)
    : DEFAULT_RECONNECT_MS;
  let offset = 0;
  let downSince = null;
  try {
    for (;;) {
      if (cancelled) break;
      let res;
      try {
        hs = readHandshakeOr(env, home, hs);
        res = await request(hs, 'GET', `/fleet/sessions/${sessionId}/output?from=${offset}&waitMs=${POLL_WAIT_MS}`, { signal: stop.signal });
      } catch (e) {
        if (cancelled) break;
        if (!isUnreachable(e)) {
          say(`relay failed: ${e.message}`);
          return EXIT.FAILED;
        }
        downSince ??= Date.now();
        if (Date.now() - downSince > reconnectMs) {
          say(`the Personas app stopped answering and did not come back within ${Math.round(reconnectMs / 1000)} s - session ${sessionId} is lost to this relay`);
          return EXIT.FAILED;
        }
        await sleep(RETRY_DELAY_MS, stop.signal);
        continue;
      }
      downSince = null;
      if (res.status !== 200) {
        say(`relay of session ${sessionId} failed: ${refusal(res)}`);
        return EXIT.FAILED;
      }
      if (res.body.length) await write(stdout, res.body);
      const next = Number(res.headers['x-personas-next-offset']);
      if (!Number.isFinite(next) || next !== offset + res.body.length) {
        say(`relay of session ${sessionId} lost its place (offset ${offset} + ${res.body.length} != ${res.headers['x-personas-next-offset']})`);
        return EXIT.FAILED;
      }
      offset = next;
      if (res.headers['x-personas-ended'] === '1') break;
    }

    if (cancelled) {
      await cancelSession();
      say(`cancelled session ${sessionId}`);
      return EXIT.CANCELLED;
    }

    // The output is complete and the state final: the session's own verdict.
    const res = await request(readHandshakeOr(env, home, hs), 'GET', `/fleet/sessions/${sessionId}`);
    if (res.status !== 200) {
      say(`could not read how session ${sessionId} ended: ${refusal(res)}`);
      return EXIT.FAILED;
    }
    const st = JSON.parse(res.body.toString('utf8'));
    if (st.captureError) {
      say(`session ${sessionId}: ${st.captureError}`);
      return EXIT.FAILED;
    }
    const code = Number.isInteger(st.exitCode) ? st.exitCode : EXIT.FAILED;
    if (code !== 0) say(`session ${sessionId} ended ${st.state}${st.stateReason ? `: ${st.stateReason}` : ''} (exit ${code})`);
    return code;
  } catch (e) {
    say(`relay failed: ${e.message}`);
    return EXIT.FAILED;
  } finally {
    cleanup();
  }
}

/** The current handshake when one is readable (a restart may move the port), else the last one. */
function readHandshakeOr(env, home, fallback) {
  try {
    return readHandshake(env, home);
  } catch {
    return fallback;
  }
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`personas-run: ${e?.message || e}\n`);
      process.exitCode = EXIT.FAILED;
    },
  );
}
