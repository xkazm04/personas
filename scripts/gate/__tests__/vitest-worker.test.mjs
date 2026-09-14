// node --test scripts/gate/__tests__/vitest-worker.test.mjs
//
// Drives the vitest worker over the real worker_threads protocol against this
// checkout. Uses a leaf lib file (few dependents) so the related run stays short.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..').replace(/\\/g, '/');
const workerUrl = new URL('../workers/vitest.mjs', import.meta.url);

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

const envelope = { root, base: { root, head: 'HEAD' }, overlay: { base: { root, head: 'HEAD' }, root, files: [] } };

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
    setTimeout(() => reject(new Error('worker never became ready')), 30_000).unref();
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
  assert.equal(r.vitest, true, 'vitest entry should resolve from the base root');
});

after(async () => {
  await worker?.terminate();
});

test('a lib file with a test next to it reports related suites', { timeout: 5 * 60_000 }, async () => {
  const result = await send({ type: 'gate', ...envelope, files: ['src/lib/useCaseSlug.ts'] });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.ok(result.related >= 1, `expected related >= 1, got ${JSON.stringify(result)}`);
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(typeof result.passed, 'number');
  assert.equal(typeof result.failed, 'number');
  assert.ok(Array.isArray(result.failures));
  assert.equal(typeof result.ms, 'number');
});

test('a non-source file is skipped without spawning vitest', async () => {
  const result = await send({ type: 'gate', ...envelope, files: ['docs/architecture/README.md'] });
  assert.equal(result.skipped, true, JSON.stringify(result));
  assert.equal(result.ok, true);
  assert.equal(result.related, 0);
});

test('status answers', async () => {
  const s = await send({ type: 'status' });
  assert.equal(s.baseRoot, root);
  assert.equal(typeof s.runs, 'number');
});
