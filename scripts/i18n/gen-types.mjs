#!/usr/bin/env node
/**
 * Generate src/i18n/generated/types.ts from src/i18n/locales/en.json.
 * The generated type mirrors the nested JSON structure with string leaves,
 * giving `t.agents.chat.send` autocomplete and catching drift at compile time.
 *
 * Runs in `prebuild`; re-run manually after editing en.json.
 *
 * Usage:  node scripts/i18n/gen-types.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const EN_JSON = resolve(ROOT, 'src/i18n/locales/en.json');
const OUT_DIR = resolve(ROOT, 'src/i18n/generated');
const OUT_FILE = resolve(OUT_DIR, 'types.ts');

mkdirSync(OUT_DIR, { recursive: true });

const data = JSON.parse(readFileSync(EN_JSON, 'utf8'));

function emit(obj, indent = 2) {
  if (obj === null || typeof obj !== 'object') return 'string';
  if (Array.isArray(obj)) {
    // Rare in translation files; treat as string[] unless items are objects.
    if (obj.length === 0) return 'never[]';
    const itemType = emit(obj[0], indent);
    return `${itemType}[]`;
  }
  const pad = ' '.repeat(indent);
  const closingPad = ' '.repeat(indent - 2);
  const lines = ['{'];
  for (const [key, value] of Object.entries(obj)) {
    const safeKey = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    lines.push(`${pad}${safeKey}: ${emit(value, indent + 2)};`);
  }
  lines.push(`${closingPad}}`);
  return lines.join('\n');
}

const body = emit(data);

const output = `// ============================================================================
// AUTO-GENERATED FROM src/i18n/locales/en.json — DO NOT EDIT BY HAND.
// Regenerate with: node scripts/i18n/gen-types.mjs
// Runs automatically in prebuild (see package.json scripts).
// ============================================================================

export type Translations = ${body};
`;

writeFileSync(OUT_FILE, output);
console.log(`✓ Wrote ${OUT_FILE} (${output.split('\n').length} lines)`);
