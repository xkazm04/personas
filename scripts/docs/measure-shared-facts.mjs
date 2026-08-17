// Measures the shared facts every golden-path composer needs, ONCE.
//
// Wave 1: four composers each counted the Tauri command total and produced
// 1,649 / 1,657 / 1,661 / 1,666. None was right (1,673), and three seeded §9
// floor assertions from their own wrong number.
//
// Counts CODE only. A naive regex over whole files also counts the pattern
// inside comments and test strings — verified: 15 of 258 `#[requires(...)]`
// hits in src-tauri/src are prose mentioning the attribute, including
// `let _ = &state; // required by #[requires(privileged)] session guard`.
// A facts file that over-counts is worse than none, because everything
// downstream cites it. NOTE: match per line with , not [s>] — in
// multi-line JSX the character after the tag is a newline the line-scan cannot see.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Derived, not hardcoded — see scripts/census/check-corpus-integrity.mjs.
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const walk = (d, ext, acc = []) => {
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (['node_modules', 'target', '.git', 'worktrees', 'dist'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, ext, acc);
    else if (ext.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
};

const isComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

// Counting a Rust ATTRIBUTE means the line must BEGIN with it. Filtering
// comments is not enough, and this file learned that the expensive way:
//
// Wave 1 published 1,666 Tauri commands as the "authoritative" correction to
// four composers' four wrong numbers. It was also wrong. A raw grep finds
// 1,673; 7 are comments (which this script already excluded) and 5 more are
// STRING LITERALS inside the repo's own command-checkers —
// context_fingerprint.rs:184,:614 and lib.rs:3858,:3874,:3957 all contain
// "#[tauri::command]" as data because they are the code that counts commands.
// The measurement instrument was counting itself. The true figure is 1,661
// attribute sites (1,658 unique fns; 3 names are #[cfg]-gated duplicates).
//
// Three consecutive waves published a wrong number for the single most-cited
// fact in the corpus, each correcting the last and each still wrong. A
// substring match answers "does this text appear", never "is this a thing".
const countAttr = (files, attr) => {
  let hits = 0;
  let inFiles = 0;
  for (const f of files) {
    let n = 0;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (isComment(line)) continue;
      if (line.trim().startsWith(attr)) n += 1;
    }
    if (n) { hits += n; inFiles++; }
  }
  return { hits, files: inFiles };
};

const count = (files, re) => {
  let hits = 0;
  let inFiles = 0;
  for (const f of files) {
    let n = 0;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (isComment(line)) continue;
      const m = line.match(re);
      if (m) n += m.length;
    }
    if (n) { hits += n; inFiles++; }
  }
  return { hits, files: inFiles };
};

const rs = walk(path.join(ROOT, 'src-tauri'), ['.rs']);
const tsx = walk(path.join(ROOT, 'src'), ['.tsx']);
const ts = walk(path.join(ROOT, 'src'), ['.ts', '.tsx']);

// The lint baseline belongs here for the same reason the command count does:
// five golden paths cited CLAUDE.md's "~10,086 warnings" as the REASON to ship a
// gate at "error". Measured 2026-08-14: 1,135. Wrong by ~9x, and wrong about the
// dominator (the whole no-raw-* family is 144, not "almost entirely"). It went
// stale when no-raw-spacing-classes was disabled and nobody re-ran it.
//
// Note what this number does NOT decide. `npm run check` runs `eslint src/` with
// no --max-warnings, and the pre-commit hook runs --quiet --max-warnings 99999.
// Warnings fail NEITHER gate at ANY count, so "warn is invisible because there
// are so many" was never the real argument -- warn enforces nothing regardless.
// Cite this to describe the tree, not to justify a severity.
const lintBaseline = () => {
  try {
    const raw = execSync('npx eslint src --ext .ts,.tsx -f json', {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const results = JSON.parse(raw);
    let warnings = 0, errors = 0, filesWithFindings = 0;
    const byRule = {};
    for (const f of results) {
      if (f.warningCount || f.errorCount) filesWithFindings++;
      warnings += f.warningCount;
      errors += f.errorCount;
      for (const m of f.messages) byRule[m.ruleId] = (byRule[m.ruleId] ?? 0) + 1;
    }
    // A zero here means eslint failed to run, not that the tree is clean. Say so
    // rather than emitting a triumphant 0 that everything downstream would cite.
    if (!results.length) return { error: 'eslint produced no results — treat as UNMEASURED, not clean' };
    return {
      warnings, errors, filesWithFindings, filesLinted: results.length,
      topRules: Object.fromEntries(
        Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 6),
      ),
    };
  } catch (e) {
    return { error: `eslint did not complete: ${String(e.message).slice(0, 120)}` };
  }
};

// ─────────────────────────────────────────────────────────── schema v2
//
// The file this writes is a LEDGER, not a snapshot. v1 was a bare tree of
// numbers, and a bare number cannot say how it was obtained — which is exactly
// the gap that let the Tauri-command count be published wrong three times in a
// row, each correction confident and each still wrong. In v2 every fact carries
// the INSTRUMENT that reproduces it, so the contract can be "re-verify, never
// re-derive" rather than "trust the number".
//
// This script therefore MERGES rather than overwrites. It owns the verify:cheap
// facts below and nothing else: `lineage`, `spineLabels`, `meta`, and any
// hand-added fact it does not measure are read from disk and written back
// untouched. Before this change the script would have silently flattened all of
// them back to v1 on its next run — a generator that destroys the hand-written
// half of the artifact it maintains.
const CHEAP = [
  ['rust.files', rs.length,
    "walk of src-tauri/ for .rs; node_modules, target, .git, worktrees, dist excluded"],
  // Attribute counts use countAttr (line must BEGIN with the attribute), not a
  // substring match — see the note above countAttr. The previous substring count
  // reported 1,666 by counting five string literals in this repo's own checkers.
  ['rust.tauriCommands', countAttr(rs, '#[tauri::command').hits,
    "countAttr(): src-tauri/**/*.rs lines whose TRIMMED text BEGINS with `#[tauri::command`, comment lines excluded"],
  ['rust.requiresPrivileged', countAttr(rs, '#[requires(privileged)]').hits,
    "countAttr(): src-tauri/**/*.rs lines whose TRIMMED text BEGINS with `#[requires(privileged)]`, comment lines excluded"],
  ['rust.requiresCloud', countAttr(rs, '#[requires(cloud)]').hits,
    "countAttr(): src-tauri/**/*.rs lines whose TRIMMED text BEGINS with `#[requires(cloud)]`, comment lines excluded"],
  ['rust.requiresAuth', countAttr(rs, '#[requires(auth)]').hits,
    "countAttr(): src-tauri/**/*.rs lines whose TRIMMED text BEGINS with `#[requires(auth)]`, comment lines excluded"],
  ['frontend.tsxFiles', tsx.length,
    "walk of src/ for .tsx; node_modules, target, .git, worktrees, dist excluded"],
  ['frontend.tsFiles', ts.length,
    "walk of src/ for .ts + .tsx; node_modules, target, .git, worktrees, dist excluded"],
  // \b, not [\s>]: this scans LINE BY LINE (to skip comments), and in multi-line
  // JSX the character after the tag is a newline the line scan cannot see.
  // `[\s>]` silently under-counted 1,119 files as 167.
  ['frontend.rawButtonFiles', count(tsx, /<button\b/g).files,
    "count(): src/**/*.tsx lines matching /<button\\b/g, comment-only lines excluded; reports FILES with >=1 hit"],
  ['frontend.rawSelectFiles', count(tsx, /<select\b/g).files,
    "count(): src/**/*.tsx lines matching /<select\\b/g, comment-only lines excluded; reports FILES with >=1 hit"],
  ['frontend.rawInputFiles', count(tsx, /<input\b/g).files,
    "count(): src/**/*.tsx lines matching /<input\\b/g, comment-only lines excluded; reports FILES with >=1 hit"],
  ['frontend.rawTableFiles', count(tsx, /<table\b/g).files,
    "count(): src/**/*.tsx lines matching /<table\\b/g, comment-only lines excluded; reports FILES with >=1 hit"],
  ['frontend.animateSpinFiles', count(tsx, /animate-spin/g).files,
    "count(): src/**/*.tsx lines matching /animate-spin/g, comment-only lines excluded; reports FILES with >=1 hit"],
  ['frontend.animatePulseFiles', count(tsx, /animate-pulse/g).files,
    "count(): src/**/*.tsx lines matching /animate-pulse/g, comment-only lines excluded; reports FILES with >=1 hit"],
  ['frontend.webStorageFiles', count(ts, /\b(localStorage|sessionStorage)\b/g).files,
    "count(): src/**/*.{ts,tsx} lines matching /\\b(localStorage|sessionStorage)\\b/g, comment-only lines excluded; reports FILES with >=1 hit"],
  ['frontend.setIntervalFiles', count(ts, /\bsetInterval\(/g).files,
    "count(): src/**/*.{ts,tsx} lines matching /\\bsetInterval\\(/g, comment-only lines excluded; reports FILES with >=1 hit"],
];

const OUT = path.join(ROOT, 'docs/concepts/shared-facts.json');
const today = new Date().toISOString().slice(0, 10);
const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();

let existing = {};
try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }
if (existing.meta?.schema !== 2) {
  // A v1 file on disk is not merged into — it has no instruments to preserve
  // and no lineage/spineLabels to protect. Say so rather than silently
  // discarding half a file nobody realised was there.
  console.warn('note: shared-facts.json on disk is not schema 2; writing a fresh v2 skeleton.');
}
const out = {
  meta: existing.meta ?? { schema: 2, note: 'Shared facts. Cite by id; re-verify with the instrument on use, never re-derive.' },
  facts: { ...(existing.facts ?? {}) },
  ...(existing.lineage ? { lineage: existing.lineage } : {}),
  ...(existing.spineLabels ? { spineLabels: existing.spineLabels } : {}),
};

const deltas = [];
const upsert = (id, value, instrumentRule, verify = 'cheap') => {
  const prev = out.facts[id];
  const changed = prev && JSON.stringify(prev.value) !== JSON.stringify(value);
  if (changed) deltas.push({ id, from: prev.value, to: value, since: prev.measuredAt });
  out.facts[id] = {
    ...(prev ?? {}),
    value,
    instrument: prev?.instrument ?? `node scripts/docs/measure-shared-facts.mjs -> facts['${id}'] (${instrumentRule})`,
    measuredAt: today,
    commit,
    leaf: prev?.leaf ?? 'measure-shared-facts.mjs',
    verify,
    ...(changed
      ? { note: `${prev.note ? prev.note + ' ' : ''}Was ${JSON.stringify(prev.value)} at ${prev.commit} (${prev.measuredAt}); re-measured ${JSON.stringify(value)} at ${commit} (${today}).` }
      : (prev?.note ? { note: prev.note } : {})),
  };
};

for (const [id, value, rule] of CHEAP) upsert(id, value, rule);

const lint = lintBaseline();
if (lint.error) {
  // A failed eslint run must NOT be written as a zero. Everything downstream
  // would cite the zero as "the tree is clean".
  console.warn(`note: lint facts left UNCHANGED — ${lint.error}`);
} else {
  upsert('lint.warnings', lint.warnings, 'npx eslint src --ext .ts,.tsx -f json -> sum of warningCount');
  upsert('lint.errors', lint.errors, 'npx eslint src --ext .ts,.tsx -f json -> sum of errorCount');
  upsert('lint.filesWithFindings', lint.filesWithFindings, 'npx eslint src --ext .ts,.tsx -f json -> files with warningCount + errorCount > 0');
  upsert('lint.filesLinted', lint.filesLinted, 'npx eslint src --ext .ts,.tsx -f json -> result count');
  upsert('lint.topRules', lint.topRules, 'npx eslint src --ext .ts,.tsx -f json -> messages grouped by ruleId, top 6');
}

// Sorted keys so a no-op run produces a byte-identical file and a real change
// produces a diff that is only the change.
out.facts = Object.fromEntries(Object.keys(out.facts).sort().map((k) => [k, out.facts[k]]));

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

console.log(`shared-facts: ${Object.keys(out.facts).length} facts at ${commit}`);
if (deltas.length === 0) {
  console.log('  no value changed');
} else {
  console.log(`  ${deltas.length} value(s) changed:`);
  for (const d of deltas) {
    console.log(`    ${d.id}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}  (last measured ${d.since})`);
  }
}
if (out.lineage || out.spineLabels) {
  console.log(`  preserved: ${[out.lineage && 'lineage', out.spineLabels && 'spineLabels'].filter(Boolean).join(', ')}`);
}
