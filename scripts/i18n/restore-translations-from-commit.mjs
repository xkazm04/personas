#!/usr/bin/env node
/**
 * One-shot restoration: pull the 13 non-English locale .ts files from a
 * past commit that had full-coverage translations, convert each to the
 * JSON format used by the current i18n architecture, and write the
 * result to `src/i18n/locales/<code>.json`.
 *
 * Used once after the JSON-per-locale migration to recover translations
 * that were generated pre-migration but lost when the .ts files were
 * replaced by their (pre-translation) JSON equivalents.
 *
 * Source commit (full-coverage .ts locales): 4d589912
 *
 * Usage:  node scripts/i18n/restore-translations-from-commit.mjs [<sha>]
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const LOCALES = ['ar', 'bn', 'cs', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];
const SOURCE_SHA = process.argv[2] || '4d589912';

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(ROOT, 'src/i18n/locales');
const TMP_DIR = resolve(ROOT, '.tmp/locale-restore');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

console.log(`Restoring translations from ${SOURCE_SHA}…\n`);

for (const code of LOCALES) {
  // Pull the .ts source straight from git
  let source;
  try {
    source = execSync(`git show ${SOURCE_SHA}:src/i18n/${code}.ts`, { encoding: 'utf8' });
  } catch (err) {
    console.error(`✗ ${code}: could not read from ${SOURCE_SHA} — ${err.message.split('\n')[0]}`);
    continue;
  }

  // Transpile TS → ESM JS (strip all type syntax, keep the runtime value)
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2021,
      removeComments: true,
    },
  });

  const tmpPath = resolve(TMP_DIR, `${code}.mjs`);
  writeFileSync(tmpPath, outputText);

  // Dynamic-import and grab the exported identifier named after the locale
  const mod = await import(pathToFileURL(tmpPath).href + `?t=${Date.now()}`);
  const data = mod[code];
  if (!data || typeof data !== 'object') {
    console.error(`✗ ${code}: no export const ${code} = {…} found`);
    continue;
  }

  const jsonPath = resolve(OUT_DIR, `${code}.json`);
  writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');

  const leafCount = countLeaves(data);
  console.log(`✓ ${code} → locales/${code}.json (${leafCount} leaves)`);
}

rmSync(TMP_DIR, { recursive: true, force: true });

function countLeaves(obj) {
  if (obj === null || typeof obj !== 'object') return 1;
  if (Array.isArray(obj)) return obj.reduce((acc, v) => acc + countLeaves(v), 0);
  return Object.values(obj).reduce((acc, v) => acc + countLeaves(v), 0);
}
