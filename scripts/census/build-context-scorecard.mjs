#!/usr/bin/env node
/**
 * Per-context adherence scorecard — the join specified by
 * `docs/concepts/knowledge-hierarchy-plan.md` §6 and consumed by
 * `docs/plans/patterns-v2-ui.md` P4 (dev_tools_hierarchy_scorecard).
 *
 * Joins three authorities:
 *   1. Census match sites  — every rule in `rules.json` run through the REAL
 *      engine (`lib/engine.mjs` scanRule, with `collectScanned` so the rule's
 *      scanned-file SET — not just the count — defines applicability).
 *   2. Rule → subject      — `rule.goldenPath` basename resolved through
 *      `docs/concepts/paths/corpus-map.json` entries. Rules that do not
 *      resolve (or that carry `principle` instead) land in `unassignedRules`
 *      — reported, never dropped silently.
 *   3. Context map         — `context-map.json` at repo root (generator
 *      personas-context-scan). A file may belong to multiple contexts; it is
 *      counted in EACH, and `totals.multiContextFiles` says how often.
 *
 * Honesty contract (this repo's laws):
 *   - every count carries its predicate in its field name / the $comment
 *   - missing/empty input  -> exit 1 with a message, NEVER a green empty artifact
 *   - files matched but in no context -> per-subject `uncontexted` bucket
 *   - a subject absent from the output has NO census rules — absence is not
 *     cleanliness (census coverage != adherence coverage)
 *
 * Writes `scripts/census/context-scorecard.json` (counts only — no per-site
 * line numbers, no scanned-file lists; the artifact must stay lean).
 *
 *   node scripts/census/build-context-scorecard.mjs
 *
 * Test hooks (announced on stderr when active — same convention as
 * build-golden-path-index.mjs): SCORECARD_RULES / SCORECARD_CORPUS_MAP /
 * SCORECARD_CONTEXT_MAP / SCORECARD_ROOT / SCORECARD_OUT.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRule, validateRule } from './lib/engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

const env = (name, fallback) => {
  const v = process.env[name];
  if (v) console.error(`scorecard: OVERRIDE ACTIVE — ${name}=${v}`);
  return v ? resolve(v) : fallback;
};

const RULES_FILE = env('SCORECARD_RULES', resolve(HERE, 'rules.json'));
const CORPUS_MAP_FILE = env('SCORECARD_CORPUS_MAP', resolve(REPO_ROOT, 'docs/concepts/paths/corpus-map.json'));
const CONTEXT_MAP_FILE = env('SCORECARD_CONTEXT_MAP', resolve(REPO_ROOT, 'context-map.json'));
const SCAN_ROOT = env('SCORECARD_ROOT', REPO_ROOT);
const OUT_FILE = env('SCORECARD_OUT', resolve(HERE, 'context-scorecard.json'));

function die(msg) {
  console.error(`scorecard: FATAL — ${msg}`);
  console.error('scorecard: refusing to write an artifact from a broken input. Nothing was written.');
  process.exit(1);
}

function loadJson(file, what) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    die(`cannot read ${what} at ${file} — ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(`${what} at ${file} is not valid JSON — ${err.message}`);
  }
}

// ---------------------------------------------------------------- inputs ---

const registry = loadJson(RULES_FILE, 'rules registry');
const allRules = registry.rules ?? [];
if (allRules.length === 0) die(`rule registry ${RULES_FILE} declares zero rules — a join over nothing is not a scorecard`);
const schemaErrors = allRules.flatMap((r, i) => validateRule(r, i));
if (schemaErrors.length > 0) die(`rule registry is malformed:\n  ${schemaErrors.join('\n  ')}`);

const corpusMap = loadJson(CORPUS_MAP_FILE, 'corpus map');
const corpusEntries = corpusMap.entries ?? {};
if (Object.keys(corpusEntries).length === 0) die(`corpus map ${CORPUS_MAP_FILE} has zero entries — no rule can resolve to a subject`);

const contextMap = loadJson(CONTEXT_MAP_FILE, 'context map');
const contexts = contextMap.contexts ?? [];
if (contexts.length === 0) die(`context map ${CONTEXT_MAP_FILE} declares zero contexts — the join has no right-hand side`);
if (contextMap.generator && contextMap.generator !== 'personas-context-scan') {
  // Two different tools write this path (see .claude/CLAUDE.md "Two different maps").
  // The app's own map is the authority for anything the app consumes.
  console.error(
    `scorecard: WARNING — context map generator is "${contextMap.generator}", expected "personas-context-scan". ` +
      'This may be the stale foreign (Vibeman) snapshot; the artifact will say so in inputs.contextMapGenerator.',
  );
}

// ---------------------------------------------- rule -> subject resolution ---

// Positive controls count COMPLIANT code by design; folding them into a
// violation scorecard would invert their meaning. None exist today; the shape
// is handled so the first one added does not silently poison the join.
const controlRules = allRules.filter((r) => /positive[-_ ]?control/i.test(r.id));
const candidateRules = allRules.filter((r) => !controlRules.includes(r));

const assigned = []; // { rule, subject }
const unassignedRules = [];
for (const rule of candidateRules) {
  if (typeof rule.goldenPath !== 'string') {
    unassignedRules.push(rule.id); // `principle`-grounded (consuming-repo shape)
    continue;
  }
  const base = rule.goldenPath.split('/').pop();
  const subject = corpusEntries[base];
  if (typeof subject === 'string' && subject.length > 0) assigned.push({ rule, subject });
  else unassignedRules.push(rule.id);
}
if (assigned.length === 0) die('zero rules resolved to a subject — the corpus map and the rule registry do not speak about the same corpus');

// ----------------------------------------------------- file -> context index ---

const fileToContexts = new Map(); // repo-relative posix path -> [{id,name,group}]
const contextMeta = new Map(); // id -> {id,name,group}
for (const ctx of contexts) {
  const meta = { id: ctx.id, name: ctx.name, group: ctx.group };
  contextMeta.set(ctx.id, meta);
  for (const raw of ctx.file_paths ?? []) {
    const f = String(raw).split('\\').join('/');
    let list = fileToContexts.get(f);
    if (!list) fileToContexts.set(f, (list = []));
    list.push(meta);
  }
}

// -------------------------------------------------------------- the join ---

const subjects = new Map(); // slug -> working aggregate
const getSubject = (slug) => {
  let s = subjects.get(slug);
  if (!s) {
    subjects.set(slug, (s = {
      ruleIds: new Set(),
      sites: 0,
      matchedFiles: new Set(),
      applicableContextIds: new Set(),
      perContext: new Map(), // ctxId -> { sites, matchedFiles:Set, rules:Map(ruleId->sites) }
      uncontextedSites: 0,
      uncontextedFiles: new Set(),
    }));
  }
  return s;
};

let totalSites = 0;
const allMatchedFiles = new Set();
const multiContextMatchedFiles = new Set();

console.error(`scorecard: scanning ${assigned.length} rule(s) over ${SCAN_ROOT} ...`);
for (const { rule, subject } of assigned) {
  const result = scanRule(rule, { root: SCAN_ROOT, collectScanned: true });
  const s = getSubject(subject);
  s.ruleIds.add(rule.id);

  // Applicability: contexts containing >=1 file this rule actually SCANNED
  // (post-exclude). "Applicable" is a predicate about the scan, not the repo.
  for (const f of result.scannedFiles) {
    const ctxs = fileToContexts.get(f);
    if (ctxs) for (const c of ctxs) s.applicableContextIds.add(c.id);
  }

  for (const hit of result.hits) {
    totalSites += hit.matches;
    s.sites += hit.matches;
    s.matchedFiles.add(hit.file);
    allMatchedFiles.add(hit.file);
    const ctxs = fileToContexts.get(hit.file);
    if (!ctxs || ctxs.length === 0) {
      s.uncontextedSites += hit.matches;
      s.uncontextedFiles.add(hit.file);
      continue;
    }
    if (ctxs.length > 1) multiContextMatchedFiles.add(hit.file);
    for (const c of ctxs) {
      let pc = s.perContext.get(c.id);
      if (!pc) s.perContext.set(c.id, (pc = { sites: 0, matchedFiles: new Set(), rules: new Map() }));
      pc.sites += hit.matches;
      pc.matchedFiles.add(hit.file);
      pc.rules.set(rule.id, (pc.rules.get(rule.id) ?? 0) + hit.matches);
    }
  }
}

// --------------------------------------------------------------- artifact ---

const subjectsOut = {};
let cleanSubjects = 0;
for (const slug of [...subjects.keys()].sort()) {
  const s = subjects.get(slug);
  if (s.sites === 0) cleanSubjects++;
  const contextsOut = [...s.perContext.entries()]
    .map(([id, pc]) => ({
      id,
      name: contextMeta.get(id).name,
      group: contextMeta.get(id).group,
      sites: pc.sites,
      matchedFiles: pc.matchedFiles.size,
      rules: [...pc.rules.entries()]
        .map(([rid, n]) => ({ id: rid, sites: n }))
        .sort((a, b) => b.sites - a.sites || a.id.localeCompare(b.id)),
    }))
    .filter((c) => c.sites > 0)
    .sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name));

  const applicable = s.applicableContextIds.size;
  const withSites = new Set(contextsOut.map((c) => c.id));
  let clean = 0;
  for (const id of s.applicableContextIds) if (!withSites.has(id)) clean++;

  subjectsOut[slug] = {
    rules: s.ruleIds.size,
    sites: s.sites,
    matchedFiles: s.matchedFiles.size,
    applicableContexts: applicable,
    cleanContexts: clean,
    contexts: contextsOut,
    uncontexted: { sites: s.uncontextedSites, files: s.uncontextedFiles.size },
  };
}

const artifact = {
  $comment:
    'Derived artifact — NEVER hand-edit. Regenerate with: node scripts/census/build-context-scorecard.mjs. ' +
    'Joins census match sites (rules.json via engine.mjs) x corpus-map.json x context-map.json. ' +
    'Consumed by dev_tools_hierarchy_scorecard. Predicates: sites = surviving census matches ' +
    '(comment-line matches already excluded by the engine); matchedFiles = distinct files with >=1 site; ' +
    'applicableContexts = contexts containing >=1 file SCANNED (post-exclude) by any of the subject\'s rules; ' +
    'cleanContexts = applicable AND zero sites; a file in multiple contexts is counted in EACH ' +
    '(totals.multiContextFiles is how many matched files that affects); files matched but in NO context land in ' +
    'the per-subject uncontexted bucket. A subject absent here has no census rules yet; absence is NOT ' +
    'cleanliness — census coverage != adherence coverage.',
  generatedAt: new Date().toISOString(),
  inputs: {
    ruleCount: allRules.length,
    assignedRules: assigned.length,
    unassignedRules,
    controlRulesExcluded: controlRules.map((r) => r.id),
    contextCount: contexts.length,
    contextMapGenerator: contextMap.generator ?? null,
    contextMapGeneratedAt: contextMap.generated_at ?? null,
    subjectCount: subjects.size,
  },
  totals: {
    sites: totalSites,
    matchedFiles: allMatchedFiles.size,
    multiContextFiles: multiContextMatchedFiles.size,
    cleanSubjects,
  },
  subjects: subjectsOut,
};

writeFileSync(OUT_FILE, JSON.stringify(artifact, null, 2) + '\n', 'utf8');

// ---------------------------------------------------------------- summary ---

const kb = (statSync(OUT_FILE).size / 1024).toFixed(1);
console.log(`\ncontext scorecard written: ${OUT_FILE} (${kb} KB)`);
console.log(
  `  ${assigned.length}/${allRules.length} rules assigned to ${subjects.size} subject(s); ` +
    `${totalSites} site(s) across ${allMatchedFiles.size} file(s); ` +
    `${multiContextMatchedFiles.size} matched file(s) in >1 context; ${cleanSubjects} clean subject(s)`,
);

const top = Object.entries(subjectsOut).sort((a, b) => b[1].sites - a[1].sites).slice(0, 10);
console.log('\n  top subjects by sites:');
console.log('    subject                              sites  files  rules  applCtx  cleanCtx');
for (const [slug, s] of top) {
  const pad = (v, n) => String(v).padStart(n);
  console.log(`    ${slug.padEnd(36)} ${pad(s.sites, 5)} ${pad(s.matchedFiles, 6)} ${pad(s.rules, 6)} ${pad(s.applicableContexts, 8)} ${pad(s.cleanContexts, 9)}`);
}

if (unassignedRules.length > 0) {
  console.log(`\n  unassigned rules (goldenPath not in corpus-map, or principle-grounded) — reported, not dropped:`);
  for (const id of unassignedRules) console.log(`    - ${id}`);
} else {
  console.log('\n  unassigned rules: none — every rule resolved to a subject');
}
if (controlRules.length > 0) {
  console.log(`  positive controls excluded (they count compliant code): ${controlRules.map((r) => r.id).join(', ')}`);
}

const uncontextedTotal = Object.values(subjectsOut).reduce(
  (acc, s) => ({ sites: acc.sites + s.uncontexted.sites, files: acc.files + s.uncontexted.files }),
  { sites: 0, files: 0 },
);
console.log(
  `  uncontexted (matched but in NO context): ${uncontextedTotal.sites} site(s) / ` +
    `${uncontextedTotal.files} per-subject file bucket entries (a file can appear under several subjects)`,
);
console.log('');
