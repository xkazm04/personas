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

const ROOT = 'C:/Users/mkdol/dolla/personas';

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
    tauriCommands: count(rs, /#\[tauri::command/g).hits,
    requiresPrivileged: count(rs, /#\[requires\(privileged\)\]/g).hits,
    requiresCloud: count(rs, /#\[requires\(cloud\)\]/g).hits,
    requiresAuth: count(rs, /#\[requires\(auth\)\]/g).hits,
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
};

fs.writeFileSync(
  path.join(ROOT, 'docs/concepts/shared-facts.json'),
  JSON.stringify(facts, null, 2) + '\n',
);
console.log(JSON.stringify(facts, null, 2));
