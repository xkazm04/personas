#!/usr/bin/env node
/**
 * check-unused-bindings — the one-pass implementation behind
 * scripts/check-unused-bindings.sh (kept at that path: golden-path docs and
 * the census cite it).
 *
 * Same question, same answer as the grep loop it replaces: a binding
 * `src/lib/bindings/<Name>.ts` (index.ts aside) is USED when
 *   1. `<Name>` occurs as a whole word in any .ts/.tsx under src/ outside a
 *      directory named `bindings` (grep -rw ... --exclude-dir=bindings), or
 *   2. another binding file (not index.ts) imports it: `from "./<Name>"`.
 *
 * The loop ran one recursive grep over all of src/ per binding - 1,413
 * bindings, 59 s on a CI runner (2026-10-25). This reads every file once and
 * looks each name up in a set: about a second.
 *
 * What it does not answer (see check-binding-orphans.mjs): a word match is a
 * reference of any kind, so a binding kept alive by an unrelated identifier
 * of the same name passes. That is the old gate's contract, unchanged.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const BINDINGS_DIR = path.join(SRC, 'lib', 'bindings');

const words = new Set();
let scanned = 0;
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'bindings') walk(p); // --exclude-dir=bindings matches the name at any depth
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      for (const w of readFileSync(p, 'utf8').match(/\w+/g) ?? []) words.add(w);
      scanned++;
    }
  }
})(SRC);

const bindingFiles = readdirSync(BINDINGS_DIR).filter((f) => f.endsWith('.ts'));
// Fail-loud on the population: an empty bindings dir or an empty scan is a
// broken walk, not a clean tree.
if (bindingFiles.length < 100 || scanned < 1000) {
  console.error(`ERROR: walked ${scanned} source files and ${bindingFiles.length} bindings - too few to be the real tree.`);
  process.exit(1);
}

const importedByBinding = new Set();
for (const f of bindingFiles) {
  if (f === 'index.ts') continue;
  const text = readFileSync(path.join(BINDINGS_DIR, f), 'utf8');
  for (const m of text.matchAll(/from "\.\/([^"]+)"/g)) {
    if (m[1] !== f.replace(/\.ts$/, '')) importedByBinding.add(m[1]);
  }
}

const unused = bindingFiles
  .map((f) => f.replace(/\.ts$/, ''))
  .filter((name) => name !== 'index' && !words.has(name) && !importedByBinding.has(name))
  .sort();

if (unused.length > 0) {
  console.log(`ERROR: ${unused.length} unused binding(s) found in src/lib/bindings:`);
  for (const name of unused) console.log(`  ${name}`);
  console.log('');
  console.log('Remove unused .ts files and their index.ts exports, or start using them.');
  process.exit(1);
}
console.log(`OK: all ${bindingFiles.length - 1} bindings in src/lib/bindings are referenced by application code or other bindings.`);
