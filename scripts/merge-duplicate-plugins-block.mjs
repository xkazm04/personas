#!/usr/bin/env node
/**
 * One-shot fix for a duplicate top-level `plugins: {}` block in en.ts
 * introduced when several parallel agents each appended a new block instead
 * of extending the existing one.
 *
 * Strategy:
 *   1. Parse the file as text.
 *   2. Find all top-level `  plugins: {` openers (2-space indent).
 *   3. For each duplicate, find its matching `  },` closer by tracking braces.
 *   4. Extract the inner body (lines between opener and closer, exclusive).
 *   5. Remove the duplicate block (and the comment banner above it, if any).
 *   6. Append the extracted body to the end of the FIRST plugins block (just
 *      before its closing `  },`).
 *   7. Write result.
 *
 * Run: node scripts/merge-duplicate-plugins-block.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILE = path.join(ROOT, 'src/i18n/en.ts');

const text = readFileSync(FILE, 'utf8');
const lines = text.split('\n');

function findBlockOpeners(lines) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^  plugins:\s*\{/.test(lines[i])) hits.push(i);
  }
  return hits;
}

function findBlockEnd(lines, startIdx) {
  // Starts at the opener line. Count braces from there.
  let level = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (let k = 0; k < line.length; k++) {
      if (line[k] === '{') level++;
      else if (line[k] === '}') {
        level--;
        if (level === 0) return i;
      }
    }
  }
  throw new Error('Unterminated block starting at line ' + (startIdx + 1));
}

const openers = findBlockOpeners(lines);
if (openers.length < 2) {
  console.log(`No duplicate plugins block found (${openers.length} opener(s)). Nothing to do.`);
  process.exit(0);
}

console.log(`Found plugins openers at lines: ${openers.map((i) => i + 1).join(', ')}`);

const firstOpen = openers[0];
const firstClose = findBlockEnd(lines, firstOpen);
console.log(`First block: ${firstOpen + 1}..${firstClose + 1}`);

// Process each additional block (in reverse order so indices don't shift).
const additionals = openers.slice(1).reverse();

let result = [...lines];

for (const openIdx of additionals) {
  const closeIdx = findBlockEnd(result, openIdx);
  console.log(`Merging duplicate block: ${openIdx + 1}..${closeIdx + 1}`);

  // Body lines (contents of the duplicate block, excluding the opener and
  // closer lines themselves).
  const body = result.slice(openIdx + 1, closeIdx);

  // Detect and remove a comment banner immediately above the opener. A
  // banner is 1-3 consecutive comment-only lines, optionally followed by a
  // blank line.
  let bannerStart = openIdx;
  while (bannerStart > 0 && /^\s*\/\//.test(result[bannerStart - 1])) bannerStart--;
  // Also swallow a single blank line above the banner.
  if (bannerStart > 0 && result[bannerStart - 1].trim() === '') bannerStart--;

  // Remove the block (banner through closer line) from `result`.
  result.splice(bannerStart, closeIdx - bannerStart + 1);

  // After removal, the first-block's close index needs to be recomputed
  // because we may have shifted lines above it (no — additional is below
  // first, so firstClose is unchanged). But if we later add a second
  // merge, we should recompute.
}

// Re-find the first plugins block's close (it should still be at firstClose
// because we only removed lines after it).
const firstCloseAfter = findBlockEnd(result, firstOpen);
console.log(`First block close after removals: line ${firstCloseAfter + 1}`);

// Now inject the extracted body just before firstClose. We accumulated body
// lines across all additionals; since we only had 1 additional typically,
// just inject the last-captured body. For simplicity we re-do the capture:
// re-open the ORIGINAL file to find the original bodies.
const origLines = text.split('\n');
const origOpeners = findBlockOpeners(origLines);
const bodies = origOpeners.slice(1).map((openIdx) => {
  const closeIdx = findBlockEnd(origLines, openIdx);
  return origLines.slice(openIdx + 1, closeIdx);
});

// Insert each body just before the first block's close line (in order).
const insertAt = firstCloseAfter;
const insertLines = [
  '',
  '    // --- merged from previously-duplicated top-level plugins block(s) ---',
  ...bodies.flat(),
];
result.splice(insertAt, 0, ...insertLines);

const output = result.join('\n');
writeFileSync(FILE, output);
console.log(`Wrote ${FILE} with ${result.length} lines (was ${lines.length}).`);
