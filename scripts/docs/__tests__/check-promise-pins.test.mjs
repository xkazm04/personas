#!/usr/bin/env node
// Smoke tests for scripts/docs/check-promise-pins.mjs.
//
// Each case runs the checker against a synthetic repo root (a temp dir holding
// a promise-pins.json and the documents it names) and asserts on exit code.
// The checker derives its root from its own location, so each case copies the
// checker into the fixture rather than pointing it at one.
//
// Run:  node scripts/docs/__tests__/check-promise-pins.test.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CHECKER = path.join(REPO_ROOT, 'scripts/docs/check-promise-pins.mjs');

let failures = 0;
const check = (name, actual, expected) => {
  if (actual === expected) {
    console.log(`  ok   ${name}`);
  } else {
    console.error(`  FAIL ${name}: expected exit ${expected}, got ${actual}`);
    failures += 1;
  }
};

function runFixture(spec, docs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promise-pins-'));
  fs.mkdirSync(path.join(root, 'scripts/docs'), { recursive: true });
  fs.copyFileSync(CHECKER, path.join(root, 'scripts/docs/check-promise-pins.mjs'));
  if (spec !== null) {
    fs.writeFileSync(
      path.join(root, 'scripts/docs/promise-pins.json'),
      JSON.stringify(spec, null, 2),
    );
  }
  for (const [rel, body] of Object.entries(docs)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/docs/check-promise-pins.mjs')], {
    encoding: 'utf8',
  });
  fs.rmSync(root, { recursive: true, force: true });
  return r.status;
}

const pin = (over = {}) => ({
  pins: [
    {
      id: 'p',
      reviewed: '2026-09-04',
      documents: ['README.md'],
      required: ['never leaves your machine'],
      ...over,
    },
  ],
});

console.log('check-promise-pins.mjs');

check(
  'passes when the pinned claim is present',
  runFixture(pin(), { 'README.md': 'Your data never leaves your machine. Ever.' }),
  0,
);

check(
  'fails when the pinned claim was edited away',
  runFixture(pin(), { 'README.md': 'Runs on your own hardware for low latency.' }),
  1,
);

check(
  'fails when a pinned document does not exist (the pin would fail open)',
  runFixture(pin(), {}),
  1,
);

check(
  'refuses a pin with no dated review rather than laundering it into a green',
  runFixture(pin({ reviewed: undefined }), { 'README.md': 'never leaves your machine' }),
  1,
);

check(
  'refuses a malformed review date',
  runFixture(pin({ reviewed: 'last spring' }), { 'README.md': 'never leaves your machine' }),
  1,
);

check(
  'an empty pin set is not a pass',
  runFixture({ pins: [] }, { 'README.md': 'anything' }),
  2,
);

check('a missing pin file fails loudly', runFixture(null, { 'README.md': 'anything' }), 2);

check(
  'catches a forbidden phrasing that contradicts a pinned promise',
  runFixture(
    {
      ...pin(),
      forbidden: { documents: ['README.md'], phrases: ['anonymous usage statistics'] },
    },
    { 'README.md': 'never leaves your machine, but we collect Anonymous Usage Statistics' },
  ),
  1,
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');
