// personas-run against a tiny in-process fake of the app's /fleet door (node:http). The relay is
// driven as a real child process where bytes and exit codes matter, and in-process where a signal
// has to be delivered deterministically (Windows has no catchable cross-process SIGTERM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { EXIT, enqueueBody, forwardedEnv, parseArgs, resolveOrigin, run } from '../personas-run.mjs';

const SHIM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'personas-run.mjs');
const TOKEN = 'tok-test';
const SID = '0f6b3c3e-0000-4000-8000-000000000001';

/**
 * A fake door. `chunks` are served one per /output poll; the poll after the last one says ended.
 * `holdMs` keeps an empty poll open (a long-poll) until it elapses or the client goes away.
 */
async function fakeDoor({ chunks = [], exitCode = 0, state = 'exited', holdMs = 0 } = {}) {
  const seen = { enqueue: [], cancel: 0, polls: [], tokens: new Set() };
  const all = Buffer.concat(chunks);
  let served = 0;
  const server = http.createServer((req, res) => {
    seen.tokens.add(req.headers['x-personas-local-token']);
    const body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const json = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.headers['x-personas-local-token'] !== TOKEN) return json(401, { error: 'token' });
      if (req.method === 'POST' && url.pathname === '/fleet/enqueue') {
        seen.enqueue.push(JSON.parse(Buffer.concat(body).toString('utf8')));
        return json(200, { sessionId: SID, state: 'queued', rank: 2 });
      }
      if (req.method === 'GET' && url.pathname === `/fleet/sessions/${SID}/output`) {
        const from = Number(url.searchParams.get('from'));
        seen.polls.push(from);
        const offset = chunks.slice(0, served).reduce((n, c) => n + c.length, 0);
        assert.equal(from, offset, 'the shim asks from exactly where the last read ended');
        const send = (buf, ended) => {
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'x-personas-next-offset': String(from + buf.length),
            'x-personas-ended': ended ? '1' : '0',
          });
          res.end(buf);
        };
        if (served < chunks.length) return send(chunks[served++], false);
        if (holdMs > 0) {
          const t = setTimeout(() => send(Buffer.alloc(0), false), holdMs);
          res.on('close', () => clearTimeout(t));
          return undefined;
        }
        return send(Buffer.alloc(0), true);
      }
      if (req.method === 'GET' && url.pathname === `/fleet/sessions/${SID}`) {
        return json(200, { sessionId: SID, state, origin: 'lens_scan', exitCode, ended: true });
      }
      if (req.method === 'POST' && url.pathname === `/fleet/sessions/${SID}/cancel`) {
        seen.cancel++;
        return json(200, { sessionId: SID, cancelled: true, state: 'exited' });
      }
      return json(404, { error: 'no route', code: 'not_found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, seen, all, close: () => new Promise((r) => server.close(r)) };
}

function tmpDir(t, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'personas-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  if (port !== undefined) fs.writeFileSync(path.join(dir, 'local-http.json'), JSON.stringify({ port, token: TOKEN, pid: 1 }));
  return dir;
}

/** Run the shim as a child: resolves {code, stdout: Buffer, stderr: string}. Never touches the real app. */
function runChild(args, { env, stdin }) {
  return new Promise((resolve, reject) => {
    const home = env.PERSONAS_DATA_DIR;
    const child = spawn(process.execPath, [SHIM, ...args], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: home, HOME: home, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
    child.stdin.end(stdin);
  });
}

test('argv: the claude flags the callers pass are understood, anything else is a usage error', () => {
  const lens = parseArgs(['-p', '--dangerously-skip-permissions', '--output-format', 'text', '--model', 'opus']);
  assert.deepEqual([lens.outputFormat, lens.model, lens.sessionId], ['text', 'opus', null]);
  const am = parseArgs(['-p', '-', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--model', 'sonnet', '--session-id', SID]);
  assert.deepEqual([am.outputFormat, am.model, am.sessionId], ['stream-json', 'sonnet', SID]);
  assert.equal(parseArgs(['--output-format=stream-json']).outputFormat, 'stream-json');
  for (const bad of [['--resume', 'x'], ['--output-format', 'json'], ['--model'], ['--max-turns', '3']]) {
    assert.throws(() => parseArgs(bad), (e) => e.exitCode === EXIT.USAGE, bad.join(' '));
  }
  assert.equal(resolveOrigin({ PERSONAS_RUN_ORIGIN: 'app_master' }), 'app_master');
  assert.equal(resolveOrigin({ BP_JOB_ID: 'j1' }), 'lens_scan');
  assert.throws(() => resolveOrigin({}), (e) => e.exitCode === EXIT.USAGE);
  assert.throws(() => resolveOrigin({ PERSONAS_RUN_ORIGIN: 'manual' }), (e) => e.exitCode === EXIT.USAGE);
  assert.deepEqual(forwardedEnv({ BP_JOB_ID: 'j', LENS_SCAN_X: '1', APPMASTER_Y: '2', PATH: 'p', bp_job_id: 'no', ANTHROPIC_API_KEY: 'k' }), {
    BP_JOB_ID: 'j',
    LENS_SCAN_X: '1',
    APPMASTER_Y: '2',
  });
});

test('--help prints usage without contacting the app', async (t) => {
  const dir = tmpDir(t); // no handshake at all
  const r = await runChild(['--help'], { env: { PERSONAS_DATA_DIR: dir }, stdin: '' });
  assert.equal(r.code, 0);
  assert.match(r.stdout.toString('utf8'), /usage: personas-run/);
});

test('enqueue body shape, a byte-exact relay across polls with a split UTF-8 char, the exit code mirrored', async (t) => {
  // "é" is C3 A9 and the emoji is F0 9F 98 80: both are split across poll boundaries.
  const text = Buffer.from('{"type":"system"}\n{"type":"result","result":"café \u{1F600} ok"}\n', 'utf8');
  const e = text.indexOf(0xc3);
  const emoji = text.indexOf(0xf0);
  const chunks = [text.subarray(0, e + 1), text.subarray(e + 1, emoji + 2), text.subarray(emoji + 2, emoji + 3), text.subarray(emoji + 3)];
  const door = await fakeDoor({ chunks, exitCode: 0 });
  t.after(door.close);
  const dir = tmpDir(t, door.port);
  const r = await runChild(['-p', '-', '--verbose', '--output-format', 'stream-json', '--model', 'opus', '--session-id', SID, '--dangerously-skip-permissions'], {
    env: { PERSONAS_DATA_DIR: dir, PERSONAS_RUN_ORIGIN: 'app_master', APPMASTER_RUN: 'r1', BP_JOB_ID: 'job-7', OTHER: 'x', PERSONAS_RUN_LABEL: 'kp builder' },
    stdin: 'build the thing\n',
  });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.equals(text), 'stdout is the session output, byte for byte');
  assert.deepEqual(door.seen.polls, [0, chunks[0].length, chunks[0].length + chunks[1].length, text.length - chunks[3].length, text.length]);
  assert.equal(door.seen.enqueue.length, 1);
  const body = door.seen.enqueue[0];
  assert.deepEqual(Object.keys(body).sort(), ['cwd', 'env', 'model', 'origin', 'outputFormat', 'prompt', 'runLabel', 'sessionId']);
  assert.equal(body.prompt, 'build the thing\n');
  assert.equal(body.origin, 'app_master');
  assert.equal(body.outputFormat, 'stream-json');
  assert.equal(body.model, 'opus');
  assert.equal(body.sessionId, SID);
  assert.equal(body.runLabel, 'kp builder');
  assert.deepEqual(body.env, { APPMASTER_RUN: 'r1', BP_JOB_ID: 'job-7' });
  assert.equal(path.resolve(body.cwd), path.resolve(process.cwd()));
  assert.deepEqual([...door.seen.tokens], [TOKEN]);
  assert.match(r.stderr, /queued in the fleet at rank 2/);
});

test('a non-zero session exit code is the shim exit code', async (t) => {
  const door = await fakeDoor({ chunks: [Buffer.from('partial\n')], exitCode: 7 });
  t.after(door.close);
  const dir = tmpDir(t, door.port);
  const r = await runChild(['-p', '--output-format', 'text'], { env: { PERSONAS_DATA_DIR: dir, BP_JOB_ID: 'j1' }, stdin: '/lens-scan measure dev\n' });
  assert.equal(r.code, 7);
  assert.equal(r.stdout.toString('utf8'), 'partial\n');
  assert.equal(door.seen.enqueue[0].origin, 'lens_scan', 'BP_JOB_ID infers lens_scan');
  assert.match(r.stderr, /exit 7/);
});

test('no exit code from the session (cancelled elsewhere, lost) is a failure, never a success', async (t) => {
  const door = await fakeDoor({ chunks: [], exitCode: null, state: 'expired' });
  t.after(door.close);
  const dir = tmpDir(t, door.port);
  const r = await runChild(['-p'], { env: { PERSONAS_DATA_DIR: dir, BP_JOB_ID: 'j1' }, stdin: 'x' });
  assert.equal(r.code, EXIT.FAILED);
});

test('a missing handshake is exit 3 with one clear line', async (t) => {
  const dir = tmpDir(t); // neither <dir>/local-http.json nor <home>/.personas/local-http.json
  const r = await runChild(['-p'], { env: { PERSONAS_DATA_DIR: dir, BP_JOB_ID: 'j1' }, stdin: 'x' });
  assert.equal(r.code, EXIT.NO_APP);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /not running/);
  assert.equal(r.stdout.length, 0);
});

test('a handshake whose port answers nothing is exit 3', async (t) => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const dir = tmpDir(t, port);
  const r = await runChild(['-p'], { env: { PERSONAS_DATA_DIR: dir, BP_JOB_ID: 'j1' }, stdin: 'x' });
  assert.equal(r.code, EXIT.NO_APP);
  assert.match(r.stderr, /not answering/);
});

test('a missing origin is a usage error before the app is contacted', async (t) => {
  const door = await fakeDoor();
  t.after(door.close);
  const dir = tmpDir(t, door.port);
  const r = await runChild(['-p'], { env: { PERSONAS_DATA_DIR: dir }, stdin: 'x' });
  assert.equal(r.code, EXIT.USAGE);
  assert.equal(door.seen.enqueue.length, 0);
});

test('SIGTERM mid-run cancels the fleet session and exits 130', async (t) => {
  const door = await fakeDoor({ chunks: [Buffer.from('working\n')], holdMs: 10_000 });
  t.after(door.close);
  const dir = tmpDir(t, door.port);
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const out = [];
  stdout.on('data', (d) => out.push(d));
  const stderr = new PassThrough();
  stderr.resume();
  const done = run({
    argv: ['-p', '--output-format', 'text'],
    env: { PERSONAS_DATA_DIR: dir, PERSONAS_RUN_ORIGIN: 'lens_scan' },
    stdin: Readable.from([Buffer.from('/lens-scan measure dev\n')]),
    stdout,
    stderr,
    cwd: dir,
    signals,
    home: dir,
  });
  // Wait until the relay is holding a long-poll past the first chunk, then signal.
  for (let i = 0; i < 200 && door.seen.polls.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(door.seen.polls.length, 2, 'the relay is long-polling');
  signals.emit('SIGTERM');
  const code = await done;
  assert.equal(code, EXIT.CANCELLED);
  assert.equal(door.seen.cancel, 1);
  assert.equal(Buffer.concat(out).toString('utf8'), 'working\n');
  assert.equal(signals.listenerCount('SIGTERM'), 0, 'the handlers are removed');
});

test('enqueueBody leaves out what the caller did not name', () => {
  const body = enqueueBody({ cwd: 'c', prompt: 'p', origin: 'lens_scan', args: parseArgs(['-p']), env: { BP_JOB_ID: 'j' } });
  assert.deepEqual(body, { cwd: 'c', prompt: 'p', origin: 'lens_scan', outputFormat: 'text', env: { BP_JOB_ID: 'j' } });
});
