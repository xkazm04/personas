// Merge the census rule(s) a golden path publishes in its §9 into rules.json.
//
// Composers are told NOT to edit rules.json — a dozen agents writing to one
// registry concurrently is how you lose a rule. Instead each publishes a fenced
// ```json block shaped {"rules":[...]}, and the parent merges it here.
//
// This exists because the parent hand-rolled the extraction five times and got
// it wrong once: an extractor that assumed one rule per block silently merged
// ZERO when a composer published {"rules":[a,b]}, and the census reported the
// same 16 rules as before — a no-op that looks exactly like success. 217 leaves
// remain, so this happens 217 more times.
//
// Usage: node scripts/census/merge-published-rules.mjs <path-to-golden-path.md>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The fence extraction moved into a shared, regression-tested instrument on
// 2026-08-17 (scripts/census/lib/instruments/extractFences.mjs). Behaviour is
// unchanged — asserted over three real corpus documents against the ids they
// contributed to the committed rules.json, plus the whole corpus (175 docs /
// 232 fences / 278 ids, byte-identical before and after the refactor).
//
// It moved because this merger is no longer the only reader of a §9 fence:
// build-golden-path-index.mjs reads the same blocks to build the corpus router,
// and the recorded failure — "a CRLF rewrite makes the merger see ZERO fenced
// blocks; a lost rule looks exactly like a rule nobody wrote" — is silent in
// EVERY reader. One extractor, one place to fix it, one place to test it.
import { extractPublishedRules } from './lib/instruments/extractFences.mjs';

// Derived, not hardcoded — see scripts/census/check-corpus-integrity.mjs.
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const RULES = path.join(ROOT, 'scripts/census/rules.json');

const doc = process.argv[2];
if (!doc) {
  console.error('usage: merge-published-rules.mjs <golden-path.md>');
  process.exit(2);
}
const docPath = path.isAbsolute(doc) ? doc : path.join(ROOT, doc);
if (!fs.existsSync(docPath)) {
  console.error(`FATAL: ${docPath} does not exist`);
  process.exit(2);
}

const src = fs.readFileSync(docPath, 'utf8');
// Composers publish the rule two ways, and both are legitimate: a bare fenced
// block, or one nested inside a blockquote (`> ```json`) when §9 presents it as
// a quoted specification. Two composers used the blockquote form and the
// extractor silently reported "no ```json block" — the rule was published and
// simply never merged. The shared extractor strips a leading quote marker per
// line, and CRLF-normalizes first. Both behaviours are regression-tested.
//
// Every shape a composer might reasonably publish is accepted rather than
// failing on a formatting choice: {"rules":[...]} | [...] | {...}. Anything
// without an `id` is prose-illustrative JSON (an example config, a sample
// payload) and is counted as skipped rather than silently dropped.
const published = extractPublishedRules(src);
if (published.count === 0) {
  console.error('FATAL: no ```json block in this path. A path that gates nothing must say so in prose;');
  console.error('a path that gates something must publish the rule. Neither is true here.');
  process.exit(2);
}
for (const f of published.failed) {
  console.warn(`  (json fence #${f.index + 1} did not parse — ${f.error})`);
}
for (let n = 0; n < published.skipped; n++) {
  console.warn(`  (skipped a json block with no "id" — assumed illustrative)`);
}

const incoming = [];
for (const c of published.rules) {
  // Composers are now REQUIRED to ship a positive control: the same anchors
  // pointed at the COMPLIANT form, which must also fail. That block is
  // evidence, not a rule — and merging it is actively harmful, because a
  // ratchet is monotone-downward, so a rule counting compliant code fails the
  // build every time adoption IMPROVES. One slipped through on 2026-08-14
  // (`POSITIVE-CONTROL-tooltip-primitive`, baseline undefined) and would have
  // broken `census:check` outright. Mandating the control without teaching
  // the merger about it was the defect.
  if (/positive[-_ ]?control/i.test(c.id)) {
    console.log(`  ~ ${c.id} looks like a positive control — NOT merged (evidence, not a gate)`);
    continue;
  }
  // A rule with no baseline cannot ratchet and would fail structurally.
  if (!c.baseline || typeof c.baseline.matches !== 'number') {
    console.log(`  ~ ${c.id} has no numeric baseline — NOT merged (illustrative or a control)`);
    continue;
  }
  incoming.push(c);
}
if (incoming.length === 0) {
  console.error('FATAL: parsed json blocks but none carried an "id". Nothing merged.');
  process.exit(2);
}

const registry = JSON.parse(fs.readFileSync(RULES, 'utf8'));
const before = registry.rules.length;
const existing = new Set(registry.rules.map((r) => r.id));

let merged = 0;
for (const r of incoming) {
  if (existing.has(r.id)) { console.log(`  = ${r.id} already present, skipped`); continue; }
  // A rule whose goldenPath does not point back at the doc that published it
  // will pass the census and fail corpus integrity later, confusingly.
  const rel = path.relative(ROOT, docPath).split(path.sep).join('/');
  if (r.goldenPath && r.goldenPath !== rel) {
    console.warn(`  ! ${r.id} declares goldenPath "${r.goldenPath}" but was published by "${rel}"`);
  }
  if (!r.goldenPath) r.goldenPath = rel;
  registry.rules.push(r);
  existing.add(r.id);
  merged++;
  console.log(`  + ${r.id}  baseline ${JSON.stringify(r.baseline)}  floor ${r.floor}`);
}

if (merged > 0) {
  fs.writeFileSync(RULES, JSON.stringify(registry, null, 2) + '\n');
  console.log(`merged ${merged} rule(s): ${before} -> ${registry.rules.length}`);
  console.log('now run: npm run census   (baselines must reproduce EXACTLY)');
} else {
  console.log(`nothing to merge (${before} rules unchanged)`);
}

refreshGoldenPathIndex();
process.exit(0);

/**
 * Regenerate index.json / router.json after every merge.
 *
 * REGISTRATION IS THE WHOLE VARIABLE (doctrine §2). A composer measured it:
 * registration predicted fresh-vs-stale generated artifacts **14/14**, against
 * **1/4** for the obvious rival (a compare-before-write guard). The corpus's own
 * tour-anchor generator is the cautionary case — it emits two byte-consistent
 * artifacts that are **127 anchors behind the tree**, because it is wired into
 * nothing.
 *
 * This is the wave loop's natural door: the orchestrator already runs the merger
 * once per composed path, so hanging the regeneration here keeps the artifacts
 * fresh through the existing flow, with nobody needing to know they exist.
 * (`predev`/`prebuild` register it a second time for everyone else.)
 *
 * It NEVER fails the merger. The rules were already written; turning a
 * post-write bookkeeping step into a non-zero exit would report a successful
 * merge as a failure, and the next person's fix would be to delete the call.
 */
function refreshGoldenPathIndex() {
  const script = path.join(ROOT, 'scripts/census/build-golden-path-index.mjs');
  if (!fs.existsSync(script)) return;
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) {
    console.log(`  index: ${(r.stdout || '').trim()}`);
  } else {
    console.warn(`  ! golden-path index NOT regenerated (exit ${r.status}). Run it yourself:`);
    console.warn('    node scripts/census/build-golden-path-index.mjs');
    if (r.stderr) console.warn(r.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n'));
  }
}
