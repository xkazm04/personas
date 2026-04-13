#!/usr/bin/env node
/**
 * merge-czech.mjs
 *
 * Merges czech.txt (CSV: key,english,czech) translations into src/i18n/cs.ts.
 *
 * Strategy:
 *   1. Parse czech.txt → Map<dottedKey, czechString>
 *   2. Parse existing cs.ts → Map<dottedKey, existingString>
 *   3. Merge (czech.txt wins over existing for non-empty values)
 *   4. Walk en.ts line-by-line to determine section structure & key order
 *   5. Emit a new cs.ts that includes all available Czech translations,
 *      skipping keys/sections with no translation (fallback to English at runtime)
 *   6. Append any keys from merged that are NOT in en.ts (e.g. Czech-only plural
 *      forms like _few, _many) into their nearest parent section
 *
 * Usage:
 *   node scripts/merge-czech.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EN_PATH = resolve(ROOT, 'src/i18n/en.ts');
const CS_PATH = resolve(ROOT, 'src/i18n/cs.ts');
const CZECH_TXT = resolve(ROOT, 'czech.txt');

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields with embedded commas/quotes)
// ---------------------------------------------------------------------------
function parseCSVLine(line) {
  const fields = [];
  let pos = 0;
  while (pos <= line.length) {
    if (pos === line.length) { fields.push(''); break; }
    if (line[pos] === '"') {
      pos++;
      let field = '';
      while (pos < line.length) {
        if (line[pos] === '"' && line[pos + 1] === '"') { field += '"'; pos += 2; }
        else if (line[pos] === '"') { pos++; break; }
        else { field += line[pos++]; }
      }
      fields.push(field);
      if (line[pos] === ',') pos++;
    } else {
      let field = '';
      while (pos < line.length && line[pos] !== ',') field += line[pos++];
      if (pos < line.length) pos++;
      fields.push(field);
    }
  }
  return fields;
}

function parseCzechCSV(filePath) {
  const content = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const map = new Map();
  const lines = content.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    if (fields.length >= 3 && fields[0] && fields[2].trim()) {
      map.set(fields[0], fields[2]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Extract key→value pairs from an existing .ts locale file
// ---------------------------------------------------------------------------
function extractKeyValues(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const map = new Map();
  const stack = [];
  let inExport = false;

  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/')) continue;

    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(trimmed)) inExport = true;
      continue;
    }

    // Detect key: { (section open)
    const stripped = trimmed
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
      const afterColon = stripped.slice(stripped.indexOf(':') + 1);
      if (afterColon.includes('{')) {
        stack.push(key);
      } else {
        // Leaf – extract value
        const valMatch = trimmed.match(/:\s*"((?:[^"\\]|\\.)*)"/) ||
                         trimmed.match(/:\s*'((?:[^'\\]|\\.)*)'/);
        if (valMatch) {
          const fullKey = [...stack, key].join('.');
          map.set(fullKey, valMatch[1]);
        }
      }
    }

    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    for (let i = 0; i < closes - opens && stack.length > 0; i++) stack.pop();
    if (stripped === '};' && stack.length === 0) break;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function needsQuotes(key) {
  return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
}
function tsKey(key) {
  return needsQuotes(key) ? `"${key}"` : key;
}
function escapeStr(val) {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// Set a value in a nested object using dot-notation path
function setNested(obj, parts, val) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

// ---------------------------------------------------------------------------
// Walk en.ts to get ordered list of (type, key, fullPath) events
// ---------------------------------------------------------------------------
function parseEnStructure(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const events = [];  // { type: 'open'|'leaf'|'close', key, path }
  const stack = [];
  let inExport = false;

  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/')) continue;

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
        // Inline object: key: { k1: "v1", k2: "v2", ... },
        // Parse inner key/value pairs from the original (un-stripped) line.
        const openIdx = trimmed.indexOf('{');
        const closeIdx = trimmed.lastIndexOf('}');
        const inner = trimmed.slice(openIdx + 1, closeIdx);
        const innerRe = /(?:"([\w$-]+)"|(\w[\w$]*))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = innerRe.exec(inner)) !== null) {
          const innerKey = m[1] ?? m[2];
          events.push({ type: 'leaf', key: innerKey, path: [...stack, key, innerKey] });
        }
        // Don't push to stack; opens/closes on this line cancel out.
      } else if (hasOpen) {
        stack.push(key);
        events.push({ type: 'open', key, path: [...stack] });
      } else {
        events.push({ type: 'leaf', key, path: [...stack, key] });
      }
    }

    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    for (let i = 0; i < closes - opens && stack.length > 0; i++) {
      const closedKey = stack.pop();
      events.push({ type: 'close', key: closedKey, path: [...stack] });
    }

    if (stripped === '};' && stack.length === 0) break;
  }
  return events;
}

// ---------------------------------------------------------------------------
// Generate cs.ts output (two-pass: compute non-empty sections, then emit)
// Extras (translations not in en.ts) are emitted inline at the right depth,
// before the matching section-close they belong to.
// ---------------------------------------------------------------------------
function generateLocale(events, translations, langCode = 'cs') {
  // Build set of en.ts leaf keys
  const enLeafKeys = new Set();
  for (const e of events) {
    if (e.type === 'leaf') enLeafKeys.add(e.path.join('.'));
  }

  // Group extras by parent dotted-path
  const extrasByParent = new Map(); // parent → [{ key, val, depth }]
  for (const [dottedKey, val] of translations) {
    if (enLeafKeys.has(dottedKey)) continue;
    const parts = dottedKey.split('.');
    if (parts.length < 2) continue;
    const parent = parts.slice(0, -1).join('.');
    const key = parts[parts.length - 1];
    if (!extrasByParent.has(parent)) extrasByParent.set(parent, []);
    extrasByParent.get(parent).push({ key, val, depth: parts.length });
  }

  // Forward pass: determine which sections (full dotted path) have any content
  // A section has content if any descendant leaf is translated OR has an extra.
  const hasContent = new Set();
  function markAncestors(parts) {
    for (let i = 1; i <= parts.length; i++) {
      hasContent.add(parts.slice(0, i).join('.'));
    }
  }
  for (const e of events) {
    if (e.type === 'leaf' && translations.has(e.path.join('.'))) {
      markAncestors(e.path.slice(0, -1)); // ancestor sections
    }
  }
  for (const parent of extrasByParent.keys()) {
    if (parent) markAncestors(parent.split('.'));
  }

  // Emit pass
  const lines = [`export const ${langCode} = {`, ''];
  const emittedExtras = new Set();

  for (const event of events) {
    if (event.type === 'open') {
      const dotted = event.path.join('.');
      if (hasContent.has(dotted)) {
        const indent = '  '.repeat(event.path.length);
        lines.push(`${indent}${tsKey(event.key)}: {`);
      }
    } else if (event.type === 'leaf') {
      const dotted = event.path.join('.');
      if (translations.has(dotted)) {
        const indent = '  '.repeat(event.path.length);
        lines.push(`${indent}${tsKey(event.key)}: "${escapeStr(translations.get(dotted))}",`);
      }
    } else if (event.type === 'close') {
      const dotted = [...event.path, event.key].join('.');
      if (hasContent.has(dotted)) {
        // Emit any extras whose parent is this section
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
// Append extra keys (in merged but NOT in en.ts) into the output
// e.g. Czech-specific plural forms like _few, _many
// ---------------------------------------------------------------------------
function appendExtras(output, translations, enKeySet) {
  // Collect extras grouped by top-level section
  const extras = new Map(); // section → [{ key, val }]

  for (const [dottedKey, val] of translations) {
    if (!enKeySet.has(dottedKey)) {
      const parts = dottedKey.split('.');
      const section = parts[0];
      if (!extras.has(section)) extras.set(section, []);
      extras.get(section).push({ dottedKey, parts, val });
    }
  }

  if (extras.size === 0) return output;

  // For each section, find its closing `},` in the output and insert extras before it
  let result = output;
  for (const [section, items] of extras) {
    // Find the section's closing brace — look for the last `  },` that follows
    // the section header. This is a heuristic using the section name.
    // We find `  ${section}: {` or `  "${section}": {` and then its matching `  },`
    const sectionHeaderRe = new RegExp(`^  (?:"${section}"|${section}): \\{$`, 'm');
    const match = sectionHeaderRe.exec(result);
    if (!match) continue;

    // Find matching close — scan from match position, counting braces
    let depth = 0;
    let closePos = -1;
    let idx = match.index;
    while (idx < result.length) {
      if (result[idx] === '{') depth++;
      else if (result[idx] === '}') {
        depth--;
        if (depth === 0) {
          // Find the end of this line
          let lineEnd = result.indexOf('\n', idx);
          if (lineEnd === -1) lineEnd = result.length;
          closePos = idx; // position of `}` on the close line
          break;
        }
      }
      idx++;
    }
    if (closePos === -1) continue;

    // Build the extra lines to insert
    const extraLines = items.map(({ parts, val }) => {
      const indent = '  '.repeat(parts.length);
      return `${indent}${tsKey(parts[parts.length - 1])}: "${escapeStr(val)}",`;
    }).join('\n');

    // Insert before the closing brace line
    const lineStart = result.lastIndexOf('\n', closePos - 1) + 1;
    result = result.slice(0, lineStart) + extraLines + '\n' + result.slice(lineStart);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('Parsing czech.txt...');
const czechTranslations = parseCzechCSV(CZECH_TXT);
console.log(`  ${czechTranslations.size} translations found in czech.txt`);

console.log('Parsing existing cs.ts...');
const existingTranslations = extractKeyValues(CS_PATH);
console.log(`  ${existingTranslations.size} existing translations in cs.ts`);

// Merge: existing first, then czech.txt overrides (for non-empty values)
const merged = new Map([...existingTranslations, ...czechTranslations]);
console.log(`  ${merged.size} total unique translations after merge`);

console.log('Parsing en.ts structure...');
const events = parseEnStructure(EN_PATH);
const enLeafKeys = new Set(events.filter(e => e.type === 'leaf').map(e => e.path.join('.')));
console.log(`  ${enLeafKeys.size} leaf keys in en.ts`);

// Count how many translations we'll actually use
let translatedCount = 0;
for (const key of enLeafKeys) {
  if (merged.has(key)) translatedCount++;
}
console.log(`  ${translatedCount} of those have Czech translations`);

const extraCount = [...merged.keys()].filter(k => !enLeafKeys.has(k)).length;
console.log(`  ${extraCount} extra keys (not in en.ts, e.g. Czech plural forms)`);

console.log('\nGenerating cs.ts...');
let output = generateLocale(events, merged);
// Note: appendExtras skipped — Czech-specific plural forms (_few, _many) fall back
// to _other at runtime. Re-enable once appendExtras handles nested paths correctly.

writeFileSync(CS_PATH, output, 'utf-8');
console.log(`\nWrote ${CS_PATH}`);
console.log('Done. Run: node scripts/check-locale-parity.mjs cs');
