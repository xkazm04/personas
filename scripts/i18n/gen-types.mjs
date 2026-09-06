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

// ---------------------------------------------------------------------------
// Second output: the SHAPE SKELETON.
//
// `t` resolves a section that has not finished loading to a fallback object,
// so a MISSING KEY renders blank instead of crashing. That promise held for
// exactly one level: `t.shared.foo` on an unloaded section is `undefined`
// (fine), but `t.shared.sidebar_extra.whats_new_update` reads a property OFF
// that `undefined` and throws — which is what the always-mounted sidebar did
// on most cold starts (2026-09-06). It is not a one-off: measured at that
// commit, 4,623 call sites in `src/` read two levels deep, across 486 groups.
//
// The skeleton is en.json with every STRING dropped and every OBJECT kept, so
// the fallback for an unloaded section carries its group structure and a
// nested read lands on `undefined` rather than on nothing. ~10 KB for all 63
// sections — cheap enough to bundle eagerly, which is the point: it has to be
// resident BEFORE any section loads, or it cannot do its job.
const SHAPE_FILE = resolve(OUT_DIR, 'sectionShapes.ts');

function skeleton(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = skeleton(value);
  }
  return out;
}

const shapes = skeleton(data);
const shapeOutput = `// ============================================================================
// AUTO-GENERATED FROM src/i18n/locales/en.json — DO NOT EDIT BY HAND.
// Regenerate with: node scripts/i18n/gen-types.mjs
// Runs automatically in predev/prebuild (see scripts/run-codegen.mjs).
//
// The group STRUCTURE of every section, with all strings dropped. Used as the
// fallback for a section whose chunk has not landed yet, so that a nested read
// (\`t.shared.sidebar_extra.whats_new_update\`) resolves to \`undefined\` and
// renders blank, instead of throwing on a property read off \`undefined\`.
// ============================================================================

export const SECTION_SHAPES: Readonly<Record<string, Record<string, unknown>>> =
  Object.freeze(${JSON.stringify(shapes, null, 2)} as Record<string, Record<string, unknown>>);
`;
writeFileSync(SHAPE_FILE, shapeOutput);
console.log(`✓ Wrote ${SHAPE_FILE} (${Object.keys(shapes).length} sections)`);
