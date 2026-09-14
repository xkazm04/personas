// Census worker: a worktree verdict is a delta against the base, as for tsc.
// Drives the worker through base, introduced, base-drift-inherited and
// resolved states over a throwaway base directory with a tiny rules registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('../workers/census.mjs', import.meta.url);

// Two rules, each with a baseline that matches the fixture exactly and a floor
// the three fixture files clear. Shape mirrors scripts/census/rules.json and
// what `validateRule` requires (id, goldenPath, roots, extensions, signal with
// pattern + description, baseline, floor).
const RULES = {
  rules: [
    {
      id: 'todo-marker',
      goldenPath: 'docs/concepts/golden-paths/fixture.md',
      title: 'TODO markers',
      roots: ['src'],
      extensions: ['.ts'],
      signal: { pattern: '\\bTODO\\b', flags: 'g', description: 'TODO markers in src/**/*.ts' },
      baseline: { files: 1, matches: 2 },
      floor: 2,
    },
    {
      id: 'raw-storage',
      goldenPath: 'docs/concepts/golden-paths/fixture.md',
      title: 'localStorage access',
      roots: ['src'],
      extensions: ['.ts'],
      signal: { pattern: '\\blocalStorage\\b', flags: 'g', description: 'localStorage identifiers in src/**/*.ts' },
      baseline: { files: 1, matches: 1 },
      floor: 2,
    },
  ],
};

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-census-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts', 'census'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts/census/rules.json'), JSON.stringify(RULES, null, 2));
  fs.writeFileSync(path.join(dir, 'src/a.ts'), '// TODO one\nexport const a = 1; // TODO two\n');
  fs.writeFileSync(path.join(dir, 'src/b.ts'), 'export const b = localStorage.getItem("k");\n');
  fs.writeFileSync(path.join(dir, 'src/c.ts'), 'export const c = "clean";\n');
  return dir;
}

class WorkerClient {
  constructor(baseRoot) {
    this.root = baseRoot;
    this.worker = new Worker(WORKER_URL, { workerData: { baseRoot } });
    this.pending = new Map();
    this.nextId = 1;
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', (m) => {
        if (m.type === 'ready') (m.error ? reject(new Error(m.error)) : resolve(m));
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
    return this.send({ type: 'gate', root: root || this.root, base: { root: this.root }, overlay: { files } });
  }
  invalidate(paths) {
    this.worker.postMessage({ type: 'invalidate', paths });
  }
  close() {
    return this.worker.terminate();
  }
}

test('census worker: base is --check, a worktree is a delta against the base', async (t) => {
  const dir = makeFixture();
  const wt = dir + '-worktree';
  fs.mkdirSync(path.join(wt, 'scripts', 'census'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'scripts/census/rules.json'), JSON.stringify(RULES, null, 2));
  const client = new WorkerClient(dir);
  t.after(async () => {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  });

  const ready = await client.ready;
  assert.equal(ready.indexedFiles, 3);

  // 1. base request: full --check semantics, everything on baseline
  const base = await client.gate([]);
  assert.equal(base.ok, true, JSON.stringify(base));
  assert.equal(base.delta, false);
  assert.deepEqual(base.drift, []);
  assert.deepEqual(base.structural, []);
  assert.equal(base.baseDrift, 0);
  assert.equal(base.rules, 2);

  // 2. worktree adds a file with a TODO: that rule rises above base and baseline -> introduced
  const raised = await client.gate([{ path: 'src/d.ts', status: 'added', content: '// TODO three\nexport const d = 1;\n' }], wt);
  assert.equal(raised.ok, false);
  assert.equal(raised.delta, true);
  assert.equal(raised.introduced.length, 1, JSON.stringify(raised.introduced));
  assert.deepEqual(raised.introduced[0], {
    rule: 'todo-marker',
    files: [2, 1],
    matches: [3, 2],
    baseline: { files: 1, matches: 2 },
  });
  assert.deepEqual(raised.resolved, []);
  assert.equal(raised.baseDrift, 0);
  assert.equal(raised.drift.length, 1, 'the full drift list stays visible');
  assert.equal(raised.baseEvalCached, false, 'first worktree request evaluates the base');

  // a repeated worktree request must not pay the base evaluation again
  const repeat = await client.gate([{ path: 'src/d.ts', status: 'added', content: '// TODO three\nexport const d = 1;\n' }], wt);
  assert.equal(repeat.baseEvalCached, true);
  assert.equal(repeat.introduced.length, 1);

  // 3. the BASE drifts (a new localStorage use lands on master); a worktree that
  //    does not touch it inherits the drift without being blamed for it
  fs.writeFileSync(path.join(dir, 'src/c.ts'), 'export const c = localStorage.getItem("c");\n');
  client.invalidate([path.join(dir, 'src/c.ts')]); // absolute, as the daemon's watcher sends it
  const inherited = await client.gate([{ path: 'src/e.ts', status: 'added', content: 'export const e = 1;\n' }], wt);
  assert.equal(inherited.ok, true, JSON.stringify(inherited));
  assert.deepEqual(inherited.introduced, []);
  assert.equal(inherited.baseDrift, 1);
  assert.equal(inherited.drift.length, 1);
  assert.equal(inherited.drift[0].rule, 'raw-storage');
  assert.deepEqual(inherited.resolved, []);
  assert.equal(inherited.baseEvalCached, false, 'invalidate must drop the cached base evaluation');

  // the base itself, asked directly, still fails under --check semantics
  const redBase = await client.gate([]);
  assert.equal(redBase.ok, false);
  assert.equal(redBase.delta, false);
  assert.equal(redBase.drift.length, 1);

  // 4. a worktree that removes the base's drifting match lands back on the
  //    baseline: resolved, not introduced
  const fixed = await client.gate([{ path: 'src/c.ts', status: 'modified', content: 'export const c = "clean";\n' }], wt);
  assert.equal(fixed.ok, true, JSON.stringify(fixed));
  assert.deepEqual(fixed.introduced, []);
  assert.deepEqual(fixed.resolved, ['raw-storage']);
  assert.equal(fixed.baseDrift, 1);
  assert.deepEqual(fixed.drift, []);
  assert.equal(fixed.baseEvalCached, true, 'same rules text, same base: cache hit');

  // 5. a worktree that ships its own rules.json is evaluated (base included)
  //    under THAT registry; a different rules text is a different cache key
  const rebaselined = JSON.parse(JSON.stringify(RULES));
  rebaselined.rules[1].baseline = { files: 2, matches: 2 };
  const own = await client.gate(
    [{ path: 'scripts/census/rules.json', status: 'modified', content: JSON.stringify(rebaselined, null, 2) }],
    wt,
  );
  assert.equal(own.rulesSource, 'overlay');
  assert.equal(own.ok, true);
  assert.equal(own.baseDrift, 0, 'the base is on the worktree registry baseline');
  assert.equal(own.baseEvalCached, false);

  // 6. structural problems stay fatal in delta mode: a rule that finds nothing
  const zero = JSON.parse(JSON.stringify(RULES));
  zero.rules.push({
    id: 'never-matches',
    goldenPath: 'docs/concepts/golden-paths/fixture.md',
    title: 'never',
    roots: ['src'],
    extensions: ['.ts'],
    signal: { pattern: 'ZZZ_NOTHING_MATCHES', flags: 'g', description: 'a token nothing carries' },
    baseline: { files: 0, matches: 0 },
    floor: 2,
  });
  const structural = await client.gate(
    [{ path: 'scripts/census/rules.json', status: 'modified', content: JSON.stringify(zero, null, 2) }],
    wt,
  );
  assert.equal(structural.ok, false);
  assert.equal(structural.structural.length, 1);
  assert.equal(structural.structural[0].code, 'zero-matches');
});
