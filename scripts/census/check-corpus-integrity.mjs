// Corpus integrity — the accounting gate the golden-path corpus did not have.
//
// Written 2026-08-14 after two defects of the same family surfaced within an
// hour of each other, neither caught by anything:
//
//   1. `docs/concepts/research/portability-test.md` was cited by path from TEN
//      committed files, including `golden-path-contract.md`, and had never been
//      staged. Every one of those cross-references was a dead link on master,
//      inside a milestone that had already been pushed. It was found by reading
//      `git status` before an unrelated commit — not by any check.
//
//   2. Three written paths (`modals.md`, `tables.md`, `page-loading.md`) have
//      filenames that match no leaf slug in `situation-spine.json`, so the
//      accounting that picks the next leaf to compose counted them as UNWRITTEN.
//      `modals.md` is the leaf `modal-dialog`, recurrence 243 — it had risen to
//      #12 in the dispatch queue and was one batch away from being composed a
//      second time.
//
// Both are the same bug: the corpus indexes itself by convention, and nothing
// verified the convention held. 31 paths now cross-reference each other heavily,
// so the blast radius grows with every leaf written.
//
// THE INSTRUMENT IS ASSERTED BEFORE THE RESULT. A checker that silently walks
// zero files reports success. Wave 1 found four gates in this repo that ran
// green while checking nothing (an FK assertion against an empty database, a
// parity test comparing a file to itself, a secret scan exiting 0 when the
// scanner was absent). This one fails loudly if its own inputs go missing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Derived from this file's own location, NOT hardcoded.
//
// This read `const ROOT = 'C:/Users/mkdol/dolla/personas'` until 2026-08-15 —
// the author's machine. On any other checkout it exits non-zero immediately,
// and because `npm run check` is an `&&` chain with `check:corpus` at step 5 of
// 9, that aborted the run before `tsc --noEmit`, `eslint src/` and
// `census:check` ever executed. A gate that cannot run anywhere but one laptop
// is not a gate, and this one was written in the same pass as the doctrine
// paragraph telling everyone else to assert their instruments.
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PATHS_DIR = path.join(ROOT, 'docs/concepts/golden-paths');
const SPINE = path.join(ROOT, 'docs/concepts/situation-spine.json');
const RULES = path.join(ROOT, 'scripts/census/rules.json');
const CONCEPTS = path.join(ROOT, 'docs/concepts');

// Files that live in golden-paths/ but are not golden paths. Each needs a
// reason; an unexplained entry here is how a real gap gets hidden.
const NOT_A_PATH = {
  'REVIEW-wave1.md': 'Wave-1 review artifact, not a path. Should move to docs/concepts/review/.',
};

const failures = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------- inputs
for (const p of [PATHS_DIR, SPINE, RULES]) {
  if (!fs.existsSync(p)) {
    console.error(`FATAL: required input missing: ${p}`);
    console.error('This checker cannot run. Failing loudly rather than reporting a green tree.');
    process.exit(2);
  }
}

const spine = JSON.parse(fs.readFileSync(SPINE, 'utf8'));
const leaves = [];
const walkSpine = (n) => {
  const kids = n.children || n.subdomains || n.situations || n.leaves;
  if (Array.isArray(kids) && kids.length) kids.forEach(walkSpine);
  else leaves.push(n);
};
(spine.domains || spine.children || (Array.isArray(spine) ? spine : [])).forEach(walkSpine);

if (leaves.length < 200) {
  console.error(`FATAL: spine yielded ${leaves.length} leaves; expected ~247.`);
  console.error('THE WALKER IS BROKEN, NOT THE SPINE. Refusing to report on a tree it cannot read.');
  process.exit(2);
}

const pathFiles = fs.readdirSync(PATHS_DIR).filter((f) => f.endsWith('.md'));
if (pathFiles.length === 0) {
  console.error('FATAL: zero .md files in golden-paths/. THE READER IS BROKEN.');
  process.exit(2);
}

// ------------------------------------------- 1. every file maps to a leaf
// A leaf claims a file by slug, or explicitly via a `doc` field when the
// filename predates the slug (the modals/tables/page-loading case).
const byDoc = new Map();
const slugs = new Set();
for (const l of leaves) {
  const slug = l.slug || l.id;
  if (slug) slugs.add(slug);
  if (l.doc) {
    if (byDoc.has(l.doc)) fail(`two leaves claim the same doc "${l.doc}": ${byDoc.get(l.doc)} and ${slug}`);
    byDoc.set(l.doc, slug);
  }
}

const written = new Set();
for (const f of pathFiles) {
  if (NOT_A_PATH[f]) continue;
  const stem = f.replace(/\.md$/, '');
  if (slugs.has(stem)) { written.add(stem); continue; }
  if (byDoc.has(f)) { written.add(byDoc.get(f)); continue; }
  fail(
    `golden-paths/${f} matches no spine leaf.\n` +
    `      Either the filename should equal a leaf slug, or that leaf needs "doc": "${f}".\n` +
    `      Until then the leaf counts as UNWRITTEN and may be composed a second time.`,
  );
}

// A leaf that points at a file that does not exist is the inverse error, and
// the more dangerous one: it reports work as done that was never written.
for (const [doc, slug] of byDoc) {
  if (!fs.existsSync(path.join(PATHS_DIR, doc))) {
    fail(`spine leaf "${slug}" declares doc "${doc}", which does not exist. A leaf cannot claim a file that is not there.`);
  }
}

// ------------------------------------- 2. every relative doc link resolves
// This is the portability-test class: a path cited by name that was never
// committed. Only relative links are checked; http(s) and anchors are not ours.
const mdFiles = [];
const walkDocs = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkDocs(p);
    else if (e.name.endsWith('.md')) mdFiles.push(p);
  }
};
walkDocs(CONCEPTS);

// Strip fenced blocks and inline code BEFORE looking for links. A regex is not
// a hyperlink, and this checker learned that by failing on its own corpus:
// `(?:mousedown|pointerdown)` written next to a bracketed character class in
// anchored-popover.md parses as `[...](?:mousedown|pointerdown)` and was
// reported as a dead link. Every census rule ships its pattern in prose, so
// this class of false positive was guaranteed to arrive — a gate that fires on
// correct content is worse than no gate, because the first fix anyone reaches
// for is to delete the gate.
//
// Replacing with newlines rather than deleting keeps byte offsets stable, so
// nothing downstream shifts.
const stripCode = (s) =>
  s
    .replace(/```[\s\S]*?```/g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
    .replace(/`[^`\n]*`/g, '');

let linksChecked = 0;
const pendingLinks = [];
for (const f of mdFiles) {
  const src = stripCode(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    let target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    linksChecked++;
    const resolved = path.resolve(path.dirname(f), target);
    if (!fs.existsSync(resolved)) {
      // A link to a golden path that is a REAL spine leaf but is not written
      // yet is a forward reference, not a dead link. The corpus is being built
      // one leaf at a time out of 247, so a composer naming the neighbour that
      // owns a condition is doing exactly what the doctrine asks — and the
      // neighbour may be written next week.
      //
      // Distinguished rather than tolerated: the target must correspond to a
      // slug the spine actually declares. A typo'd or invented filename still
      // fails, which is the case this check exists for.
      const slug = path.basename(target).replace(/\.md$/, '');
      const isPendingLeaf =
        resolved.startsWith(PATHS_DIR) && (slugs.has(slug) || byDoc.has(`${slug}.md`));
      if (isPendingLeaf) {
        pendingLinks.push(`${path.relative(ROOT, f)} -> ${slug} (leaf not written yet)`);
        continue;
      }
      fail(`${path.relative(ROOT, f)} links to "${m[1]}", which does not exist`);
    }
  }
}
if (linksChecked === 0) {
  console.error('FATAL: zero markdown links found across the corpus. THE LINK MATCHER IS BROKEN.');
  process.exit(2);
}

// ------------------------------- 3. every census rule cites a path that exists
const rulesFile = JSON.parse(fs.readFileSync(RULES, 'utf8'));
const rules = rulesFile.rules || rulesFile;
if (!Array.isArray(rules) || rules.length === 0) {
  console.error('FATAL: rules.json yielded no rules. THE PARSER IS BROKEN.');
  process.exit(2);
}
for (const r of rules) {
  if (!r.goldenPath) { fail(`census rule "${r.id}" declares no goldenPath`); continue; }
  if (!fs.existsSync(path.join(ROOT, r.goldenPath))) {
    fail(`census rule "${r.id}" cites goldenPath "${r.goldenPath}", which does not exist`);
  }
}

// ------------------------------------------ 4. golden-path index freshness
// ADVISORY ONLY — this section MUST NOT change the exit code.
//
// Why advisory and not a gate: this checker runs inside the composition wave's
// own loop (`npm run census` is `check-corpus-integrity && run-census`, and the
// runbook has the orchestrator run it after every merged path). A freshness
// failure here would redden that loop mid-wave for a bookkeeping artifact that
// `merge-published-rules.mjs` and `predev`/`prebuild` both regenerate on their
// own. A gate that fires on correct content is worse than no gate, because the
// first fix anyone reaches for is to delete the gate.
//
// PROMOTION CONDITION, so this does not stay advisory by inertia: promote to a
// failing check (add `--check`'s exit code to `failures`) once (a) the wave is
// finished or paused, and (b) the artifacts have survived one full batch
// without a spurious drift report. The one-line change is marked below.
try {
  const INDEX_JSON = path.join(PATHS_DIR, 'index.json');
  const ROUTER_JSON = path.join(PATHS_DIR, 'router.json');
  const missing = [INDEX_JSON, ROUTER_JSON].filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.log(
      `  advisory: golden-path index artifact(s) absent (${missing.map((p) => path.basename(p)).join(', ')}) — ` +
      `run \`node scripts/census/build-golden-path-index.mjs\``,
    );
  } else {
    const gen = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts/census/build-golden-path-index.mjs'), '--check'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    // <-- PROMOTION POINT: `if (gen.status !== 0) fail(...)` instead of logging.
    if (gen.status !== 0) {
      console.log('  advisory: golden-path index is STALE (corpus integrity is unaffected).');
      for (const line of (gen.stderr || '').trim().split('\n')) if (line) console.log(`    ${line}`);
    }
  }
} catch (err) {
  // Never let the advisory take the checker down with it.
  console.log(`  advisory: golden-path index freshness not checked (${err.message})`);
}

// ---------------------------------------------------------------- report
console.log(
  `corpus: ${pathFiles.length - Object.keys(NOT_A_PATH).length} paths / ${leaves.length} leaves ` +
  `(${written.size} written, ${leaves.length - written.size} remaining) · ` +
  `${linksChecked} links · ${rules.length} census rules`,
);

if (failures.length) {
  console.error(`\ncorpus integrity FAILED — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
if (pendingLinks.length) {
  // Printed, never silent. A tolerated exception that nobody can see is how an
  // allowlist becomes the bug — and these resolve themselves as leaves land.
  console.log(
    `  ${pendingLinks.length} forward reference(s) to spine leaves not yet written:`,
  );
  for (const l of pendingLinks) console.log(`    - ${l}`);
}
console.log('corpus integrity OK');
