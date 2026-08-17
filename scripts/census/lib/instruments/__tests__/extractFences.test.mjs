#!/usr/bin/env node
// Regression tests for scripts/census/lib/instruments/extractFences.mjs
//
// The recorded bug (doctrine §4): "A CRLF rewrite makes the merger see zero
// fenced blocks. […] A LOST RULE LOOKS EXACTLY LIKE A RULE NOBODY WROTE."
// Second recorded bug, from merge-published-rules.mjs's own header: two
// composers published the §9 rule inside a blockquote and the extractor
// reported "no ```json block" — published, never merged.
//
// Cases 1–4 are synthetic. Case 5 is the one that matters: three REAL corpus
// documents, asserting that the ids this extractor pulls out of them are
// exactly the ids those documents contributed to the committed rules.json.
// rules.json is read READ-ONLY and is never written by this test.
//
// Run:  node scripts/census/lib/instruments/__tests__/extractFences.test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFences, extractJsonFences, extractPublishedRules } from '../extractFences.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '..');

let passed = 0, failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

const DOC_LF = [
  '# Golden path — Example',
  '',
  '## 9. The missing gate',
  '',
  '```json',
  '{"rules":[{"id":"alpha-rule","baseline":{"files":1,"matches":2}}]}',
  '```',
  '',
  'and a control:',
  '',
  '```json',
  '{"id":"alpha-rule-positive-control"}',
  '```',
  '',
  '```ts',
  'const notJson = 1;',
  '```',
  '',
].join('\n');

// ────────────────────────────────────────────────────────────────────────
console.log('Case 1: THE RECORDED BUG — a CRLF document must yield the SAME fences');
{
  const lf = extractFences(DOC_LF);
  const crlf = extractFences(DOC_LF.replace(/\n/g, '\r\n'));
  expect('LF document yields 2 json fences', lf.count === 2, `got ${lf.count}`);
  expect('CRLF document yields 2 json fences (not zero)', crlf.count === 2, `got ${crlf.count}`);
  expect('fence contents are byte-identical across line endings',
    JSON.stringify(lf.fences) === JSON.stringify(crlf.fences));
  const lone = extractFences(DOC_LF.replace(/\n/g, '\r'));
  expect('lone-CR document also yields 2', lone.count === 2, `got ${lone.count}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 2: a blockquoted fence is still a fence');
{
  const quoted = DOC_LF.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
  const r = extractFences(quoted);
  expect('2 fences found inside the blockquote', r.count === 2, `got ${r.count}`);
  expect('content unquoted', r.fences[0].includes('"alpha-rule"'), r.fences[0]);
  const off = extractFences(quoted, { blockquotes: false });
  expect('blockquotes:false does NOT see them (the option is real)', off.count === 0, `got ${off.count}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 3: the info string is matched exactly');
{
  const md = '```json5\n{"id":"nope"}\n```\n```json\n{"id":"yes"}\n```\n';
  const r = extractFences(md);
  expect('json5 is not json', r.count === 1, `got ${r.count}`);
  expect('the json fence is the one found', r.fences[0].includes('"yes"'));
  const all = extractFences(md, { lang: null });
  expect('lang:null takes every fence', all.count === 2, `got ${all.count}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 4: unparseable fences are reported, not dropped');
{
  const md = '```json\n{ this is not json }\n```\n```json\n{"id":"ok"}\n```\n';
  const r = extractJsonFences(md);
  expect('count is 2 (both fences seen)', r.count === 2, `got ${r.count}`);
  expect('1 parsed', r.parsed.length === 1, `got ${r.parsed.length}`);
  expect('1 reported as failed', r.failed.length === 1, `got ${r.failed.length}`);
  const pub = extractPublishedRules(DOC_LF);
  expect('extractPublishedRules flattens {"rules":[…]} and bare objects', pub.rules.length === 2,
    JSON.stringify(pub.rules.map((x) => x.id)));
  expect('ids in publication order',
    pub.rules.map((x) => x.id).join(',') === 'alpha-rule,alpha-rule-positive-control',
    pub.rules.map((x) => x.id).join(','));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 5: REAL corpus docs — extracted ids equal the ids they contributed');
{
  const rulesPath = path.join(ROOT, 'scripts/census/rules.json');
  const registry = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const byPath = new Map();
  for (const r of registry.rules) {
    if (!byPath.has(r.goldenPath)) byPath.set(r.goldenPath, []);
    byPath.get(r.goldenPath).push(r.id);
  }

  // Three documents chosen for shape, not convenience: two that contributed
  // MULTIPLE rules from one §9 (the exact case the "one rule per block"
  // extractor silently merged zero for) and one long recent path.
  const DOCS = [
    'docs/concepts/golden-paths/persisted-model-struct.md', // 3 rules
    'docs/concepts/golden-paths/focus-management.md',       // 2 rules
    'docs/concepts/golden-paths/entity-picker.md',          // long, recent
  ];

  for (const rel of DOCS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { expect(`${rel} exists`, false, 'missing'); continue; }
    const md = fs.readFileSync(abs, 'utf8');
    const pub = extractPublishedRules(md);
    // Mirror the merger's own filter: controls and baseline-less blocks are
    // evidence, not rules, and never reach the registry.
    const mergeable = pub.rules
      .filter((r) => !/positive[-_ ]?control/i.test(r.id))
      .filter((r) => r.baseline && typeof r.baseline.matches === 'number')
      .map((r) => r.id);
    const expected = byPath.get(rel) ?? [];
    expect(`${path.basename(rel)}: at least one fence found`, pub.count > 0, `count=${pub.count}`);
    expect(
      `${path.basename(rel)}: extracted ids === registry ids (${expected.length})`,
      JSON.stringify([...mergeable].sort()) === JSON.stringify([...expected].sort()),
      `extracted ${JSON.stringify(mergeable)} vs registry ${JSON.stringify(expected)}`,
    );
    // The doctrine's point: a control must be PRESENT and must NOT be merged.
    const controls = pub.rules.filter((r) => /positive[-_ ]?control/i.test(r.id));
    console.log(`     ${path.basename(rel)}: ${pub.count} json fences, ${mergeable.length} mergeable, ${controls.length} control(s)`);
  }
}

console.log(`\nextractFences: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`); process.exit(1); }
process.exit(0);
