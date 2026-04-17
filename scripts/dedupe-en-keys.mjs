#!/usr/bin/env node
/**
 * Remove duplicate keys from src/i18n/en.ts at specified line numbers.
 * For each line, deletes that line plus any immediately-preceding consecutive
 * comment-only lines (the translator comment block).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DUPLICATE_LINES = [8022, 8028, 8070, 8108, 8110, 8112, 8114, 8116, 8183, 8549, 10235, 10237, 10825];

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILE = path.join(ROOT, 'src/i18n/en.ts');
const lines = readFileSync(FILE, 'utf8').split('\n');

const toDelete = new Set();
for (const n of DUPLICATE_LINES) {
  const idx = n - 1; // 0-based
  toDelete.add(idx);
  // Swallow preceding contiguous comment-only lines
  let j = idx - 1;
  while (j >= 0 && /^\s*\/\//.test(lines[j]) && !toDelete.has(j)) {
    toDelete.add(j);
    j--;
  }
}

const out = lines.filter((_, i) => !toDelete.has(i));
writeFileSync(FILE, out.join('\n'));
console.log(`Deleted ${toDelete.size} lines (${DUPLICATE_LINES.length} duplicate keys + their comment blocks).`);
console.log(`File: ${lines.length} → ${out.length} lines.`);
