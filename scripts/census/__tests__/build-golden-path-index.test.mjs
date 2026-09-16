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

/** Copy the real corpus (.md only) into a scratch dir and return { tmp, dir }. */
function makeCorpus(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-index-'));
  const dir = path.join(tmp, 'golden-paths');
  fs.mkdirSync(dir);
  for (const f of fs.readdirSync(CORPUS)) {
    if (!f.endsWith('.md')) continue;
    fs.copyFileSync(path.join(CORPUS, f), path.join(dir, f));
  }
  if (mutate) mutate(dir);
  return { tmp, dir };
}

/** Run the SHIPPING script against a prepared corpus copy. */
function runIn(dir, args = []) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    cwd: ROOT,
    env: { ...process.env, GP_INDEX_CORPUS_DIR: dir },
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', dir };
}

/** Copy the real corpus into a scratch dir, apply `mutate`, run, return result. */
function runAgainstCorpus(mutate, args = []) {
  const { tmp, dir } = makeCorpus(mutate);
  const out = runIn(dir, args);
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

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 8: the schema-2 layout — a manifest plus one self-contained file per leaf');
{
  const { tmp, dir } = makeCorpus(null);
  try {
    const w = runIn(dir);
    expect('exit 0', w.code === 0, `got ${w.code}: ${w.stderr.slice(0, 400)}`);

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const leaves = Object.keys(manifest.docs);
    const mdLeaves = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'REVIEW-wave1.md')
      .map((f) => f.replace(/\.md$/, '')).sort();

    expect('manifest declares schema 2', manifest.schema === 2, String(manifest.schema));
    expect('manifest $comment says it is the manifest and where the leaves live',
      /manifest/i.test(manifest.$comment) && /index\/<leaf>\.json/.test(manifest.$comment), manifest.$comment);
    expect('manifest has one record per document', leaves.length === mdLeaves.length,
      `${leaves.length} records vs ${mdLeaves.length} documents`);

    const noCitations = leaves.filter((l) => manifest.docs[l].citations !== undefined);
    expect('NO manifest record carries citations', noCitations.length === 0, noCitations.slice(0, 5).join(', '));
    const badFile = leaves.filter((l) => manifest.docs[l].file !== `index/${l}.json`);
    expect('every manifest record names its leaf file', badFile.length === 0, badFile.slice(0, 5).join(', '));
    const noCount = leaves.filter((l) => typeof manifest.docs[l].citationCount !== 'number');
    expect('every manifest record keeps citationCount', noCount.length === 0, noCount.slice(0, 5).join(', '));

    const onDisk = fs.readdirSync(path.join(dir, 'index')).filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')).sort();
    expect('one leaf file per document, no more and no fewer',
      onDisk.join('|') === mdLeaves.join('|'),
      `${onDisk.length} files vs ${mdLeaves.length} documents`);

    // A leaf file must answer everything about its document on its own — that is
    // the point of the split. Check the fattest one, not the first one.
    const fattest = leaves.reduce((a, b) => (manifest.docs[a].citationCount >= manifest.docs[b].citationCount ? a : b));
    const leafDoc = JSON.parse(fs.readFileSync(path.join(dir, 'index', `${fattest}.json`), 'utf8'));
    expect('leaf file declares schema 2', leafDoc.schema === 2, String(leafDoc.schema));
    expect('leaf file points back at the manifest', /\.\.\/index\.json/.test(leafDoc.$comment ?? ''), leafDoc.$comment);
    expect('leaf file carries citations', leafDoc.citations && Object.keys(leafDoc.citations).length > 0);
    for (const k of ['leaf', 'doc', 'file', 'headline', 'oneWay', 'deviations', 'ruleIds', 'ruleIdsFrom', 'sections', 'citationCount', 'triggers']) {
      expect(`leaf file carries "${k}"`, leafDoc[k] !== undefined);
    }
    expect('leaf file and manifest agree on citationCount',
      leafDoc.citationCount === manifest.docs[fattest].citationCount);

    expect('--check is green immediately after a write', runIn(dir, ['--check']).code === 0);
    console.log(`     manifest ${fs.statSync(path.join(dir, 'index.json')).size} B · ${onDisk.length} leaf files`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows lock */ }
  }
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 9: a stale leaf file — the drift a byte comparison cannot see');
{
  // A leaf file whose document left the corpus is never compared against
  // anything, so only an INVENTORY finds it. The generator must both report it
  // (--check) and remove it (--write); leaving it is a path that still primes a
  // reader after it stopped governing anything.
  const { tmp, dir } = makeCorpus(null);
  try {
    runIn(dir);
    const ghost = path.join(dir, 'index', 'a-path-that-left-the-corpus.json');
    fs.writeFileSync(ghost, '{"leaf":"a-path-that-left-the-corpus","schema":2}\n');

    const c = runIn(dir, ['--check']);
    expect('--check exits 1 on an EXTRA leaf file', c.code === 1, `got ${c.code}`);
    expect('--check names the orphan', /a-path-that-left-the-corpus/.test(c.stderr), c.stderr.slice(0, 400));
    expect('--check says it is extra, not stale', /EXTRA leaf file/.test(c.stderr), c.stderr.slice(0, 400));

    const w = runIn(dir);
    expect('--write deletes the orphan', !fs.existsSync(ghost));
    expect('--write says what it deleted', /stale leaf file\(s\) deleted/.test(w.stdout), w.stdout.slice(0, 300));
    expect('--check is green again', runIn(dir, ['--check']).code === 0);

    // The other half of the inventory: a leaf file the corpus still expects.
    const victim = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).docs)[0];
    fs.rmSync(path.join(dir, 'index', `${victim}.json`));
    const m = runIn(dir, ['--check']);
    expect('--check exits 1 on a MISSING leaf file', m.code === 1, `got ${m.code}`);
    expect('--check names the missing leaf', new RegExp(victim).test(m.stderr), m.stderr.slice(0, 400));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows lock */ }
  }
}

console.log(`\nbuild-golden-path-index: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`); process.exit(1); }
process.exit(0);
