#!/usr/bin/env node
/**
 * The earlier scripts/merge-duplicate-plugins-block.mjs consolidated the two
 * top-level `plugins:` blocks but it pasted the 2nd block's body as-is, which
 * preserved a duplicate `drive:` subsection inside the merged plugins block.
 * Fix: merge the two `drive:` subsections the same way.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILE = path.join(ROOT, 'src/i18n/en.ts');
const text = readFileSync(FILE, 'utf8');
const lines = text.split('\n');

function findOpeners(lines) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^    drive:\s*\{/.test(lines[i])) hits.push(i);
  }
  return hits;
}

function findBlockEnd(lines, startIdx) {
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

const openers = findOpeners(lines);
if (openers.length < 2) {
  console.log(`No duplicate drive: subsection found (${openers.length} opener). Nothing to do.`);
  process.exit(0);
}

console.log(`drive: subsections at lines: ${openers.map((i) => i + 1).join(', ')}`);

const firstOpen = openers[0];
const firstClose = findBlockEnd(lines, firstOpen);
console.log(`First drive: ${firstOpen + 1}..${firstClose + 1}`);

const secondOpen = openers[1];
const secondClose = findBlockEnd(lines, secondOpen);
console.log(`Second drive: ${secondOpen + 1}..${secondClose + 1}`);

// Extract second body (lines between secondOpen+1 and secondClose-1 inclusive)
const secondBody = lines.slice(secondOpen + 1, secondClose);

// Remove the second block (including opener and closer, and a blank line above if any)
let removeStart = secondOpen;
if (removeStart > 0 && lines[removeStart - 1].trim() === '') removeStart--;
const removeEnd = secondClose; // inclusive
const result = [...lines];
result.splice(removeStart, removeEnd - removeStart + 1);

// Recompute first-close (removing lines above doesn't shift these, removing lines below doesn't either since removeStart > firstClose)
const firstCloseAfter = findBlockEnd(result, firstOpen);

// Insert second body just before the first drive's closing `},`
const insertAt = firstCloseAfter;
const insertLines = [
  '',
  '      // --- merged from duplicated drive: subsection ---',
  ...secondBody,
];
result.splice(insertAt, 0, ...insertLines);

writeFileSync(FILE, result.join('\n'));
console.log(`Wrote ${FILE} with ${result.length} lines (was ${lines.length}).`);
