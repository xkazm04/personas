#!/usr/bin/env node
/**
 * Delete keys that no source file references from en.json AND all 13 locales.
 *
 * Source of truth for "dead" is find-unused-i18n-keys.mjs, which is deliberately
 * prefix-permissive: any `t.foo` reference marks the whole `foo.*` subtree live,
 * and it additionally resolves `tokenLabel(t, '<cat>', …)` and ERROR_KEY_MAP
 * dynamic lookups. False-positive-dead is therefore unlikely by construction —
 * but this script is destructive, so it defaults to a dry run.
 *
 * Usage:
 *   node scripts/i18n/purge-dead-keys.mjs            # dry run, prints a plan
 *   node scripts/i18n/purge-dead-keys.mjs --apply    # write the files
 *   node scripts/i18n/purge-dead-keys.mjs --apply --keep-prefix=status_tokens.,event_types.
 *
 * After --apply you MUST run: node scripts/i18n/split-locales.mjs
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { LOCDIR, locales } from './lib/untranslated.mjs';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const keepArg = argv.find((a) => a.startsWith('--keep-prefix='))?.split('=')[1];
const keepPrefixes = keepArg ? keepArg.split(',').filter(Boolean) : [];

const scan = JSON.parse(
  execSync('node scripts/i18n/find-unused-i18n-keys.mjs --json --full', {
    encoding: 'utf8',
    maxBuffer: 128e6,
  }),
);
let dead = scan.unusedKeys.filter((k) => !keepPrefixes.some((p) => k.startsWith(p)));

// Never purge translator notes that annotate a surviving sibling.
dead = dead.filter((k) => !k.split('.').some((s) => s.startsWith('_comment')));

console.log(`dead keys reported : ${scan.unusedKeys.length}`);
if (keepPrefixes.length) console.log(`kept by --keep-prefix: ${scan.unusedKeys.length - dead.length}`);
console.log(`to purge           : ${dead.length}\n`);

const bySection = {};
for (const k of dead) bySection[k.split('.')[0]] = (bySection[k.split('.')[0]] || 0) + 1;
console.log('by section:');
Object.entries(bySection)
  .sort((a, b) => b[1] - a[1])
  .forEach(([s, n]) => console.log(`  ${s.padEnd(20)} ${String(n).padStart(4)}`));

/** Remove a dotted path, then prune any object it leaves empty. */
function deepDelete(obj, dotted) {
  const parts = dotted.split('.');
  const stack = [];
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur?.[parts[i]] !== 'object' || cur[parts[i]] === null) return false;
    stack.push([cur, parts[i]]);
    cur = cur[parts[i]];
  }
  const leaf = parts[parts.length - 1];
  if (!(leaf in cur)) return false;
  delete cur[leaf];
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i];
    if (Object.keys(parent[key]).length === 0) delete parent[key];
    else break;
  }
  return true;
}

/**
 * Once every real key under an object is gone, a surviving `_comment_*` note
 * documents nothing. Drop objects whose remaining leaves are all comments.
 */
function pruneCommentOnly(node) {
  if (typeof node !== 'object' || node === null) return false;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'object' && v !== null) {
      if (pruneCommentOnly(v)) delete node[k];
    }
  }
  const keys = Object.keys(node);
  return keys.length > 0 && keys.every((k) => k.startsWith('_comment'));
}

if (!apply) {
  console.log('\nDRY RUN — pass --apply to write. Then run split-locales.mjs.');
  process.exit(0);
}

const langs = ['en', ...locales()];
for (const lang of langs) {
  const file = `${LOCDIR}/${lang}.json`;
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  let removed = 0;
  for (const k of dead) if (deepDelete(cat, k)) removed++;
  for (const [k, v] of Object.entries(cat)) if (pruneCommentOnly(v)) delete cat[k];
  fs.writeFileSync(file, JSON.stringify(cat, null, 2) + '\n');
  console.log(`  ${lang.padEnd(4)} removed ${removed}`);
}
console.log('\nPurged. Now run: node scripts/i18n/split-locales.mjs');
