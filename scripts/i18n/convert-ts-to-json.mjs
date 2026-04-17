#!/usr/bin/env node
/**
 * One-shot migration: convert src/i18n/<lang>.ts files into
 * src/i18n/locales/<lang>.json. TypeScript compiler API evaluates each
 * source module (they're pure data — no I/O, no imports), then serializes
 * the exported identifier as pretty JSON.
 *
 * Translator hints (leading `//` comments in en.ts) are NOT preserved in
 * this pass — they remain accessible in git history. A follow-up can add
 * a sidecar hints file if the translator team wants them back.
 *
 * Usage:  node scripts/i18n/convert-ts-to-json.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const LOCALES = ['en', 'ar', 'bn', 'cs', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(ROOT, 'src/i18n/locales');
const TMP_DIR = resolve(ROOT, '.tmp/locale-migration');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

for (const code of LOCALES) {
  const srcPath = resolve(ROOT, `src/i18n/${code}.ts`);
  const source = readFileSync(srcPath, 'utf8');

  // Transpile TS → ESM JS. `as const`, `as unknown as Translations`, and
  // similar cast syntax is stripped; the exported const remains.
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2021,
      removeComments: true,
      // Strip all type-only syntax; we only want the runtime value.
    },
  });

  // Write to a temporary .mjs file so Node can dynamic-import it.
  const tmpPath = resolve(TMP_DIR, `${code}.mjs`);
  writeFileSync(tmpPath, outputText);

  // Dynamic import, grab the exported identifier named after the locale.
  const mod = await import(pathToFileURL(tmpPath).href + `?t=${Date.now()}`);
  const data = mod[code];
  if (!data || typeof data !== 'object') {
    throw new Error(`Expected export const ${code} = {...} in ${srcPath}`);
  }

  const jsonPath = resolve(OUT_DIR, `${code}.json`);
  writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');

  const topKeys = Object.keys(data).length;
  const leafCount = countLeaves(data);
  console.log(`✓ ${code} → locales/${code}.json (${topKeys} sections, ${leafCount} leaf keys)`);
}

// Cleanup tmp dir
rmSync(TMP_DIR, { recursive: true, force: true });

function countLeaves(obj) {
  if (obj === null || typeof obj !== 'object') return 1;
  if (Array.isArray(obj)) return obj.reduce((acc, v) => acc + countLeaves(v), 0);
  return Object.values(obj).reduce((acc, v) => acc + countLeaves(v), 0);
}
