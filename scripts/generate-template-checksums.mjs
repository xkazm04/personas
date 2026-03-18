#!/usr/bin/env node
/**
 * Generates src/lib/personas/templateChecksums.ts from template JSON files.
 *
 * Run with:
 *   node scripts/generate-template-checksums.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const TEMPLATES_DIR = join(ROOT, 'scripts', 'templates');
const OUTPUT_FILE = join(ROOT, 'src', 'lib', 'personas', 'templates', 'templateChecksums.ts');

function computeContentHashSync(content) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

function findJsonFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.json')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = findJsonFiles(TEMPLATES_DIR).sort();
const checksums = {};

for (const filePath of files) {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const canonical = JSON.stringify(parsed);
  const rel = relative(TEMPLATES_DIR, filePath).replace(/\\/g, '/');
  checksums[rel] = computeContentHashSync(canonical);
}

const outputLines = [
  '/**',
  ' * Auto-generated template checksums - DO NOT EDIT MANUALLY.',
  ' * Regenerate with: node scripts/generate-template-checksums.mjs',
  ' */',
  '',
  'export const TEMPLATE_CHECKSUMS: Record<string, string> = {',
];

for (const [rel, checksum] of Object.entries(checksums)) {
  outputLines.push(`  '${rel}': '${checksum}',`);
}

outputLines.push('};');
outputLines.push('');

writeFileSync(OUTPUT_FILE, outputLines.join('\n'), 'utf-8');
console.log(`Generated ${OUTPUT_FILE} with ${files.length} checksums`);
