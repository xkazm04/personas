#!/usr/bin/env node
/**
 * check-granularity — audit the exported context map against the 10-30
 * files-per-context band (docs: the 2026-08 map converged at 769 contexts
 * averaging 5.4 files because the scan prompt asked for 5-15; the band is now
 * a hard rule in the scan prompts and this script is the repo-side audit).
 *
 * Reads context-map.json at the repo root (the app rewrites it after every
 * context scan). Advisory by default; --strict exits 1 when fewer than
 * MIN_IN_BAND_RATIO of contexts sit inside the band.
 *
 * Usage: node scripts/context/check-granularity.mjs [--strict] [--top N]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// 10-30 is the target band; consolidation may pack up to 34 (absorbing a tiny
// sibling beats leaving crumbs), so ≤34 counts as in-band here.
const BAND = { min: 10, max: 34 };
const MIN_IN_BAND_RATIO = 0.7;
const strict = process.argv.includes('--strict');
const topN = Number(process.argv[process.argv.indexOf('--top') + 1]) || 10;

const map = JSON.parse(readFileSync(join(REPO, 'context-map.json'), 'utf8'));
const contexts = map.contexts ?? [];
const sized = contexts.map((c) => ({ name: c.name, group: c.group, n: (c.file_paths ?? []).length }));

const under = sized.filter((c) => c.n < BAND.min);
const over = sized.filter((c) => c.n > BAND.max);
const inBand = sized.length - under.length - over.length;
const files = sized.reduce((a, c) => a + c.n, 0);

console.log(`contexts: ${sized.length} | files: ${files} | avg ${(files / Math.max(1, sized.length)).toFixed(1)} files/context`);
console.log(`band ${BAND.min}-${BAND.max}: ${inBand} in (${Math.round((100 * inBand) / Math.max(1, sized.length))}%), ${under.length} under, ${over.length} over`);

if (under.length > 0) {
  console.log(`\nsmallest ${Math.min(topN, under.length)} (merge candidates):`);
  for (const c of under.sort((a, b) => a.n - b.n).slice(0, topN)) {
    console.log(`  ${String(c.n).padStart(3)}  ${c.name}  (${c.group ?? '—'})`);
  }
}
if (over.length > 0) {
  console.log(`\nlargest ${Math.min(topN, over.length)} (split candidates):`);
  for (const c of over.sort((a, b) => b.n - a.n).slice(0, topN)) {
    console.log(`  ${String(c.n).padStart(3)}  ${c.name}  (${c.group ?? '—'})`);
  }
}

const ratio = inBand / Math.max(1, sized.length);
if (strict && ratio < MIN_IN_BAND_RATIO) {
  console.error(`\nFAIL: only ${Math.round(ratio * 100)}% of contexts inside the band (need ${MIN_IN_BAND_RATIO * 100}%). Rescan with the banded prompts or consolidate.`);
  process.exit(1);
}
