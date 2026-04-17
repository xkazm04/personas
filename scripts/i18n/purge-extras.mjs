#!/usr/bin/env node
/**
 * Remove stale keys from every locale JSON: any key whose path does NOT
 * exist in en.json (keys that were renamed, restructured, or deleted
 * from the English source after a translation was done). These keys
 * have no runtime effect — they're unreferenced by components — but they
 * bloat the bundle and make the coverage gate impossible to pass strict.
 *
 * Usage:  node scripts/i18n/purge-extras.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const LOCALES_DIR = resolve(ROOT, 'src/i18n/locales');

const en = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'en.json'), 'utf8'));

/** Deep-copy `base`, keeping only keys whose path exists in `shape`. */
function intersectWithShape(base, shape) {
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return base;
  if (shape === null || typeof shape !== 'object' || Array.isArray(shape)) return base;
  const out = {};
  for (const key of Object.keys(base)) {
    if (!(key in shape)) continue;
    const b = base[key];
    const s = shape[key];
    if (b && typeof b === 'object' && !Array.isArray(b) && s && typeof s === 'object' && !Array.isArray(s)) {
      out[key] = intersectWithShape(b, s);
    } else {
      out[key] = b;
    }
  }
  return out;
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json') && f !== 'en.json');

for (const file of files) {
  const path = resolve(LOCALES_DIR, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const pruned = intersectWithShape(data, en);
  writeFileSync(path, JSON.stringify(pruned, null, 2) + '\n');
  console.log(`✓ ${file}`);
}
