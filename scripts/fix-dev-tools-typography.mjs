#!/usr/bin/env node
// One-shot typography contrast fix for src/features/plugins/dev-tools.
//
// Rules (derived from CLAUDE.md + ESLint `custom/no-low-contrast-text-classes`):
//   1. `text-muted-foreground/N` (any N)    -> `text-foreground`
//   2. `text-muted-foreground`    (bare)    -> `text-foreground`
//   3. `text-foreground/N`        (any N)   -> `text-foreground`
//   4. `text-white/N`             (any N)   -> `text-foreground`
//
// Rationale: muted + opacity-reduced text fades into the background on
// dark/light themes. Base typography should be plain `text-foreground` and
// dominant titles should be promoted to `text-primary` — which is done by
// hand afterwards since the "is this a heading" judgment doesn't reduce to
// a regex.
//
// Idempotent — safe to re-run.
//
// Run:  node scripts/fix-dev-tools-typography.mjs

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', 'src', 'features', 'plugins', 'dev-tools');

/** Recursively walk a directory yielding every `.tsx`/`.ts` path. */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) yield* walk(path);
    else if (st.isFile() && (name.endsWith('.tsx') || name.endsWith('.ts'))) yield path;
  }
}

const RULES = [
  // Handle suffixed opacity variants first so the bare rule doesn't eat the
  // prefix and leave `/40` dangling.
  { from: /\btext-muted-foreground\/\d+\b/g, to: 'text-foreground' },
  { from: /\btext-muted-foreground\b/g,      to: 'text-foreground' },
  { from: /\btext-foreground\/\d+\b/g,       to: 'text-foreground' },
  { from: /\btext-white\/\d+\b/g,            to: 'text-foreground' },
  // `placeholder:text-muted-foreground` also shows up — the leading modifier
  // needs the same treatment. Ordering matters: the colon prefix is preserved
  // because our regex only matches the `text-*` token.
];

let totalFiles = 0;
let totalReplacements = 0;
const perFile = [];

for (const path of walk(ROOT)) {
  const original = readFileSync(path, 'utf8');
  let current = original;
  let fileHits = 0;
  for (const rule of RULES) {
    current = current.replace(rule.from, () => {
      fileHits++;
      totalReplacements++;
      return rule.to;
    });
  }
  if (fileHits > 0) {
    writeFileSync(path, current, 'utf8');
    perFile.push({ path: path.replace(ROOT + '\\', '').replace(ROOT + '/', ''), hits: fileHits });
    totalFiles++;
  }
}

console.log(`Replaced ${totalReplacements} occurrences across ${totalFiles} files:`);
for (const row of perFile.sort((a, b) => b.hits - a.hits)) {
  console.log(`  ${String(row.hits).padStart(3)}  ${row.path}`);
}
