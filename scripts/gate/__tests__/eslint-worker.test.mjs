// node --test scripts/gate/__tests__/eslint-worker.test.mjs
//
// Drives the eslint worker over the real worker_threads protocol against this
// checkout, and compares its verdict for one file with the cold `eslint` CLI.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..').replace(/\\/g, '/');
const workerUrl = new URL('../workers/eslint.mjs', import.meta.url);

let worker;
let nextId = 1;
const pending = new Map();

function send(msg) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...msg });
  });
}

before(async () => {
  worker = new Worker(workerUrl, { workerData: { baseRoot: root } });
  const ready = new Promise((resolve, reject) => {
    const onMessage = (m) => {
      if (m?.type === 'ready') {
        worker.off('message', onMessage);
        resolve(m);
      }
    };
    worker.on('message', onMessage);
    worker.once('error', reject);
    setTimeout(() => reject(new Error('worker never became ready')), 60_000).unref();
  });
  worker.on('message', (m) => {
    if (m?.id === undefined) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error));
  });
  const r = await ready;
  assert.equal(typeof r.ms, 'number');
});

after(async () => {
  await worker?.terminate();
});

function coldEslintHasErrors(file) {
  try {
    // Same `--cache` form as `npm run check`: an eslint run WITHOUT `--cache` deletes
    // `.eslintcache` (eslint.js lintFiles: "Delete cache file"), which would wipe the
    // cache the worker just wrote and make the assertion below meaningless.
    execFileSync('npx', ['eslint', '--cache', '--cache-location', '.eslintcache', '--no-warn-ignored', file], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    return false;
  } catch (err) {
    // Exit 1 = lint errors; anything else is a tooling failure we should see.
    if (err.status === 1) return true;
    throw err;
  }
}

test('explicit files: verdict matches the cold eslint CLI', async () => {
  const file = 'scripts/gate/workers/eslint.mjs';
  const result = await send({ type: 'gate', root, base: { root, head: 'HEAD' }, overlay: { base: { root, head: 'HEAD' }, root, files: [] }, files: [file] });
  assert.equal(result.files, 1, JSON.stringify(result));
  assert.equal(typeof result.errors, 'number');
  assert.equal(typeof result.warnings, 'number');
  assert.equal(typeof result.ms, 'number');
  assert.ok(Array.isArray(result.messages));
  const cold = coldEslintHasErrors(file);
  assert.equal(result.ok, !cold, `worker ok=${result.ok} but cold eslint errors=${cold}: ${JSON.stringify(result.messages)}`);
  assert.ok(existsSync(path.join(root, '.eslintcache')), 'the warm instance should persist .eslintcache in the root');
});

test('overlay-added file under src/ with an obvious violation reports errors', async (t) => {
  const dir = path.join(root, 'src', '__gate_tmp__');
  const rel = 'src/__gate_tmp__/violation.ts';
  const abs = path.join(root, rel);
  mkdirSync(dir, { recursive: true });
  // `no-var` is not on; `@typescript-eslint/no-unused-vars` and `no-undef`-style
  // errors are. An unused const plus a bare `debugger` (no-debugger, recommended) is certain.
  const content = 'const unusedGateProbe = 1;\ndebugger;\nexport {};\n';
  writeFileSync(abs, content);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const overlay = { base: { root, head: 'HEAD' }, root, files: [{ path: rel, status: 'added', content }] };
  const result = await send({ type: 'gate', root, base: { root, head: 'HEAD' }, overlay });
  assert.equal(result.files, 1, JSON.stringify(result));
  assert.ok(result.errors >= 1, `expected errors, got ${JSON.stringify(result)}`);
  assert.equal(result.ok, false);
  assert.ok(result.messages.some((m) => m.file === rel), `messages should name ${rel}: ${JSON.stringify(result.messages)}`);
});

test('non-lintable files yield an empty ok verdict', async () => {
  const result = await send({ type: 'gate', root, base: { root, head: 'HEAD' }, overlay: { base: { root, head: 'HEAD' }, root, files: [] }, files: ['docs/architecture/warm-verification-service.md'] });
  assert.deepEqual({ ok: result.ok, files: result.files, errors: result.errors, warnings: result.warnings }, { ok: true, files: 0, errors: 0, warnings: 0 });
});

test('status lists the warm roots', async () => {
  const s = await send({ type: 'status' });
  assert.ok(Array.isArray(s.roots));
  assert.ok(s.roots.includes(root), `roots=${JSON.stringify(s.roots)} should include ${root}`);
  assert.equal(typeof s.lastMs, 'number');
});
