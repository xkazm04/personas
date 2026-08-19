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

// --------------------- 3.5 subject hierarchy (docs/concepts/paths/) — GRAPH.md
// Enforces the v2 layer contract, section by section of docs/concepts/paths/GRAPH.md
// §6. The layer boundary was the one ungated invariant in v1 and it flattened; this
// block is the gate the plan (knowledge-hierarchy-plan.md §5) requires.
//
// What this CANNOT check, stated rather than implied by a green exit: the live
// transplant test — handing a Golden Path to an agent in a sibling repo with no access
// to this one. Only that test promotes `status:` to `transplant-tested`; the purity
// denylist below is a static floor, not the test.
const HIER_DIR = path.join(CONCEPTS, 'paths');
const hierStats = { subjects: 0, categories: 0, techniques: 0, applications: 0, mapped: 0 };
if (fs.existsSync(HIER_DIR)) {
  // Minimal YAML-subset frontmatter parser: scalars, `- item` lists, inline [a, b],
  // trailing ` # comment` stripped. Anything fancier than that in a frontmatter block
  // is a contract violation anyway.
  const parseFrontmatter = (raw) => {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return null;
    const fm = {};
    let currentKey = null;
    for (const line of m[1].split(/\r?\n/)) {
      const item = line.match(/^\s+-\s+(.*)$/);
      if (item && currentKey) {
        fm[currentKey].push(item[1].replace(/\s+#.*$/, '').trim());
        continue;
      }
      const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, valRaw] = kv;
      const val = valRaw.replace(/\s+#.*$/, '').trim();
      if (val === '' ) { fm[key] = []; currentKey = key; }
      else if (val === '[]') { fm[key] = []; currentKey = null; }
      else if (val.startsWith('[')) {
        fm[key] = val.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
        currentKey = null;
      } else { fm[key] = val; currentKey = null; }
    }
    return { fm, body: raw.slice(m[0].length) };
  };

  const STATUSES = new Set(['draft', 'forged', 'reconciled', 'transplant-tested']);
  const STACKS = new Set(['react', 'rust', 'sql', 'node', 'process']);

  // Layer purity (GRAPH.md §5): golden-path and technique bodies carry zero repo
  // identifiers or stack names. Frontmatter is exempt (evidence lives there on
  // purpose); Application bodies are exempt (citing real code is their job).
  // This list is a FLOOR — extend it when a leak slips past; never narrow it to
  // make a document pass.
  const PURITY = [
    [/\b(?:src|src-tauri|scripts|docs)\//, 'repo path'],
    [/\.(?:tsx?|rs|mjs|cjs|jsx)\b/, 'source-file extension'],
    [/\b(?:React|Tauri|Rust|TypeScript|JavaScript|Zustand|Tailwind|Vite|Vitest|SQLite|PostgreSQL|Postgres|Personas|UnifiedTable|ESLint|Zod)\b/, 'stack/product identifier'],
  ];

  const lawAnchors = new Set();
  const lawsFile = path.join(HIER_DIR, '_laws.md');
  if (fs.existsSync(lawsFile)) {
    for (const m of fs.readFileSync(lawsFile, 'utf8').matchAll(/<a id="([^"]+)"><\/a>/g)) lawAnchors.add(m[1]);
  }
  if (lawAnchors.size === 0) fail('paths/_laws.md is missing or declares zero law anchors — Techniques cannot cite laws');

  const subjectDirs = fs.readdirSync(HIER_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  hierStats.subjects = subjectDirs.length;

  // categories.json — the graph's top ring (docs/plans/patterns-v2-ui.md D3).
  //
  // Subject frontmatter carries no group, so the graph needs one small external
  // authority for "which spoke does this subject sit on". Gated here rather than
  // left to the reader, because the failure it prevents is silent: a subject with
  // no category simply never renders, and an entry for a deleted subject leaves a
  // spoke pointing at nothing. Both are invisible in the app and obvious here.
  const CATS = path.join(HIER_DIR, 'categories.json');
  if (!fs.existsSync(CATS)) {
    fail('paths/categories.json is missing — every subject needs a graph category (patterns-v2-ui.md D3)');
  } else {
    let cats = null;
    try { cats = JSON.parse(fs.readFileSync(CATS, 'utf8')); }
    catch (err) { fail(`paths/categories.json does not parse: ${err.message}`); }
    if (cats) {
      const ids = new Set((cats.categories ?? []).map((c) => c.id));
      if (ids.size === 0) fail('paths/categories.json declares zero categories');
      const orders = (cats.categories ?? []).map((c) => c.order);
      if (new Set(orders).size !== orders.length) {
        fail('paths/categories.json: duplicate category order values — order is the compass sequence and must be unique');
      }
      const assigned = cats.subjects ?? {};
      for (const [slug, cat] of Object.entries(assigned)) {
        if (!subjectDirs.includes(slug)) fail(`categories.json assigns "${slug}", which has no paths/${slug}/ folder`);
        if (!ids.has(cat)) fail(`categories.json assigns "${slug}" to unknown category "${cat}"`);
      }
      for (const slug of subjectDirs) {
        if (!(slug in assigned)) fail(`paths/${slug}/ has no entry in categories.json — it would not appear in the graph`);
      }
      hierStats.categories = ids.size;
    }
  }

  const readNode = (file, expect) => {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = parseFrontmatter(raw);
    const rel = path.relative(ROOT, file);
    if (!parsed) { fail(`${rel}: missing frontmatter block`); return null; }
    const { fm, body } = parsed;
    if (fm.layer !== expect) fail(`${rel}: layer "${fm.layer}" but location says "${expect}"`);
    if (fm.status && !STATUSES.has(fm.status)) fail(`${rel}: unknown status "${fm.status}"`);
    if (expect === 'golden-path' || expect === 'technique') {
      for (const [re, what] of PURITY) {
        const hit = body.match(re);
        if (hit) fail(`${rel}: body purity — contains ${what} "${hit[0]}" (transplant test forbids it in this layer; move it to an Application or to evidence: frontmatter)`);
      }
    }
    return fm;
  };

  for (const slug of subjectDirs) {
    const dir = path.join(HIER_DIR, slug);
    const gpFile = path.join(dir, `${slug}.md`);
    if (!fs.existsSync(gpFile)) { fail(`paths/${slug}/ has no ${slug}.md golden path`); continue; }
    const gp = readNode(gpFile, 'golden-path');
    if (!gp) continue;
    if (gp.subject !== slug) fail(`paths/${slug}/${slug}.md: subject "${gp.subject}" ≠ folder "${slug}"`);

    const evidence = Array.isArray(gp.evidence) ? gp.evidence : [];
    if (evidence.length === 0) fail(`paths/${slug}/${slug}.md: zero evidence links — a standard with no witness`);
    for (const ev of [...evidence, ...(Array.isArray(gp.counter_evidence) ? gp.counter_evidence : [])]) {
      if (!fs.existsSync(path.join(ROOT, ev))) fail(`paths/${slug}/${slug}.md: evidence "${ev}" does not exist`);
    }

    // techniques: frontmatter list ↔ files on disk, identical sets. Entries with an
    // @owner suffix (e.g. pagination@table) reference another subject's technique
    // (GRAPH.md §3) and must resolve THERE and not exist locally.
    const techDir = path.join(dir, 'techniques');
    const onDisk = new Set(fs.existsSync(techDir) ? fs.readdirSync(techDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : []);
    const declared = Array.isArray(gp.techniques) ? gp.techniques : [];
    const declaredLocal = new Set();
    for (const t of declared) {
      const shared = t.match(/^([a-z0-9-]+)@([a-z0-9-]+)$/);
      if (shared) {
        const [, tech, owner] = shared;
        if (!fs.existsSync(path.join(HIER_DIR, owner, 'techniques', `${tech}.md`))) {
          fail(`paths/${slug}/${slug}.md: shared technique "${t}" — no paths/${owner}/techniques/${tech}.md`);
        }
        if (onDisk.has(tech)) fail(`paths/${slug}/${slug}.md: "${t}" declared shared but paths/${slug}/techniques/${tech}.md also exists locally — one owner (GRAPH.md §3)`);
        continue;
      }
      declaredLocal.add(t);
      if (!onDisk.has(t)) fail(`paths/${slug}/${slug}.md: declares technique "${t}" but paths/${slug}/techniques/${t}.md does not exist`);
    }
    for (const t of onDisk) {
      if (!declaredLocal.has(t)) fail(`paths/${slug}/techniques/${t}.md exists but ${slug}.md does not declare it — links must hold in both directions`);
    }
    hierStats.techniques += onDisk.size;

    for (const t of onDisk) {
      const fm = readNode(path.join(techDir, `${t}.md`), 'technique');
      if (!fm) continue;
      if (fm.subject !== slug) fail(`paths/${slug}/techniques/${t}.md: subject "${fm.subject}" ≠ "${slug}"`);
      if (fm.technique !== t) fail(`paths/${slug}/techniques/${t}.md: technique "${fm.technique}" ≠ filename "${t}"`);
      for (const law of Array.isArray(fm.laws) ? fm.laws : []) {
        if (!lawAnchors.has(law)) fail(`paths/${slug}/techniques/${t}.md: cites unknown law "${law}"`);
      }
      for (const sw of Array.isArray(fm.shared_with) ? fm.shared_with : []) {
        if (!subjectDirs.includes(sw)) fail(`paths/${slug}/techniques/${t}.md: shared_with "${sw}" is not a subject`);
      }
    }

    const appDir = path.join(dir, 'applications');
    if (fs.existsSync(appDir)) {
      for (const f of fs.readdirSync(appDir).filter((f) => f.endsWith('.md'))) {
        const fm = readNode(path.join(appDir, f), 'application');
        hierStats.applications++;
        if (!fm) continue;
        if (fm.subject !== slug) fail(`paths/${slug}/applications/${f}: subject "${fm.subject}" ≠ "${slug}"`);
        if (!STACKS.has(fm.stack)) fail(`paths/${slug}/applications/${f}: unknown stack "${fm.stack}"`);
        if (!onDisk.has(fm.technique)) fail(`paths/${slug}/applications/${f}: technique "${fm.technique}" not in paths/${slug}/techniques/`);
        const expectName = `${fm.stack}--${fm.technique}.md`;
        if (f !== expectName) fail(`paths/${slug}/applications/${f}: filename should be "${expectName}" (GRAPH.md §7)`);
      }
    }
  }

  // corpus-map.json: upward links for the legacy 247 without editing them.
  const mapFile = path.join(HIER_DIR, 'corpus-map.json');
  if (!fs.existsSync(mapFile)) fail('paths/corpus-map.json is missing — the legacy corpus has no upward-link surface');
  else {
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const entries = map.entries || {};
    for (const [legacyFile, target] of Object.entries(entries)) {
      if (!fs.existsSync(path.join(PATHS_DIR, legacyFile))) fail(`corpus-map.json maps "${legacyFile}", which does not exist in golden-paths/`);
      const subj = typeof target === 'string' ? target : target.subject;
      if (!subjectDirs.includes(subj)) fail(`corpus-map.json maps "${legacyFile}" → subject "${subj}", which has no paths/${subj}/ folder`);
    }
    hierStats.mapped = Object.keys(entries).length;
    if (map.complete === true) {
      for (const f of pathFiles) {
        if (!NOT_A_PATH[f] && !entries[f]) fail(`corpus-map.json declares complete:true but "${f}" is unmapped`);
      }
    }
  }

  if (subjectDirs.length === 0) {
    console.log('  hierarchy: paths/ exists but holds no subjects yet — contract checks idle (loud, not silent).');
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
if (fs.existsSync(HIER_DIR)) {
  console.log(
    `hierarchy: ${hierStats.subjects} subjects (${hierStats.categories} categories) · ${hierStats.techniques} techniques · ` +
    `${hierStats.applications} applications · ${hierStats.mapped}/${pathFiles.length - Object.keys(NOT_A_PATH).length} legacy mapped · ` +
    'NOT checked statically: the live transplant test (GRAPH.md §5) — only it promotes status to transplant-tested',
  );
}

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
