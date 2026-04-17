#!/usr/bin/env node
// Second pass: promote dominant typography to `text-primary` so section
// headings read as hierarchy instead of body text.
//
// Two heuristics — both safe because they target explicit heading signals:
//
//   1. Any className string containing BOTH `uppercase` AND `tracking-wider`
//      is a small-caps section kicker — `text-foreground` -> `text-primary`
//      inside that string.
//
//   2. Any `<h2>` or `<h3>` tag with `text-foreground` in its className is a
//      structural heading — promote to `text-primary`.
//
// Body text stays black/white (`text-foreground`). H1 page titles are already
// handled by the shared `ContentHeader` component.
//
// Idempotent.

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', 'src', 'features', 'plugins', 'dev-tools');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) yield* walk(path);
    else if (st.isFile() && (name.endsWith('.tsx') || name.endsWith('.ts'))) yield path;
  }
}

// --- Pass 1: uppercase + tracking-wider kickers ----------------------------

const CLASS_STRING = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

// --- Pass 2: <h2>/<h3> heading tags ---------------------------------------

// Match <h2 ...> or <h3 ...> across lines (multiline for JSX that breaks
// attributes over several lines). We capture the attribute block so we can
// replace `text-foreground` -> `text-primary` inside it without affecting
// the element's children.
const HEADING_TAG = /<h([23])\b([^>]*)>/g;

let totalFiles = 0;
let kickerHits = 0;
let headingHits = 0;
const perFile = [];

for (const path of walk(ROOT)) {
  const original = readFileSync(path, 'utf8');
  let fileHits = 0;

  // Pass 1
  let updated = original.replace(CLASS_STRING, (full, doubleQuoted, backtickQuoted) => {
    const body = doubleQuoted ?? backtickQuoted ?? '';
    if (!body.includes('uppercase')) return full;
    if (!body.includes('tracking-wider')) return full;
    if (!body.includes('text-foreground')) return full;
    const swapped = body.replace(/\btext-foreground\b/, () => {
      fileHits++;
      kickerHits++;
      return 'text-primary';
    });
    if (doubleQuoted !== undefined) return `className="${swapped}"`;
    return 'className={`' + swapped + '`}';
  });

  // Pass 2 — only inside <h2>/<h3> opening tags
  updated = updated.replace(HEADING_TAG, (full, level, attrs) => {
    if (!attrs.includes('text-foreground')) return full;
    const swapped = attrs.replace(/\btext-foreground\b/, () => {
      fileHits++;
      headingHits++;
      return 'text-primary';
    });
    return `<h${level}${swapped}>`;
  });

  if (fileHits > 0) {
    writeFileSync(path, updated, 'utf8');
    perFile.push({ path: path.replace(ROOT + '\\', '').replace(ROOT + '/', ''), hits: fileHits });
    totalFiles++;
  }
}

console.log(`Promoted ${kickerHits} kickers + ${headingHits} headings = ${kickerHits + headingHits} total across ${totalFiles} files:`);
for (const row of perFile.sort((a, b) => b.hits - a.hits)) {
  console.log(`  ${String(row.hits).padStart(3)}  ${row.path}`);
}
