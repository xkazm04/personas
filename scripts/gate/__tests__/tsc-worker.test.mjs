import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('../workers/tsc.mjs', import.meta.url);

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-tsc-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        types: [],
        lib: ['ES2022'],
      },
      include: ['src'],
    }),
  );
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a: number = 1;\n');
  fs.writeFileSync(path.join(dir, 'src/b.ts'), 'import { a } from "./a";\nexport const b: string = String(a);\n');
  fs.writeFileSync(path.join(dir, 'src/c.ts'), 'export const c = "standalone";\n');
  return dir;
}

class WorkerClient {
  constructor(baseRoot) {
    this.worker = new Worker(WORKER_URL, { workerData: { baseRoot } });
    this.pending = new Map();
    this.nextId = 1;
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', (m) => {
        if (m.type === 'ready') resolve(m);
        else if (m.type === 'fatal') reject(new Error(m.error));
        else if (m.id !== undefined && this.pending.has(m.id)) {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
        }
      });
      this.worker.on('error', reject);
    });
  }
  send(msg) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...msg });
    });
  }
  gate(files, root) {
    return this.send({ type: 'gate', root: root || this.root, base: this.root, overlay: { files } });
  }
  invalidate(paths) {
    this.worker.postMessage({ type: 'invalidate', paths });
  }
  close() {
    return this.worker.terminate();
  }
}

test('tsc worker: warm program, overlay delta, reuse, deletion', async (t) => {
  const dir = makeFixture();
  const client = new WorkerClient(dir);
  client.root = dir;
  t.after(async () => {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const ready = await client.ready;
  assert.equal(ready.baseErrors, 0);
  assert.equal(ready.rootNames, 3);

  // 1. base (empty overlay): zero errors
  const base = await client.gate([]);
  assert.equal(base.ok, true);
  assert.equal(base.errors.length, 0);
  assert.equal(base.rootNames, 3);

  // 2. overlay introduces one type error in b.ts
  const broken = await client.gate(
    [{ path: 'src/b.ts', status: 'modified', content: 'import { a } from "./a";\nexport const b: string = a;\n' }],
    dir + '-worktree',
  );
  assert.equal(broken.ok, false);
  assert.equal(broken.introduced.length, 1, JSON.stringify(broken.introduced));
  assert.equal(broken.introduced[0].file, 'src/b.ts');
  assert.equal(broken.introduced[0].code, 2322);
  assert.equal(broken.introduced[0].line, 2);
  assert.equal(broken.resolved.length, 0);
  assert.equal(broken.baseErrors, 0);
  assert.equal(broken.reused, true, 'second build must reuse the program');
  assert.ok(broken.filesRechecked !== null && broken.filesRechecked < broken.totalFiles, 'not a cold recheck');

  // 3. overlay fixes it (different text from base, still valid): 0 introduced, 0 resolved (resolved is vs BASE)
  const fixed = await client.gate(
    [{ path: 'src/b.ts', status: 'modified', content: 'import { a } from "./a";\nexport const b: string = `${a}`;\n' }],
    dir + '-worktree',
  );
  assert.equal(fixed.ok, true);
  assert.equal(fixed.introduced.length, 0);
  assert.equal(fixed.resolved.length, 0);
  assert.equal(fixed.reused, true, 'third build must reuse the program');

  // 4. overlay deletes c.ts: it must leave rootNames; nothing imports it so no error
  const deleted = await client.gate([{ path: 'src/c.ts', status: 'deleted' }], dir + '-worktree');
  assert.equal(deleted.ok, true);
  assert.equal(deleted.rootNames, 2);
  assert.equal(deleted.introduced.length, 0);

  // 5. overlay adds a new file under src/ that imports c.ts -> appears in rootNames; and a type error in it
  const added = await client.gate(
    [{ path: 'src/new/d.ts', status: 'added', content: 'import { c } from "../c";\nexport const d: number = c;\n' }],
    dir + '-worktree',
  );
  assert.equal(added.rootNames, 4);
  assert.equal(added.introduced.length, 1);
  assert.equal(added.introduced[0].file, 'src/new/d.ts');

  // 6. back to base: program forgets the overlay
  const again = await client.gate([]);
  assert.equal(again.errors.length, 0);
  assert.equal(again.rootNames, 3);
  // the root set changed (4 -> 3) so TypeScript reports no *structural* reuse, but the
  // builder's per-file diagnostic cache must still hold: not a cold recheck
  assert.ok(again.filesRechecked < again.totalFiles, `rechecked ${again.filesRechecked}/${again.totalFiles}`);

  // 7. base disk change + invalidate is picked up (a real error lands in the base)
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a: number = "no";\n');
  client.invalidate([path.join(dir, 'src/a.ts')]);
  const dirty = await client.gate(
    [{ path: 'src/c.ts', status: 'modified', content: 'export const c = "changed";\n' }],
    dir + '-worktree',
  );
  assert.equal(dirty.baseErrors, 1, 'base refreshed after invalidate');
  assert.equal(dirty.introduced.length, 0, 'the base error is not blamed on the overlay');
  assert.equal(dirty.errors.length, 1);

  // 8. overlay fixing the base error shows up as resolved
  const heal = await client.gate(
    [{ path: 'src/a.ts', status: 'modified', content: 'export const a: number = 2;\n' }],
    dir + '-worktree',
  );
  assert.equal(heal.ok, true);
  assert.equal(heal.resolved.length, 1);
  assert.equal(heal.errors.length, 0);

  const status = await client.send({ type: 'status' });
  assert.equal(typeof status.rssMb, 'number');
  assert.equal(status.baseErrors, 1);
});

test('tsc worker: missing tsconfig is fatal, not a crash', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-tsc-empty-'));
  const client = new WorkerClient(dir);
  t.after(async () => {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(client.ready, /no tsconfig\.json/);
});
