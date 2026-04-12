#!/usr/bin/env node
/**
 * Export English + Czech translations to a CSV for translation review.
 *
 * Output columns: key, english, czech
 * Missing Czech values are left blank.
 *
 * Usage:
 *   node scripts/export-i18n-en-cs.mjs [output.csv]
 *
 * Default output: i18n-en-cs.csv in project root.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Load and evaluate a TS locale file as a plain JS object literal.
// The files are structurally simple: `export const <name> = { ... };`
// All values are string literals, nested objects, or arrays of strings, and
// the files contain only `//` line comments. Using `new Function` lets V8 do
// the heavy lifting — it parses comments, trailing commas, template strings,
// and escaped characters natively.
// ---------------------------------------------------------------------------
function loadLocale(filePath, exportName) {
  const src = readFileSync(filePath, 'utf8');
  const marker = `export const ${exportName} =`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`Cannot find "${marker}" in ${filePath}`);
  // Find the opening brace of the object literal.
  const openBrace = src.indexOf('{', start + marker.length);
  if (openBrace === -1) throw new Error(`No opening brace after "${marker}"`);
  // Walk the source forward, tracking brace depth while respecting strings
  // (single, double, backtick) and line/block comments so that braces inside
  // them don't count.
  let depth = 0;
  let i = openBrace;
  const len = src.length;
  let end = -1;
  while (i < len) {
    const ch = src[i];
    const next = src[i + 1];
    // Line comment
    if (ch === '/' && next === '/') {
      const nl = src.indexOf('\n', i + 2);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? len : close + 2;
      continue;
    }
    // Strings — skip until matching unescaped close quote
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < len) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
    i++;
  }
  if (end === -1) throw new Error(`Could not find matching close brace in ${filePath}`);
  const body = src.slice(openBrace, end);
  const fn = new Function(`return (${body});`);
  return fn();
}

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      out[path] = '';
    } else if (typeof value === 'string') {
      out[path] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[path] = String(value);
    } else if (Array.isArray(value)) {
      // Arrays of primitives → join with a separator; arrays of objects →
      // recurse with numeric index.
      if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
        out[path] = value.join(' | ');
      } else {
        value.forEach((item, i) => flatten(item, `${path}[${i}]`, out));
      }
    } else if (typeof value === 'object') {
      flatten(value, path, out);
    }
  }
  return out;
}

function csvEscape(value) {
  if (value === undefined || value === null) return '';
  const s = String(value);
  // Always quote — safer than trying to detect when it's optional.
  return `"${s.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const enPath = resolve(projectRoot, 'src/i18n/en.ts');
const csPath = resolve(projectRoot, 'src/i18n/cs.ts');
const outputPath = resolve(projectRoot, process.argv[2] ?? 'i18n-en-cs.csv');

console.log(`Loading ${enPath}`);
const en = loadLocale(enPath, 'en');
console.log(`Loading ${csPath}`);
const cs = loadLocale(csPath, 'cs');

const enFlat = flatten(en);
const csFlat = flatten(cs);

const keys = Object.keys(enFlat);
console.log(`English keys: ${keys.length}`);
console.log(`Czech keys:   ${Object.keys(csFlat).length}`);

const missing = keys.filter((k) => !(k in csFlat)).length;
const covered = keys.length - missing;
const pct = ((covered / keys.length) * 100).toFixed(1);
console.log(`Czech coverage: ${covered}/${keys.length} (${pct}%)`);

const rows = ['key,english,czech'];
for (const key of keys) {
  const enVal = enFlat[key];
  const csVal = csFlat[key] ?? '';
  rows.push([csvEscape(key), csvEscape(enVal), csvEscape(csVal)].join(','));
}

writeFileSync(outputPath, rows.join('\r\n') + '\r\n', 'utf8');
console.log(`Wrote ${outputPath} (${rows.length - 1} rows)`);
