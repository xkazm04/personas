#!/usr/bin/env node
/**
 * Crate-split dependency mapper.
 *
 * `app_lib` is one 431k-LOC crate, which means one rustc process and one memory
 * ceiling (measured 8.9 GB, 2026-07-26). Splitting it into workspace crates is
 * the fix, but the module graph is cyclic, so every step needs to know the exact
 * transitive closure of a candidate move — "which modules must travel together
 * for the result to be acyclic".
 *
 * This script answers that. It parses `crate::`/`super::` paths out of the Rust
 * sources, collapses them to top-level module units (a `foo.rs` or `foo/` under
 * `src/`, plus `db::models` and `db::repos` which are big enough to be their own
 * units), and reports either the whole edge matrix or the closure of a seed set.
 *
 * Usage:
 *   node scripts/build/crate-split-deps.mjs                 # edge summary
 *   node scripts/build/crate-split-deps.mjs --closure a,b,c # transitive closure of a seed
 *   node scripts/build/crate-split-deps.mjs --from x --to y # list every x -> y reference
 *
 * Caveat: this is a textual approximation, not rustc. It does not resolve `use`
 * aliases or glob re-exports, so treat a clean closure as "worth attempting",
 * never as proof. `cargo check --all-targets` is the actual gate.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src-tauri', 'src');

/**
 * Parents whose children are tracked as separate units.
 *
 * `engine` alone is 157k LOC and depends on nearly everything, so treating it
 * as one node makes every closure collapse to "the whole crate" and tells you
 * nothing. The interesting question is always about individual engine/db/command
 * modules, so those are resolved at the second level.
 */
const SPLIT_PARENTS = new Set(['db', 'engine', 'commands', 'companion']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.rs')) out.push(p);
  }
  return out;
}

/** Which unit does a source file belong to? */
function unitOfFile(file) {
  const parts = relative(SRC, file).split(sep);
  if (parts.length === 1) return parts[0].replace(/\.rs$/, '');
  if (!SPLIT_PARENTS.has(parts[0])) return parts[0];
  // `engine/mod.rs` is the parent module itself, not a child.
  if (parts.length === 2 && parts[1] === 'mod.rs') return parts[0];
  return `${parts[0]}::${parts[1].replace(/\.rs$/, '')}`;
}

/** Normalize a referenced path (already stripped of its `crate::` prefix). */
function unitOfPath(path) {
  const segs = path.split('::');
  if (!SPLIT_PARENTS.has(segs[0])) return segs[0];
  // A bare `crate::engine::FOO` (a const/type on the parent module) belongs to
  // the parent, not to a child module — `engine::mod.rs` owns it.
  if (segs.length < 2) return segs[0];
  const child = segs[1];
  // Heuristic: module paths are snake_case, items are UpperCamel or SCREAMING.
  if (/^[a-z][a-z0-9_]*$/.test(child)) return `${segs[0]}::${child}`;
  return segs[0];
}

/**
 * Blank out comments, preserving line structure so line numbers stay accurate.
 *
 * This matters more than it looks: the codebase documents heavily with
 * intra-doc links (``[`crate::db::repos::Foo`]``). Those are rustdoc-only — they
 * are NOT compile dependencies — and counting them made every closure collapse
 * to "the entire crate". Stripping them is what makes the tool usable.
 *
 * Approximation: a `//` inside a string literal is treated as a comment. That
 * costs us a few false negatives (URLs in `&str`), which is the safe direction —
 * a missed edge shows up immediately as a `cargo check` error, whereas a phantom
 * edge silently makes the analysis useless.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * Extract `unit -> line` references from a file's (comment-stripped) text.
 *
 * Handles the shapes that actually appear here:
 *   use crate::a::b::C;
 *   use crate::a::{b, c::D};        <- grouped
 *   use crate::{\n  a::B,\n  c,\n}; <- grouped AND multi-line
 *   crate::a::b::c(...)             <- inline fully-qualified call
 * `super::` is intentionally ignored — it never crosses a unit boundary here.
 */
function refsInFile(text) {
  const src = stripComments(text);
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const found = []; // [unit, line]

  // Grouped `use crate::prefix::{...}`, possibly spanning lines.
  for (const m of src.matchAll(/use\s+crate::([a-zA-Z0-9_:]*?)\{([^}]*)\}/gs)) {
    const line = lineOf(m.index);
    const prefix = m[1].replace(/::$/, '');
    if (prefix) {
      found.push([unitOfPath(prefix), line]);
    } else {
      // `use crate::{a, b::c}` — each group head is its own top-level path.
      for (const item of m[2].split(',')) {
        const head = item.trim().replace(/^self::/, '');
        if (head) found.push([unitOfPath(head), line]);
      }
    }
  }

  // Plain `crate::a::b` occurrences (covers both `use` and inline paths).
  for (const m of src.matchAll(/crate::([a-zA-Z0-9_]+(?:::[a-zA-Z0-9_]+)*)/g)) {
    found.push([unitOfPath(m[1]), lineOf(m.index)]);
  }

  return found.filter(([u]) => u);
}

const files = walk(SRC);
/** unit -> Map<unit, count> */
const edges = new Map();
/** unit -> total LOC */
const loc = new Map();
/** "from->to" -> [file:line] */
const sites = new Map();

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const from = unitOfFile(file);
  loc.set(from, (loc.get(from) ?? 0) + text.split('\n').length);
  if (!edges.has(from)) edges.set(from, new Map());

  for (const [to, line] of refsInFile(text)) {
    if (to === from) continue;
    edges.get(from).set(to, (edges.get(from).get(to) ?? 0) + 1);
    const key = `${from}->${to}`;
    if (!sites.has(key)) sites.set(key, []);
    sites.get(key).push(`${relative(process.cwd(), file)}:${line}`);
  }
}

/**
 * Modules that already live in `personas-core` but are still reachable as
 * `crate::error::…` through the re-export shims in `lib.rs`. They have no source
 * files under `src/`, so they must be named explicitly — otherwise they get
 * mistaken for crate-root items and folded into `lib`, which (since `lib`
 * depends on everything) makes every closure explode to the whole crate.
 */
const CORE_ALREADY = new Set(['error', 'error_taxonomy', 'retrieval', 'utils']);

// Everything else with no source file — `crate::AppState`, `crate::SHARED_HTTP`,
// `crate::declare_lifecycle!` — is an item declared at the crate root. Fold
// those into `lib` so a closure reports "this pulls in the crate root" rather
// than inventing zero-LOC phantom units.
for (const [, deps] of edges) {
  for (const to of [...deps.keys()]) {
    if (loc.has(to)) continue;
    const target = CORE_ALREADY.has(to) ? 'personas-core' : 'lib';
    deps.set(target, (deps.get(target) ?? 0) + deps.get(to));
    deps.delete(to);
  }
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

if (flag('--from') && flag('--to')) {
  const key = `${flag('--from')}->${flag('--to')}`;
  const list = sites.get(key) ?? [];
  console.log(`${key}  (${list.length} references)`);
  for (const s of list) console.log(`  ${s}`);
  process.exit(0);
}

if (flag('--closure')) {
  const seed = flag('--closure').split(',').map((s) => s.trim());
  // Units the caller commits to keeping OUT of the move. The closure stops at
  // them instead of expanding, and every reference that crosses into one is
  // reported as an edge that has to be broken by hand. This is the mode that
  // makes the tool useful: without it a single `crate::engine::SOME_CONST` in a
  // 1.5k-LOC module drags all 157k LOC of `engine` into the answer.
  const excluded = new Set((flag('--exclude') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const set = new Set(seed);
  const queue = [...seed];
  /** excluded unit -> total references into it from inside the closure */
  const breaks = new Map();
  while (queue.length) {
    const u = queue.shift();
    for (const [to, count] of edges.get(u) ?? []) {
      if (to === 'personas-core' || set.has(to)) continue;
      if (excluded.has(to)) {
        if (!breaks.has(to)) breaks.set(to, []);
        breaks.get(to).push([u, count]);
        continue;
      }
      set.add(to);
      queue.push(to);
    }
  }
  const rows = [...set].map((u) => [u, loc.get(u) ?? 0]).sort((a, b) => b[1] - a[1]);
  console.log(`Closure of [${seed.join(', ')}] — ${set.size} units`);
  if (excluded.size) console.log(`(stopping at: ${[...excluded].join(', ')})`);
  console.log('');
  let total = 0;
  for (const [u, n] of rows) {
    total += n;
    console.log(`  ${String(n).padStart(7)}  ${u}${seed.includes(u) ? '' : '   <- pulled in'}`);
  }
  console.log(`  ${String(total).padStart(7)}  TOTAL LOC moved`);

  if (breaks.size) {
    let n = 0;
    console.log('\nEdges that must be broken (closure -> excluded unit):');
    for (const [to, froms] of [...breaks].sort((a, b) => b[1].length - a[1].length)) {
      const sum = froms.reduce((acc, [, c]) => acc + c, 0);
      n += sum;
      console.log(`  -> ${to}  (${sum} refs)`);
      for (const [f, c] of froms.sort((a, b) => b[1] - a[1])) {
        console.log(`       ${String(c).padStart(3)}  from ${f}`);
      }
    }
    console.log(`  ${n} references total.`);
  }
  process.exit(0);
}

// Default: edge summary, biggest units first.
const units = [...loc.entries()].sort((a, b) => b[1] - a[1]);
console.log('unit                 LOC     depends on (count)');
for (const [u, n] of units) {
  const deps = [...(edges.get(u) ?? new Map())].sort((a, b) => b[1] - a[1]);
  const shown = deps.map(([d, c]) => `${d}:${c}`).join(' ');
  console.log(`${u.padEnd(20)} ${String(n).padStart(7)}  ${shown}`);
}
