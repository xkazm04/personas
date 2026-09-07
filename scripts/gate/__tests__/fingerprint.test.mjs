import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeFingerprint, fingerprintInputs } from '../fingerprint.mjs';

function makeBase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-fp-'));
  const w = (rel, c) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), c);
  };
  w('tsconfig.json', '{"compilerOptions":{}}');
  w('eslint.config.js', 'export default [];');
  w('eslint-rules/one.cjs', 'module.exports = {};');
  w('eslint-rules/nested/two.cjs', 'module.exports = {};');
  w('scripts/census/rules.json', '[]');
  w('scripts/census/lib/engine.mjs', 'export const x = 1;');
  w('scripts/census/lib/notes.md', 'ignored: not .mjs');
  w('scripts/gate/daemon.mjs', '// daemon');
  w('scripts/gate/workers/tsc.mjs', '// worker');
  w('package-lock.json', '{"lockfileVersion":3}');
  w('src/app.ts', 'export {};');
  return dir;
}

test('fingerprint: deterministic, names its inputs, ignores unrelated files', () => {
  const dir = makeBase();
  try {
    const a = computeFingerprint(dir);
    const b = computeFingerprint(dir);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.deepEqual(fingerprintInputs(dir), [
      'eslint-rules/nested/two.cjs',
      'eslint-rules/one.cjs',
      'eslint.config.js',
      'package-lock.json',
      'scripts/census/lib/engine.mjs',
      'scripts/census/rules.json',
      'scripts/gate/daemon.mjs',
      'scripts/gate/workers/tsc.mjs',
      'tsconfig.json',
    ]);
    fs.writeFileSync(path.join(dir, 'src/app.ts'), 'export const changed = 1;');
    assert.equal(computeFingerprint(dir), a, 'source files are not part of the fingerprint');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fingerprint: changes when any listed file changes, is added, or is removed', () => {
  const dir = makeBase();
  try {
    const a = computeFingerprint(dir);
    fs.writeFileSync(path.join(dir, 'scripts/census/rules.json'), '[{"id":"x"}]');
    const b = computeFingerprint(dir);
    assert.notEqual(a, b);
    fs.writeFileSync(path.join(dir, 'eslint-rules/three.cjs'), 'module.exports = {};');
    const c = computeFingerprint(dir);
    assert.notEqual(b, c);
    fs.unlinkSync(path.join(dir, 'eslint-rules/three.cjs'));
    assert.equal(computeFingerprint(dir), b);
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3,"x":1}');
    assert.notEqual(computeFingerprint(dir), b);
    fs.writeFileSync(path.join(dir, 'scripts/gate/daemon.mjs'), '// daemon v2');
    const d = computeFingerprint(dir);
    assert.notEqual(d, b);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
