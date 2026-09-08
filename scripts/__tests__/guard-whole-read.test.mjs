// Decision-table test for scripts/build/guard-whole-read.mjs.
//
// Two layers, mirroring the guard: the pure `decide()` over synthesized
// fixtures, and the process boundary (stdin payload -> exit code / stderr),
// including the DEGRADED fail-open paths. Run: node scripts/__tests__/guard-whole-read.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decide } from '../build/guard-whole-read.mjs';

const GUARD = path.resolve('scripts/build/guard-whole-read.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-read-guard-'));
const mk = (name, lines, banner = '') => {
  const p = path.join(tmp, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, (banner ? banner + '\n' : '') + Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n'));
  return p;
};

const cases = [
  { name: 'small source file passes', file: mk('a.ts', 100), expect: 'allow' },
  { name: 'large source file passes (size alone never blocks)', file: mk('big.ts', 2900), expect: 'allow' },
  { name: 'large generated snapshot blocks', file: mk('.claude/codebase-context.md', 800, '# Snapshot\n\n> Generated: 2026-08-06T20:23:09Z'), expect: 'block' },
  { name: 'large ledger blocks', file: mk('.claude/active-runs.md', 3900, '# Active Runs Ledger'), expect: 'block' },
  { name: 'small generated file passes (under threshold)', file: mk('.claude/small-gen.md', 50, '> Generated: today'), expect: 'allow' },
  { name: 'harness overflow file blocks', file: mk('tool-results/abc.txt', 1500), expect: 'block' },
  { name: 'targeted read of overflow passes', file: mk('tool-results/def.txt', 1500), input: { offset: 1, limit: 100 }, expect: 'allow' },
  { name: 'missing file passes', file: path.join(tmp, 'nope.md'), expect: 'allow' },
  { name: 'generator banner beyond line 8 does not count', file: mk('late.md', 900, '\n\n\n\n\n\n\n\n\n> Generated: late'), expect: 'allow' },
];

for (const c of cases) {
  test(`decide: ${c.name}`, () => {
    const v = decide({ file_path: c.file, ...(c.input || {}) });
    assert.equal(v.decision, c.expect, JSON.stringify(v));
  });
}

const run = (stdin, env = {}) => spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8', env: { ...process.env, ...env } });

test('process: blocked read exits 2 with a stderr explanation', () => {
  const f = mk('tool-results/big.txt', 1200);
  const r = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: f } }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BLOCKED/);
  assert.match(r.stderr, /offset\/limit/);
});

test('process: allowed read exits 0 silently', () => {
  const f = mk('src.ts', 1200);
  const r = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: f } }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('process: empty payload is DEGRADED, not allowed silently', () => {
  const r = run('');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /DEGRADED/);
});

test('process: unparseable payload is DEGRADED', () => {
  const r = run('{not json');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /DEGRADED/);
});

test('process: WHOLE_READ_GUARD=off lets a blocked read through', () => {
  const f = mk('tool-results/off.txt', 1200);
  const r = run(JSON.stringify({ tool_input: { file_path: f } }), { WHOLE_READ_GUARD: 'off' });
  assert.equal(r.status, 0);
});

test('process: threshold is env-overridable', () => {
  const f = mk('tool-results/thr.txt', 100);
  const r = run(JSON.stringify({ tool_input: { file_path: f } }), { WHOLE_READ_MIN_LINES: '50' });
  assert.equal(r.status, 2);
});
