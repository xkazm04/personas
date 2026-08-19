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

/**
 * `fs.existsSync` with the casing actually on disk.
 *
 * Windows and macOS are case-INSENSITIVE, Linux is not, and CI is Linux. So a
 * citation of `.../SKILL.md` for a file named `skill.md` passes on the author's
 * machine and fails in CI — which is exactly what happened: this gate reported
 * clean locally and red in CI for the same commit, and the local green was the
 * wrong one. Comparing against the parent directory's real entries makes the
 * check mean the same thing on every platform.
 *
 * Falls back to `existsSync` only when the parent cannot be listed, so a
 * permission quirk degrades to the old behaviour rather than to a false failure.
 */
const existsCaseExact = (abs) => {
  if (!fs.existsSync(abs)) return false;
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  try {
    return fs.readdirSync(dir).includes(base);
  } catch {
    return true;
  }
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
    const abs = path.join(ROOT, filePart);
    if (!existsCaseExact(abs)) {
      // Name the case mismatch specifically. "Does not exist" sends someone
      // hunting for a deleted file when the file is right there under another
      // capitalisation — and on their machine it will look like the gate lied.
      const hint = fs.existsSync(abs) ? ' (it exists with different capitalisation — CI is case-sensitive)' : '';
      fail(`${rel}: evidence "${ev}" does not exist in this repo${hint}`);
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

  // 2c. Parity, DIRECTIONAL — and the direction is the whole point after the
  //     authority flip (migration plan P3).
  //
  //     Before the flip the two sides were meant to be identical, so any
  //     difference was a defect. After it, new work lands in the REGISTRY and is
  //     mirrored back only when someone asks for it, so:
  //
  //       registry-only  → EXPECTED. Reported, never failed. Failing here would
  //                        make the gate red every time the registry is used as
  //                        intended, and a gate that is red for correct
  //                        behaviour gets muted.
  //       corpus-only    → STILL A FAILURE. The local tree carries something the
  //                        registry does not, which means the mirror dropped it
  //                        or someone edited a frozen tree. Both need a human.
  //
  //     Set difference, not counts: two collections can agree on size and
  //     disagree on every member.
  const diff = (a, b) => a.filter((x) => !b.includes(x));
  const missing = diff(corpusSubjects, bundleSubjects);
  const ahead = diff(bundleSubjects, corpusSubjects);
  if (missing.length) fail(`mirror parity: ${missing.length} subject(s) in the corpus but NOT the bundle: ${missing.join(', ')} — the mirror dropped them, or a frozen tree was edited`);
  if (ahead.length) note(`registry is ahead by ${ahead.length} subject(s): ${ahead.join(', ')} — expected after the authority flip; mirror them back with scripts/registry/mirror-paths.mjs if this repo needs them locally`);

  const tMissing = [...corpusTechniques].filter((x) => !bundleTechniques.has(x));
  const tAhead = [...bundleTechniques].filter((x) => !corpusTechniques.has(x));
  if (tMissing.length) fail(`mirror parity: ${tMissing.length} technique(s) in the corpus but NOT the bundle, first: ${tMissing.slice(0, 5).join(', ')}`);
  if (tAhead.length) note(`registry is ahead by ${tAhead.length} technique(s)`);

  const aMissing = [...corpusApplications].filter((x) => !bundleApplications.has(x));
  const aAhead = [...bundleApplications].filter((x) => !corpusApplications.has(x));
  if (aMissing.length) fail(`mirror parity: ${aMissing.length} application(s) in the corpus but NOT the bundle, first: ${aMissing.slice(0, 5).join(', ')}`);
  if (aAhead.length) note(`registry is ahead by ${aAhead.length} application(s)`);

  // A subject that exists only in the registry has no local evidence yet BY
  // DEFINITION — nothing in this tree has been cited for it. Counting it as a
  // partial mirror would make forging in the registry look like a mirror bug.
  const overlaysExpected = sidecarsMissing.filter((slug) => corpusSubjects.includes(slug));
  if (sidecarsFound > 0 && overlaysExpected.length > 0) {
    fail(
      `evidence overlays are partial: ${sidecarsFound} present, ${overlaysExpected.length} missing ` +
        `(${overlaysExpected.slice(0, 5).join(', ')}). Re-run scripts/registry/mirror-paths.mjs.`,
    );
  }
  const overlaysPending = sidecarsMissing.filter((slug) => !corpusSubjects.includes(slug));
  if (overlaysPending.length > 0) {
    note(
      `${overlaysPending.length} registry-only subject(s) carry no local evidence yet ` +
        `(${overlaysPending.slice(0, 5).join(', ')}) — expected until this repo cites them.`,
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
    console.log(
      '\nevidence resolves; ' +
        (paired
          ? 'the bundle carries everything this corpus does (it may carry more — see notes).'
          : 'pair checks skipped (see note).'),
    );
    console.log(
      'NOT checked here: layer contract, body purity, link resolution, status vocabulary — ' +
        'those are the registry\'s gate (scripts/check-bundles.mjs), by design.\n',
    );
  }
}

process.exit(failures.length ? 1 : 0);
