#!/usr/bin/env node
/**
 * Find Tauri commands that are registered but never invoked.
 *
 * `tauri::generate_handler!` is ~half of `cargo check`'s wall time (measured:
 * gutting it from 1,827 entries to 8 cut a check from 169s to 86s — see
 * docs/development/build-memory.md). The cost scales with the number of
 * registered commands, so a command nobody calls is pure build tax.
 *
 * Registered names come from `commandNames.generated.ts`, which is itself
 * generated from lib.rs's invoke_handler. Call sites are every string literal
 * that reaches `invokeWithTimeout` / `safeInvoke` / `invoke`, plus anything
 * named in Rust (the management API and the test-automation bridge dispatch by
 * name too) and anything in the override list.
 *
 * MEASURED COST, so the payoff is known before you start (2026-07-27,
 * incremental `cargo check --lib` after touching one deep file):
 *
 *     1,647 handler entries   35.5 s
 *       823 entries           23.5 s
 *         8 entries           17.0 s
 *
 * ~11 ms per registered command, slightly superlinear at the top end. The
 * handler is 52% of every incremental check — the cost is paid on EVERY edit,
 * not just edits to lib.rs.
 *
 * CAVEAT — this reports CANDIDATES, not verdicts. A name assembled at runtime
 * (`` invoke(`persona_${verb}`) ``) is invisible to a text scan, so anything
 * here must be eyeballed before deletion. It is deliberately biased toward
 * over-reporting: a false "dead" that you check costs a minute, a missed one
 * that you delete costs a broken feature.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

// --- registered ------------------------------------------------------------
const generated = readFileSync(join(ROOT, 'src/lib/commandNames.generated.ts'), 'utf8');
const registered = [...generated.matchAll(/^\s*\|\s*"([a-z0-9_]+)"/gm)].map((m) => m[1]);
if (registered.length === 0) {
  console.error('Could not parse commandNames.generated.ts — did its shape change?');
  process.exit(1);
}

// --- referenced ------------------------------------------------------------
// Every identifier-ish token in the frontend and in Rust. Deliberately crude:
// we want any mention at all to count as "referenced".
const referenced = new Set();
const addFrom = (text) => {
  for (const m of text.matchAll(/['"`]([a-z0-9_]{3,})['"`]/g)) referenced.add(m[1]);
};

for (const f of walk(join(ROOT, 'src'), ['.ts', '.tsx'])) {
  if (f.includes('commandNames.generated')) continue;
  addFrom(readFileSync(f, 'utf8'));
}
// Rust dispatches commands by name too (management API, test-automation bridge).
for (const sub of ['src', 'core/src', 'db/src', 'engine/src']) {
  for (const f of walk(join(ROOT, 'src-tauri', sub), ['.rs'])) {
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('lib.rs')) continue; // the registration list itself
    addFrom(text);
  }
}

const unused = registered.filter((c) => !referenced.has(c));

// --- report ----------------------------------------------------------------
const byPrefix = new Map();
for (const c of unused) {
  const p = c.split('_')[0];
  byPrefix.set(p, [...(byPrefix.get(p) ?? []), c]);
}

console.log(`registered commands : ${registered.length}`);
console.log(`never referenced    : ${unused.length}  (${((100 * unused.length) / registered.length).toFixed(0)}%)`);
console.log('');
if (process.argv.includes('--list')) {
  for (const [p, cs] of [...byPrefix].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(cs.length).padStart(3)}  ${p}_*`);
    if (process.argv.includes('--all')) for (const c of cs.sort()) console.log(`         ${c}`);
  }
} else {
  console.log('Top families (re-run with --list, or --list --all for names):');
  for (const [p, cs] of [...byPrefix].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) {
    console.log(`  ${String(cs.length).padStart(3)}  ${p}_*`);
  }
}
console.log('\nCANDIDATES ONLY — a runtime-assembled name is invisible here. Verify before deleting.');
