#!/usr/bin/env node
/**
 * i18n-agent-merge.mjs
 *
 * Merges translated JSON files from `.planning/i18n/translated-{lang}.json`
 * with existing locale files in `src/i18n/{lang}.ts` and writes complete
 * locale files using the structure-preserving generator.
 *
 * Run AFTER all translation subagents have completed.
 *
 * Usage:
 *   node scripts/i18n-agent-merge.mjs           # merge all 12 languages
 *   node scripts/i18n-agent-merge.mjs --lang de # one language
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const I18N_DIR = resolve(ROOT, 'src/i18n');
const PLANNING = resolve(ROOT, '.planning/i18n');
const EN_PATH = resolve(I18N_DIR, 'en.ts');

const ALL_LANGS = ['ar', 'bn', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];

const args = process.argv.slice(2);
const langArg = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null;
const TARGET_LANGS = langArg ? langArg.split(',').map(s => s.trim()) : ALL_LANGS;

// ---------------------------------------------------------------------------
// .ts parser (handles inline objects)
// ---------------------------------------------------------------------------
function parseTs(filePath, mode = 'map') {
  const src = readFileSync(filePath, 'utf-8');
  const map = new Map();
  const events = [];
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
        // Emit synthetic open for inline object so the generator nests properly
        if (mode === 'events') events.push({ type: 'open', key, path: [...stack, key] });
        let m;
        while ((m = innerRe.exec(inner)) !== null) {
          const ik = m[1] ?? m[2];
          const dotted = [...stack, key, ik].join('.');
          map.set(dotted, m[3]);
          if (mode === 'events') events.push({ type: 'leaf', key: ik, path: [...stack, key, ik] });
        }
        if (mode === 'events') events.push({ type: 'close', key, path: [...stack] });
      } else if (hasOpen) {
        stack.push(key);
        if (mode === 'events') events.push({ type: 'open', key, path: [...stack] });
      } else {
        const vm = trimmed.match(/:\s*"((?:[^"\\]|\\.)*)"/) ||
                   trimmed.match(/:\s*'((?:[^'\\]|\\.)*)'/);
        if (vm) {
          map.set([...stack, key].join('.'), vm[1]);
          if (mode === 'events') events.push({ type: 'leaf', key, path: [...stack, key] });
        }
      }
    }
    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    for (let i = 0; i < closes - opens && stack.length > 0; i++) {
      const ck = stack.pop();
      if (mode === 'events') events.push({ type: 'close', key: ck, path: [...stack] });
    }
    if (stripped === '};' && stack.length === 0) break;
  }
  return mode === 'events' ? events : map;
}

// ---------------------------------------------------------------------------
// TS serializer
// ---------------------------------------------------------------------------
function needsQuotes(key) { return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key); }
function tsKey(key)       { return needsQuotes(key) ? `"${key}"` : key; }
function escapeStr(val) {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function generateLocaleFile(langCode, mergedTranslations, enEvents) {
  const enLeafKeys = new Set();
  for (const e of enEvents) {
    if (e.type === 'leaf') enLeafKeys.add(e.path.join('.'));
  }

  // Group extras by parent path
  const extrasByParent = new Map();
  for (const [dottedKey, val] of mergedTranslations) {
    if (enLeafKeys.has(dottedKey)) continue;
    const parts = dottedKey.split('.');
    if (parts.length < 2) continue;
    const parent = parts.slice(0, -1).join('.');
    const key = parts[parts.length - 1];
    if (!extrasByParent.has(parent)) extrasByParent.set(parent, []);
    extrasByParent.get(parent).push({ key, val, depth: parts.length });
  }

  // Forward pass: which sections have content?
  const hasContent = new Set();
  function markAncestors(parts) {
    for (let i = 1; i <= parts.length; i++) hasContent.add(parts.slice(0, i).join('.'));
  }
  for (const e of enEvents) {
    if (e.type === 'leaf' && mergedTranslations.has(e.path.join('.'))) {
      markAncestors(e.path.slice(0, -1));
    }
  }
  for (const parent of extrasByParent.keys()) {
    if (parent) markAncestors(parent.split('.'));
  }

  // Emit pass
  const lines = [`export const ${langCode} = {`, ''];
  const emittedExtras = new Set();

  for (const event of enEvents) {
    if (event.type === 'open') {
      const dotted = event.path.join('.');
      if (hasContent.has(dotted)) {
        const indent = '  '.repeat(event.path.length);
        lines.push(`${indent}${tsKey(event.key)}: {`);
      }
    } else if (event.type === 'leaf') {
      const dotted = event.path.join('.');
      if (mergedTranslations.has(dotted)) {
        const indent = '  '.repeat(event.path.length);
        lines.push(`${indent}${tsKey(event.key)}: "${escapeStr(mergedTranslations.get(dotted))}",`);
      }
    } else if (event.type === 'close') {
      const dotted = [...event.path, event.key].join('.');
      if (hasContent.has(dotted)) {
        if (extrasByParent.has(dotted) && !emittedExtras.has(dotted)) {
          emittedExtras.add(dotted);
          for (const x of extrasByParent.get(dotted)) {
            const xIndent = '  '.repeat(x.depth);
            lines.push(`${xIndent}${tsKey(x.key)}: "${escapeStr(x.val)}",`);
          }
        }
        const indent = '  '.repeat(event.path.length + 1);
        lines.push(`${indent}},`);
      }
    }
  }
  lines.push('};', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('Parsing en.ts structure...');
const enEvents = parseTs(EN_PATH, 'events');
const enLeafCount = enEvents.filter(e => e.type === 'leaf').length;
console.log(`  ${enLeafCount} leaf keys`);

let okCount = 0;
let skipped = 0;

for (const lang of TARGET_LANGS) {
  const translatedPath = resolve(PLANNING, `translated-${lang}.json`);
  const localePath = resolve(I18N_DIR, `${lang}.ts`);

  if (!existsSync(translatedPath)) {
    console.log(`  ${lang}: SKIP (no ${translatedPath})`);
    skipped++;
    continue;
  }

  // Existing translations from the current locale .ts file
  const existing = existsSync(localePath) ? parseTs(localePath, 'map') : new Map();

  // Newly translated entries from agent output
  const translated = JSON.parse(readFileSync(translatedPath, 'utf-8'));
  const newMap = new Map(Object.entries(translated));

  // Merge: existing first, then translated. Existing wins for keys that already
  // had a human-curated translation; agent translations fill the gaps.
  const merged = new Map([...existing, ...newMap]);

  // For keys that existed in BOTH (existing locale + translated agent output),
  // keep the existing one (it's likely human-curated).
  for (const [k, v] of existing) merged.set(k, v);

  const newKeysAdded = [...newMap.keys()].filter(k => !existing.has(k)).length;

  const tsContent = generateLocaleFile(lang, merged, enEvents);
  writeFileSync(localePath, tsContent, 'utf-8');
  console.log(`  ${lang}: wrote ${merged.size} keys (+${newKeysAdded} new) → ${localePath}`);
  okCount++;
}

console.log(`\nDone. Wrote ${okCount} locales, skipped ${skipped}.`);
console.log('Verify with:');
console.log('  node scripts/check-locale-parity.mjs');
console.log('  npx tsc --noEmit');
