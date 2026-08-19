#!/usr/bin/env node
/**
 * evidence-check — the half of the corpus gate that CANNOT move to the registry.
 *
 * When `docs/concepts/paths/` becomes a Reference Knowledge Bundle published at
 * `xkazm04/ai-registry`, the structural checks go with it (layers, purity, link
 * resolution, status vocabulary — `scripts/check-bundles.mjs` over there). Two
 * checks cannot, because they are statements about a PARTICULAR codebase rather
 * than about the standard:
 *
 *   1. **Evidence resolution.** `evidence:` and `counter_evidence:` cite files in
 *      *this* tree. The registry has no idea whether `src/features/.../UnifiedTable.tsx`
 *      exists, and should not: that is what makes the bundle transplantable.
 *   2. **Mirror parity.** Whether the published bundle still describes the same
 *      corpus this repo forged is a claim about the pair, so neither side's CI
 *      can make it alone.
 *
 * Splitting a gate is how gates quietly get dropped, so this script exists to
 * make the split explicit and keep both halves running.
 *
 * Usage:
 *   node scripts/registry/evidence-check.mjs [--registry <dir>] [--require-registry] [--json]
 *
 * Registry location, in order: `--registry`, `$AI_REGISTRY_DIR`, `../ai-registry`.
 * Without one, evidence resolution still runs and the pair checks are SKIPPED
 * OUT LOUD (never silently) unless `--require-registry` makes absence fatal.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitDoc, listValues, hasKey } from './lib/frontmatter.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const CORPUS = path.join(ROOT, 'docs/concepts/paths');
const DOMAIN = 'software-engineering';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

const REGISTRY =
  opt('--registry') || process.env.AI_REGISTRY_DIR || path.resolve(ROOT, '..', 'ai-registry');
const BUNDLE = path.join(REGISTRY, 'knowledge', DOMAIN);
const LOCAL_ONLY_KEYS = ['evidence', 'counter_evidence', 'deviations'];

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const note = (msg) => notes.push(msg);

/** Abort with a message that says BLIND, not CLEAN. */
const fatal = (msg) => {
  console.error(`\nevidence-check FATAL: ${msg}`);
  console.error('Reporting nothing is not the same as finding nothing — refusing to exit 0.\n');
  process.exit(2);
};

const readFm = (abs) => {
  const split = splitDoc(fs.readFileSync(abs, 'utf8'));
  return split ? split.fmLines : null;
};

const mdFiles = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.')).sort()
    : [];

const subjectsOf = (base) =>
  fs.existsSync(base)
    ? fs
        .readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((slug) => fs.existsSync(path.join(base, slug, `${slug}.md`)))
        .sort()
    : [];

// ---------------------------------------------------------------------------
// 0. Assert the inputs. A checker that walks zero files and exits 0 reports
//    "clean" when it means "blind" — this repo has been bitten by exactly that.
// ---------------------------------------------------------------------------

if (!fs.existsSync(CORPUS)) {
  fatal(
    `no corpus at ${path.relative(ROOT, CORPUS)}. If the authority has already moved to the ` +
      `registry, this script needs its evidence source re-pointed (migration plan P3/P4) — ` +
      `not deleting.`,
  );
}
const corpusSubjects = subjectsOf(CORPUS);
if (corpusSubjects.length === 0) {
  fatal(`${path.relative(ROOT, CORPUS)} contains no subject folders.`);
}

// ---------------------------------------------------------------------------
// 1. Evidence resolution — the consumer-side half of the corpus gate.
// ---------------------------------------------------------------------------

let evidenceTotal = 0;
let subjectsWithoutEvidence = 0;
const corpusTechniques = new Set();
const corpusApplications = new Set();

for (const slug of corpusSubjects) {
  const rel = `docs/concepts/paths/${slug}/${slug}.md`;
  const fm = readFm(path.join(CORPUS, slug, `${slug}.md`));
  if (!fm) {
    fail(`${rel}: no frontmatter block`);
    continue;
  }

  const evidence = listValues(fm, 'evidence');
  const counter = listValues(fm, 'counter_evidence');
  if (evidence.length === 0) {
    subjectsWithoutEvidence += 1;
    fail(`${rel}: zero evidence links — a standard with no witness`);
  }
  for (const ev of [...evidence, ...counter]) {
    evidenceTotal += 1;
    // Evidence may carry a `#Lnn` or `:nn` locator; existence is asserted on
    // the file, which is the part that rots when code moves.
    const filePart = ev.split('#')[0].trim();
    if (!fs.existsSync(path.join(ROOT, filePart))) {
      fail(`${rel}: evidence "${ev}" does not exist in this repo`);
    }
  }

  for (const f of mdFiles(path.join(CORPUS, slug, 'techniques'))) {
    corpusTechniques.add(`${slug}/${f}`);
  }
  for (const f of mdFiles(path.join(CORPUS, slug, 'applications'))) {
    corpusApplications.add(`${slug}/${f}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Pair checks — only meaningful with a registry clone in hand.
// ---------------------------------------------------------------------------

let paired = false;
let bundleSubjects = [];
const bundleTechniques = new Set();
const bundleApplications = new Set();
let sidecarsFound = 0;
let sidecarsMissing = [];

if (!fs.existsSync(BUNDLE)) {
  const msg =
    `no registry bundle at ${BUNDLE} — mirror parity and the leak gate were NOT checked. ` +
    `Clone https://github.com/xkazm04/ai-registry beside this repo, or pass --registry <dir>.`;
  if (flag('--require-registry')) fatal(msg);
  note(`SKIPPED: ${msg}`);
} else {
  paired = true;
  bundleSubjects = subjectsOf(BUNDLE);

  for (const slug of bundleSubjects) {
    for (const f of mdFiles(path.join(BUNDLE, slug, 'techniques'))) {
      bundleTechniques.add(`${slug}/${f}`);
    }
    for (const f of mdFiles(path.join(BUNDLE, slug, 'applications'))) {
      bundleApplications.add(`${slug}/${f}`);
    }

    // 2a. Leak gate. The published bundle must declare none of the local-only
    //     keys. Registry CI checks this too — cheaply repeated here so a bad
    //     mirror is caught BEFORE it is pushed rather than after.
    const files = [
      path.join(BUNDLE, slug, `${slug}.md`),
      ...mdFiles(path.join(BUNDLE, slug, 'techniques')).map((f) =>
        path.join(BUNDLE, slug, 'techniques', f),
      ),
      ...mdFiles(path.join(BUNDLE, slug, 'applications')).map((f) =>
        path.join(BUNDLE, slug, 'applications', f),
      ),
    ];
    for (const abs of files) {
      if (!fs.existsSync(abs)) continue;
      const fm = readFm(abs);
      if (!fm) continue;
      for (const key of LOCAL_ONLY_KEYS) {
        if (hasKey(fm, key)) {
          fail(
            `LEAK: knowledge/${DOMAIN}/${path.relative(path.join(BUNDLE), abs).replace(/\\/g, '/')} ` +
              `declares "${key}:" — evidence is consumer-side (rkb-profile §5) and must not publish`,
          );
        }
      }
    }

    // 2b. Sidecar completeness. The overlays are gitignored, so a fresh clone
    //     has none and that is correct — but a PARTIAL set means the mirror
    //     stopped halfway, which is worth catching on the machine that mirrors.
    if (fs.existsSync(path.join(BUNDLE, slug, '.evidence.local.md'))) sidecarsFound += 1;
    else sidecarsMissing.push(slug);
  }

  // 2c. Parity. Set equality, not counts: two sets can agree on size while
  //     disagreeing on every member.
  const diff = (a, b) => a.filter((x) => !b.includes(x));
  const missing = diff(corpusSubjects, bundleSubjects);
  const extra = diff(bundleSubjects, corpusSubjects);
  if (missing.length) fail(`mirror parity: ${missing.length} subject(s) absent from the bundle: ${missing.join(', ')}`);
  if (extra.length) fail(`mirror parity: ${extra.length} subject(s) in the bundle but not the corpus: ${extra.join(', ')}`);

  const tMissing = [...corpusTechniques].filter((x) => !bundleTechniques.has(x));
  const tExtra = [...bundleTechniques].filter((x) => !corpusTechniques.has(x));
  if (tMissing.length) fail(`mirror parity: ${tMissing.length} technique(s) absent from the bundle, first: ${tMissing.slice(0, 5).join(', ')}`);
  if (tExtra.length) fail(`mirror parity: ${tExtra.length} technique(s) in the bundle only, first: ${tExtra.slice(0, 5).join(', ')}`);

  const aMissing = [...corpusApplications].filter((x) => !bundleApplications.has(x));
  const aExtra = [...bundleApplications].filter((x) => !corpusApplications.has(x));
  if (aMissing.length) fail(`mirror parity: ${aMissing.length} application(s) absent from the bundle, first: ${aMissing.slice(0, 5).join(', ')}`);
  if (aExtra.length) fail(`mirror parity: ${aExtra.length} application(s) in the bundle only, first: ${aExtra.slice(0, 5).join(', ')}`);

  if (sidecarsFound > 0 && sidecarsMissing.length > 0) {
    fail(
      `evidence overlays are partial: ${sidecarsFound} present, ${sidecarsMissing.length} missing ` +
        `(${sidecarsMissing.slice(0, 5).join(', ')}). Re-run scripts/registry/mirror-paths.mjs.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const summary = {
  corpus: {
    root: 'docs/concepts/paths',
    subjects: corpusSubjects.length,
    techniques: corpusTechniques.size,
    applications: corpusApplications.size,
    evidenceLinks: evidenceTotal,
    subjectsWithoutEvidence,
  },
  bundle: paired
    ? {
        root: path.relative(ROOT, BUNDLE).replace(/\\/g, '/'),
        subjects: bundleSubjects.length,
        techniques: bundleTechniques.size,
        applications: bundleApplications.size,
        evidenceOverlays: sidecarsFound,
      }
    : null,
  failures,
  notes,
};

if (flag('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('');
  console.log(
    `corpus  ${summary.corpus.subjects} subjects · ${summary.corpus.techniques} techniques · ` +
      `${summary.corpus.applications} applications · ${evidenceTotal} evidence links resolved`,
  );
  if (paired) {
    console.log(
      `bundle  ${summary.bundle.subjects} subjects · ${summary.bundle.techniques} techniques · ` +
        `${summary.bundle.applications} applications · ${sidecarsFound} local evidence overlays`,
    );
  }
  for (const n of notes) console.log(`\n  note: ${n}`);
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
  } else {
    console.log('\nevidence resolves; ' + (paired ? 'mirror is at parity.' : 'pair checks skipped (see note).'));
    console.log(
      'NOT checked here: layer contract, body purity, link resolution, status vocabulary — ' +
        'those are the registry\'s gate (scripts/check-bundles.mjs), by design.\n',
    );
  }
}

process.exit(failures.length ? 1 : 0);
