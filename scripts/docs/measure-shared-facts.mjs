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

const facts = {
  measuredAt: new Date().toISOString().slice(0, 10),
  commit: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(),
  note:
    'Shared facts, measured once, comments excluded. Golden-path composers MUST ' +
    'cite these rather than re-deriving: wave 1 produced four different command ' +
    'counts, three of which seeded floor assertions. "files" = files containing ' +
    'at least one hit; "hits" = occurrences.',
  rust: {
    files: rs.length,
    // Attribute counts use countAttr (line must BEGIN with the attribute), not
    // a substring match — see the note above countAttr. The previous substring
    // count reported 1,666 here by counting five string literals in this repo's
    // own checkers as if they were commands.
    tauriCommands: countAttr(rs, '#[tauri::command').hits,
    requiresPrivileged: countAttr(rs, '#[requires(privileged)]').hits,
    requiresCloud: countAttr(rs, '#[requires(cloud)]').hits,
    requiresAuth: countAttr(rs, '#[requires(auth)]').hits,
  },
  frontend: {
    tsxFiles: tsx.length,
    tsFiles: ts.length,
    // \b, not [\s>]: this scans LINE BY LINE (to skip comments), and in
    // multi-line JSX the character after the tag is a newline the line scan
    // cannot see. `[\s>]` silently under-counted 1,119 files as 167.
    rawButtonFiles: count(tsx, /<button\b/g).files,
    rawSelectFiles: count(tsx, /<select\b/g).files,
    rawInputFiles: count(tsx, /<input\b/g).files,
    rawTableFiles: count(tsx, /<table\b/g).files,
    animateSpinFiles: count(tsx, /animate-spin/g).files,
    animatePulseFiles: count(tsx, /animate-pulse/g).files,
    webStorageFiles: count(ts, /\b(localStorage|sessionStorage)\b/g).files,
    setIntervalFiles: count(ts, /\bsetInterval\(/g).files,
  },
  lint: lintBaseline(),
};

fs.writeFileSync(
  path.join(ROOT, 'docs/concepts/shared-facts.json'),
  JSON.stringify(facts, null, 2) + '\n',
);
console.log(JSON.stringify(facts, null, 2));
