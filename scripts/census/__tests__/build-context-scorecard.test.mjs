#!/usr/bin/env node
// Tests for scripts/census/build-context-scorecard.mjs — the census x corpus-map
// x context-map join (knowledge-hierarchy-plan §6, patterns-v2-ui P4).
//
// Every case runs THE SHIPPING SCRIPT, unmodified, against tiny synthetic
// fixtures via the SCORECARD_* env overrides (same convention as
// build-golden-path-index.test.mjs: overrides announce themselves on stderr).
// Covered: rule→subject resolution incl. unassigned; file→multi-context
// counting; applicable/clean derivation; the uncontexted bucket; and the
// loud-failure paths — a missing or empty input must exit 1 and write nothing,
// never a green empty artifact.
//
// Run:  node scripts/census/__tests__/build-context-scorecard.test.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/census/build-context-scorecard.mjs');

let passed = 0, failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

// ------------------------------------------------------------- fixtures ---

const RULE = (over = {}) => ({
  id: 'fx-rule',
  goldenPath: 'docs/concepts/golden-paths/foo.md',
  title: 'fixture',
  roots: ['src'],
  extensions: ['.tsx'],
  signal: { pattern: 'VIOLATION', flags: 'g', description: 'fixture token', ignoreCommentLines: true },
  exclude: [],
  baseline: { files: 1, matches: 1 }, // not asserted by the scorecard join
  floor: 1,
  ...over,
});

/**
 * Build a scratch world: a scan tree + the three input files, then run the
 * shipping script with env overrides. `mutate(world)` may rewrite any input.
 */
function runWorld(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-scorecard-'));
  const world = {
    dir: tmp,
    rules: path.join(tmp, 'rules.json'),
    corpusMap: path.join(tmp, 'corpus-map.json'),
    contextMap: path.join(tmp, 'context-map.json'),
    out: path.join(tmp, 'context-scorecard.json'),
  };

  // Scan tree:
  //   src/a.tsx      2 violations, in ctx1 AND ctx2 (multi-context)
  //   src/b.tsx      clean, in ctx1                  (applicability only)
  //   src/c.tsx      clean, in ctx3                  (ctx3 = applicable + clean)
  //   src/orphan.tsx 1 violation, in NO context      (uncontexted bucket)
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.writeFileSync(path.join(tmp, 'src', 'a.tsx'), 'VIOLATION;\nok();\nVIOLATION;\n');
  fs.writeFileSync(path.join(tmp, 'src', 'b.tsx'), 'clean();\n');
  fs.writeFileSync(path.join(tmp, 'src', 'c.tsx'), 'clean();\n// VIOLATION mentioned in a comment only\n');
  fs.writeFileSync(path.join(tmp, 'src', 'orphan.tsx'), 'VIOLATION;\n');

  fs.writeFileSync(world.rules, JSON.stringify({
    rules: [
      RULE(),
      RULE({ id: 'fx-unmapped', goldenPath: 'docs/concepts/golden-paths/not-in-corpus-map.md' }),
    ],
  }));
  fs.writeFileSync(world.corpusMap, JSON.stringify({ entries: { 'foo.md': 'subject-foo' } }));
  fs.writeFileSync(world.contextMap, JSON.stringify({
    generator: 'personas-context-scan',
    generated_at: '2026-08-18T00:00:00Z',
    contexts: [
      { id: 'ctx1', name: 'Alpha', group: 'G1', group_id: 'g1', file_paths: ['src/a.tsx', 'src/b.tsx'] },
      { id: 'ctx2', name: 'Beta', group: 'G1', group_id: 'g1', file_paths: ['src/a.tsx'] },
      { id: 'ctx3', name: 'Gamma', group: 'G2', group_id: 'g2', file_paths: ['src/c.tsx'] },
    ],
  }));

  if (mutate) mutate(world);

  const r = spawnSync('node', [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      SCORECARD_RULES: world.rules,
      SCORECARD_CORPUS_MAP: world.corpusMap,
      SCORECARD_CONTEXT_MAP: world.contextMap,
      SCORECARD_ROOT: world.dir,
      SCORECARD_OUT: world.out,
    },
    encoding: 'utf8',
  });
  const artifact = fs.existsSync(world.out) ? JSON.parse(fs.readFileSync(world.out, 'utf8')) : null;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows lock */ }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', artifact };
}

// ------------------------------------------------------------------ cases ---

console.log('Case 0: the healthy synthetic world — the join is exact');
{
  const r = runWorld(null);
  expect('exit 0', r.code === 0, `got ${r.code}: ${r.stderr.slice(0, 400)}`);
  expect('artifact written', r.artifact !== null);
  const a = r.artifact;

  expect('unassigned rule reported, not dropped',
    JSON.stringify(a.inputs.unassignedRules) === JSON.stringify(['fx-unmapped']),
    JSON.stringify(a.inputs.unassignedRules));
  expect('assignedRules counts only resolvable rules', a.inputs.assignedRules === 1, String(a.inputs.assignedRules));
  expect('subjectCount', a.inputs.subjectCount === 1, String(a.inputs.subjectCount));

  const s = a.subjects['subject-foo'];
  expect('subject exists', !!s);
  expect('sites = 3 (2 in a.tsx + 1 in orphan.tsx; comment mention NOT counted)', s.sites === 3, String(s.sites));
  expect('matchedFiles = 2', s.matchedFiles === 2, String(s.matchedFiles));
  expect('applicableContexts = 3 (ctx1/ctx2/ctx3 each hold a scanned file)', s.applicableContexts === 3, String(s.applicableContexts));
  expect('cleanContexts = 1 (ctx3: applicable, zero sites)', s.cleanContexts === 1, String(s.cleanContexts));

  const byId = Object.fromEntries((s.contexts ?? []).map((c) => [c.id, c]));
  expect('only contexts with sites>0 listed', Object.keys(byId).sort().join(',') === 'ctx1,ctx2', Object.keys(byId).join(','));
  expect('multi-context file counted in EACH context (ctx1 sites)', byId.ctx1?.sites === 2, String(byId.ctx1?.sites));
  expect('multi-context file counted in EACH context (ctx2 sites)', byId.ctx2?.sites === 2, String(byId.ctx2?.sites));
  expect('per-context rule breakdown carries the rule id + sites',
    byId.ctx1?.rules?.length === 1 && byId.ctx1.rules[0].id === 'fx-rule' && byId.ctx1.rules[0].sites === 2,
    JSON.stringify(byId.ctx1?.rules));
  expect('contexts sorted by sites desc (stable by name)', s.contexts[0].sites >= s.contexts[1].sites);

  expect('uncontexted bucket: 1 site / 1 file', s.uncontexted.sites === 1 && s.uncontexted.files === 1, JSON.stringify(s.uncontexted));
  expect('totals.multiContextFiles = 1 (a.tsx)', a.totals.multiContextFiles === 1, String(a.totals.multiContextFiles));
  expect('totals.sites = 3', a.totals.sites === 3, String(a.totals.sites));
  expect('totals.matchedFiles = 2', a.totals.matchedFiles === 2, String(a.totals.matchedFiles));
  expect('$comment says absence != cleanliness', /absence is NOT\s+cleanliness/i.test(a.$comment.replace(/\s+/g, ' ')) || /absence is NOT cleanliness/i.test(a.$comment));
  expect('artifact stays lean: no line numbers or scanned lists embedded',
    !JSON.stringify(a).includes('"lines"') && !JSON.stringify(a).includes('scannedFiles'));
  expect('stdout summary names the unassigned rule', r.stdout.includes('fx-unmapped'), r.stdout.slice(0, 400));
}

console.log('Case 1: FAIL-LOUD — empty rule registry');
{
  const r = runWorld((w) => fs.writeFileSync(w.rules, JSON.stringify({ rules: [] })));
  expect('exit 1', r.code === 1, `got ${r.code}`);
  expect('no artifact written', r.artifact === null);
  expect('says why', /zero rules/.test(r.stderr), r.stderr.slice(0, 300));
}

console.log('Case 2: FAIL-LOUD — corpus map missing');
{
  const r = runWorld((w) => fs.rmSync(w.corpusMap));
  expect('exit 1', r.code === 1, `got ${r.code}`);
  expect('no artifact written', r.artifact === null);
  expect('names the corpus map', /corpus map/.test(r.stderr), r.stderr.slice(0, 300));
}

console.log('Case 3: FAIL-LOUD — corpus map with zero entries');
{
  const r = runWorld((w) => fs.writeFileSync(w.corpusMap, JSON.stringify({ entries: {} })));
  expect('exit 1', r.code === 1, `got ${r.code}`);
  expect('no artifact written', r.artifact === null);
}

console.log('Case 4: FAIL-LOUD — context map declares zero contexts');
{
  const r = runWorld((w) => fs.writeFileSync(w.contextMap, JSON.stringify({ generator: 'personas-context-scan', contexts: [] })));
  expect('exit 1', r.code === 1, `got ${r.code}`);
  expect('no artifact written', r.artifact === null);
  expect('says the join has no right-hand side', /zero contexts/.test(r.stderr), r.stderr.slice(0, 300));
}

console.log('Case 5: FAIL-LOUD — NO rule resolves to a subject (all unassigned)');
{
  const r = runWorld((w) => fs.writeFileSync(w.corpusMap, JSON.stringify({ entries: { 'unrelated.md': 'x' } })));
  expect('exit 1', r.code === 1, `got ${r.code}`);
  expect('no artifact written', r.artifact === null);
  expect('says zero rules resolved', /zero rules resolved/.test(r.stderr), r.stderr.slice(0, 300));
}

console.log('Case 6: FAIL-LOUD — malformed rules JSON is fatal, not an empty green artifact');
{
  const r = runWorld((w) => fs.writeFileSync(w.rules, '{ not json'));
  expect('exit 1', r.code === 1, `got ${r.code}`);
  expect('no artifact written', r.artifact === null);
}

// -------------------------------------------------------------------- done ---
console.log(`\nbuild-context-scorecard tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
process.exit(0);
