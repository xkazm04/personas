#!/usr/bin/env node
// Fixture tests for scripts/registry/lib/evidence-home.mjs and the extractor's contract.
//
// The load-bearing case is the last one: docs/evidence/ must agree with the frozen
// docs/concepts/paths/ mirror value-for-value while both exist, and the comparison must be
// able to FAIL - a drift check that cannot fail certifies nothing.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { readEvidence, evidenceSlugs, keyBlock, ROOT } from '../lib/evidence-home.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-home-'));
const write = (name, text) => fs.writeFileSync(path.join(tmp, name), text);

write(
  'demo.md',
  [
    '---',
    'subject: demo',
    'evidence:',
    '  - src/a.ts   # the canonical primitive',
    '  - src/b.rs#L10',
    'counter_evidence: []',
    'deviations:',
    '  - demo-anchor              # anchors in the deferred-fixes register',
    '---',
    '',
    '# Demo',
    '',
  ].join('\n'),
);
write('README.md', '# not a subject\n');

const got = readEvidence('demo', tmp);
assert.deepEqual(got.evidence, ['src/a.ts', 'src/b.rs#L10'], 'comments strip, locators stay');
assert.deepEqual(got.counter_evidence, []);
assert.deepEqual(got.deviations, ['demo-anchor']);
assert.equal(got.subject, 'demo');
assert.equal(readEvidence('missing', tmp), null, 'an absent subject is null, not empty');
assert.deepEqual(evidenceSlugs(tmp), ['demo'], 'README is not a subject');
assert.deepEqual(evidenceSlugs(path.join(tmp, 'nope')), [], 'an absent directory is empty, callers must refuse it');

const block = keyBlock(['subject: x', 'evidence:', '  - a  # why', '', 'deviations: []'], 'evidence');
assert.deepEqual(block, ['evidence:', '  - a  # why'], 'the block keeps its comment and drops trailing blanks');

// The comparison against the frozen mirror, on the real tree, with a fault injected.
const paths = path.join(ROOT, 'docs/concepts/paths');
if (fs.existsSync(paths)) {
  const run = () =>
    spawnSync(process.execPath, [path.join(ROOT, 'scripts/registry/extract-evidence.mjs'), '--check', '--json'], {
      encoding: 'utf8',
    });
  const clean = run();
  assert.equal(clean.status, 0, `docs/evidence must match paths/: ${clean.stdout}${clean.stderr}`);
  const table = path.join(ROOT, 'docs/evidence/table.md');
  const original = fs.readFileSync(table, 'utf8');
  try {
    fs.writeFileSync(table, original.replace(/^ {2}- src\/features\/shared\/components\/display\/UnifiedTable\.tsx.*\n/m, ''));
    assert.equal(run().status, 1, 'a dropped pointer must fail the comparison');
  } finally {
    fs.writeFileSync(table, original);
  }
  assert.equal(run().status, 0, 'restored');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('evidence-home tests OK');
