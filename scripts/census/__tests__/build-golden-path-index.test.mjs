#!/usr/bin/env node
// Fault-injection tests for scripts/census/build-golden-path-index.mjs.
//
// A generator over 174 hand-written documents fails SILENTLY by construction:
// a heading convention shifts, an extractor stops extracting, and the artifact
// still writes and still looks complete. The doctrine's answer is a precondition
// that fails loudly when the instrument finds nothing — so these tests break the
// corpus on purpose and assert the generator REFUSES, with exit 2.
//
// Every case runs THE SHIPPING SCRIPT, unmodified, against a copied corpus via
// GP_INDEX_CORPUS_DIR. Rewriting the script's path constants into a copy and
// testing the copy would be "a third copy, not a check" (doctrine §2).
//
// Run:  node scripts/census/__tests__/build-golden-path-index.test.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/census/build-golden-path-index.mjs');
const CORPUS = path.join(ROOT, 'docs/concepts/golden-paths');

let passed = 0, failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** Copy the real corpus into a scratch dir, apply `mutate`, run, return result. */
function runAgainstCorpus(mutate, args = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-index-'));
  const dir = path.join(tmp, 'golden-paths');
  fs.mkdirSync(dir);
  for (const f of fs.readdirSync(CORPUS)) {
    if (!f.endsWith('.md')) continue;
    fs.copyFileSync(path.join(CORPUS, f), path.join(dir, f));
  }
  if (mutate) mutate(dir);
  const r = spawnSync('node', [SCRIPT, ...args], {
    cwd: ROOT,
    env: { ...process.env, GP_INDEX_CORPUS_DIR: dir },
    encoding: 'utf8',
  });
  const out = { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', dir };
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows lock */ }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
console.log('Case 0: the unbroken corpus copy — the control');
{
  const r = runAgainstCorpus(null);
  expect('exit 0 on a healthy corpus', r.code === 0, `got ${r.code}: ${r.stderr.slice(0, 400)}`);
  expect('reports a doc count', /\d+ docs/.test(r.stdout), r.stdout);
  expect('override announces itself on stderr', /CORPUS OVERRIDE ACTIVE/.test(r.stderr));
  console.log(`     ${r.stdout.trim()}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 1: CRLF a document — must NOT change anything (the recorded bug)');
{
  const clean = runAgainstCorpus(null);
  const crlf = runAgainstCorpus((dir) => {
    for (const f of ['entity-picker.md', 'persisted-model-struct.md', 'focus-management.md']) {
      const p = path.join(dir, f);
      const s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      fs.writeFileSync(p, s);
    }
  });
  expect('exit 0 with CRLF documents', crlf.code === 0, `got ${crlf.code}: ${crlf.stderr.slice(0, 400)}`);
  expect('citation count is unchanged by line endings',
    crlf.stdout.trim() === clean.stdout.trim(),
    `\n       LF:   ${clean.stdout.trim()}\n       CRLF: ${crlf.stdout.trim()}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 2: truncate documents — the floors must fire');
{
  // Emptying a handful of docs takes citations below the floor without changing
  // the doc COUNT, which is the failure a doc-count floor alone cannot see.
  const r = runAgainstCorpus((dir) => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    for (const f of files.slice(0, Math.ceil(files.length * 0.6))) {
      fs.writeFileSync(path.join(dir, f), '# Golden path — emptied\n');
    }
  });
  expect('exit 2', r.code === 2, `got ${r.code}`);
  expect('names a floor or a zero-citation failure',
    /floor|zero citations|NO citations AND NO trigger/i.test(r.stderr), r.stderr.slice(0, 500));
  console.log(`     ${(r.stderr.split('\n').find((l) => l.startsWith('FATAL')) || '').slice(0, 160)}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 3: corrupt a fence — the cross-artifact inventory must fire');
{
  // The recorded failure: a lost rule looks exactly like a rule nobody wrote.
  // Only an inventory of what SHOULD exist finds it, which is why this check is
  // an inventory against rules.json and not a diff.
  const r = runAgainstCorpus((dir) => {
    const p = path.join(dir, 'entity-picker.md');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/```json/g, '```jsonx'));
  });
  expect('exit 2', r.code === 2, `got ${r.code}`);
  expect('names the rule that vanished',
    /missing-current-entity-rendered-as-unset/.test(r.stderr), r.stderr.slice(0, 500));
  expect('says a lost rule is indistinguishable from an absent one',
    /indistinguishable/i.test(r.stderr));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 4: an empty corpus directory');
{
  const r = runAgainstCorpus((dir) => {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
  });
  expect('exit 2', r.code === 2, `got ${r.code}`);
  expect('says THE READER IS BROKEN', /THE READER IS BROKEN/.test(r.stderr), r.stderr.slice(0, 300));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 5: a missing corpus directory');
{
  const r = spawnSync('node', [SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, GP_INDEX_CORPUS_DIR: path.join(os.tmpdir(), 'gp-index-does-not-exist-zzz') },
    encoding: 'utf8',
  });
  expect('exit 2', r.status === 2, `got ${r.status}`);
  expect('names the missing input', /required input missing/.test(r.stderr), (r.stderr || '').slice(0, 300));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 6: --check against a corpus whose artifacts were never written');
{
  const r = runAgainstCorpus(null, ['--check']);
  expect('exit 1 (drift, not a broken instrument)', r.code === 1, `got ${r.code}`);
  expect('prints the fix command', /build-golden-path-index\.mjs/.test(r.stderr), r.stderr.slice(0, 300));
  expect('says MISSING', /MISSING/.test(r.stderr), r.stderr.slice(0, 300));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 7: the real corpus artifacts on disk are fresh');
{
  const r = spawnSync('node', [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
  expect('exit 0', r.status === 0, `got ${r.status}: ${(r.stderr || '').slice(0, 400)}`);
  expect('no override banner (this ran against the repo corpus)',
    !/CORPUS OVERRIDE/.test(r.stderr || ''));
  console.log(`     ${(r.stdout || '').trim()}`);
}

console.log(`\nbuild-golden-path-index: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`); process.exit(1); }
process.exit(0);
