#!/usr/bin/env node
/**
 * i18n-agent-prep.mjs
 *
 * Prepares input files for subagent-based translation.
 * Writes `.planning/i18n/missing-en.json` — union of keys missing from any
 * of the 12 target locales, with English values. Subagents consume this file
 * and write `translated-{lang}.json` outputs which are later merged.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const I18N_DIR = resolve(ROOT, 'src/i18n');
const EN_PATH = resolve(I18N_DIR, 'en.ts');
const OUT_DIR = resolve(ROOT, '.planning/i18n');

const TARGET_LANGS = ['ar', 'bn', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];

// --- parser: handles inline objects ---
function parseTs(filePath, collectValues = true) {
  const src = readFileSync(filePath, 'utf-8');
  const map = new Map();
  const stack = [];
  let inExport = false;

  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') ||
        trimmed.startsWith('/*') || trimmed.startsWith('*/')) continue;
    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(trimmed)) inExport = true;
      continue;
    }
    const stripped = trimmed
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
      const afterColon = stripped.slice(stripped.indexOf(':') + 1);
      const hasOpen = afterColon.includes('{');
      const hasClose = afterColon.includes('}');
      if (hasOpen && hasClose) {
        const openIdx = trimmed.indexOf('{');
        const closeIdx = trimmed.lastIndexOf('}');
        const inner = trimmed.slice(openIdx + 1, closeIdx);
        const innerRe = /(?:"([\w$-]+)"|(\w[\w$]*))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = innerRe.exec(inner)) !== null) {
          const ik = m[1] ?? m[2];
          map.set([...stack, key, ik].join('.'), m[3]);
        }
      } else if (hasOpen) {
        stack.push(key);
      } else {
        const vm = trimmed.match(/:\s*"((?:[^"\\]|\\.)*)"/) ||
                   trimmed.match(/:\s*'((?:[^'\\]|\\.)*)'/);
        if (vm) map.set([...stack, key].join('.'), vm[1]);
      }
    }
    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    for (let i = 0; i < closes - opens && stack.length > 0; i++) stack.pop();
    if (stripped === '};' && stack.length === 0) break;
  }
  return map;
}

// --- main ---
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log('Parsing en.ts...');
const enMap = parseTs(EN_PATH);
console.log(`  ${enMap.size} leaf keys in en.ts`);

const missingUnion = new Set();
const missingPerLang = {};
for (const lang of TARGET_LANGS) {
  const path = resolve(I18N_DIR, `${lang}.ts`);
  const existing = existsSync(path) ? parseTs(path) : new Map();
  const missing = [];
  for (const k of enMap.keys()) {
    if (!existing.has(k)) { missing.push(k); missingUnion.add(k); }
  }
  missingPerLang[lang] = missing;
  console.log(`  ${lang}: ${existing.size} existing, ${missing.length} missing`);
}

// Build missing-en.json (union of missing across all languages)
const missingObj = {};
for (const k of missingUnion) missingObj[k] = enMap.get(k);

const outPath = resolve(OUT_DIR, 'missing-en.json');
writeFileSync(outPath, JSON.stringify(missingObj, null, 2), 'utf-8');
console.log(`\nWrote ${outPath}`);
console.log(`  ${Object.keys(missingObj).length} unique missing keys (union across languages)`);

// Also write per-language missing key lists (so agents know what to prioritize)
const perLangPath = resolve(OUT_DIR, 'missing-per-lang.json');
writeFileSync(perLangPath, JSON.stringify(missingPerLang, null, 2), 'utf-8');
console.log(`Wrote ${perLangPath}`);
