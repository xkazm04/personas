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
 * This script answers that. It parses `crate::` paths out of the Rust sources,
 * collapses them to module units (top-level modules, plus second-level ones
 * under `db`/`engine`/`commands`/`companion`, which are far too big to treat as
 * single nodes), and reports the edge matrix or the closure of a seed set.
 *
 * Usage:
 *   node scripts/build/crate-split-deps.mjs                    # edge summary
 *   node scripts/build/crate-split-deps.mjs --closure a,b      # transitive closure
 *   node scripts/build/crate-split-deps.mjs --closure a --exclude engine,lib
 *   node scripts/build/crate-split-deps.mjs --from x --to y    # every x -> y site
 *   node scripts/build/crate-split-deps.mjs --folded           # resolver debug
 *
 * `--exclude` is the flag that makes this usable. Without it every closure
 * collapses to "the whole crate", because a single `crate::engine::SOME_CONST`
 * in a 1.5k-LOC module is enough to drag all 157k LOC of `engine` in. Exclude
 * the units you intend to keep out, and the tool reports exactly which
 * references cross the boundary — that list IS the work item for the step.
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
 *   use super::sibling;             <- sibling within engine/, db/, ...
 *
 * `super::` matters more than it looks. Files directly under `engine/` refer to
 * their siblings as `super::provider`, never `crate::engine::provider`, so
 * ignoring it made every engine module look far more portable than it is —
 * `eval` appeared to depend only on db+core when it actually pulls in
 * cli_process, parser and prompt. `unitPrefix` is the unit that `super::`
 * resolves to for this file, or null when it cannot cross a unit boundary.
 */
function refsInFile(text, unitPrefix) {
  let src = stripComments(text);
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

  // `super::sibling` — resolved against the file's parent module.
  //
  // ...but only OUTSIDE a nested `mod`, because inside one `super::` means the
  // file's own module, not its parent. Nearly every nested module here is a
  // `#[cfg(test)] mod tests` block at the end of the file, so truncating there
  // is enough: `rate_limiter`'s test writing `super::AUTO_PRUNE_INTERVAL` was
  // otherwise read as a dependency on `engine/mod.rs`, which alone made three
  // more modules look unextractable.
  if (unitPrefix) {
    const testMod = src.search(/\n\s*mod\s+tests\s*\{/);
    if (testMod >= 0) src = src.slice(0, testMod);
    for (const m of src.matchAll(/super::([a-zA-Z0-9_]+(?:::[a-zA-Z0-9_]+)*)/g)) {
      found.push([unitOfPath(`${unitPrefix}::${m[1]}`), lineOf(m.index)]);
    }
    for (const m of src.matchAll(/use\s+super::\{([^}]*)\}/gs)) {
      const line = lineOf(m.index);
      for (const item of m[1].split(',')) {
        const head = item.trim();
        if (head) found.push([unitOfPath(`${unitPrefix}::${head}`), line]);
      }
    }
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

  // What does `super::` mean in THIS file? Only a file sitting directly under a
  // split parent (`engine/foo.rs`) reaches a sibling unit through it; deeper
  // files (`db/repos/core/personas.rs`) resolve `super::` inside their own unit.
  const parts = relative(SRC, file).split(sep);
  const superPrefix =
    parts.length === 2 && SPLIT_PARENTS.has(parts[0]) && parts[1] !== 'mod.rs' ? parts[0] : null;

  for (const [to, line] of refsInFile(text, superPrefix)) {
    if (to === from) continue;
    edges.get(from).set(to, (edges.get(from).get(to) ?? 0) + 1);
    const key = `${from}->${to}`;
    if (!sites.has(key)) sites.set(key, []);
    sites.get(key).push(`${relative(process.cwd(), file)}:${line}`);
  }
}

/**
 * Modules that already live in `personas-core`, read off the filesystem rather
 * than hardcoded — a stale list here silently makes every closure explode.
 *
 * They are still reachable as `crate::error::…` / `crate::db::models::…`
 * through the re-export shims, but have no source file under `src/` any more.
 * Without recognizing them they look like crate-root items and get folded into
 * `lib`, and since `lib` transitively depends on everything, the answer becomes
 * "the whole crate" no matter what you ask.
 */
const CORE_ALREADY = new Set(
  readdirSync(join(process.cwd(), 'src-tauri', 'core', 'src'))
    .map((n) => n.replace(/\.rs$/, ''))
    .filter((n) => n !== 'lib')
);

/**
 * Top-level modules that are now separate crates, re-exported under their old
 * name from `lib.rs` (`pub use personas_db as db;`). Same hazard as
 * CORE_ALREADY: they have no source under `src/`, so without this they look
 * like crate-root items and fold into `lib`, which depends on everything.
 */
const EXTRACTED_CRATES = new Map([['db', 'personas-db']]);

// Everything else with no source file — `crate::AppState`, `crate::SHARED_HTTP`,
// `crate::declare_lifecycle!` — is an item declared at the crate root. Fold
// those into `lib` so a closure reports "this pulls in the crate root" rather
// than inventing zero-LOC phantom units.
/** raw unresolved name -> Set of units that referenced it (for --folded). */
const foldedFrom = new Map();
for (const [from, deps] of edges) {
  for (const to of [...deps.keys()]) {
    if (loc.has(to)) continue;
    if (!foldedFrom.has(to)) foldedFrom.set(to, { froms: new Set(), target: null });
    foldedFrom.get(to).froms.add(from);
    const [parent, ...restSegs] = to.split('::');
    // `crate::db::models` and `crate::engine::types` still read as `db::…` /
    // `engine::…` at the call site even though both now live in core, so match
    // on the last segment too.
    const leaf = restSegs.length ? restSegs[restSegs.length - 1] : to;
    let target;
    if (EXTRACTED_CRATES.has(parent)) {
      target = EXTRACTED_CRATES.get(parent);
    } else if (CORE_ALREADY.has(to) || CORE_ALREADY.has(leaf)) {
      target = 'personas-core';
    } else if (restSegs.length && loc.has(parent)) {
      // `crate::db::init_test_db` — a snake_case name under a real module that
      // has no file of its own is a FUNCTION on that module's `mod.rs`, not a
      // submodule. Attribute it to the parent; calling it a crate-root item
      // would wrongly make the closure depend on `lib`, i.e. on everything.
      target = parent;
    } else {
      target = 'lib';
    }
    foldedFrom.get(to).target = target;
    deps.set(target, (deps.get(target) ?? 0) + deps.get(to));
    deps.delete(to);
  }
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

if (args.includes('--folded')) {
  // Debug aid: every referenced name with no source file, and who names it.
  // Anything landing in `lib` that is NOT a genuine crate-root item (AppState,
  // SHARED_HTTP, a `#[macro_export]` macro) means the resolver is wrong.
  for (const [name, { froms, target }] of [...foldedFrom].sort()) {
    console.log(`${String(target).padEnd(14)} ${name.padEnd(28)} <- ${[...froms].join(', ')}`);
  }
  process.exit(0);
}

if (flag('--from') && flag('--to')) {
  const key = `${flag('--from')}->${flag('--to')}`;
  const list = sites.get(key) ?? [];
  console.log(`${key}  (${list.length} references)`);
  for (const s of list) console.log(`  ${s}`);
  process.exit(0);
}

if (flag('--portable')) {
  // Largest extractable subset of a module tree.
  //
  // `--closure` answers "what must travel with X". This answers the inverse and
  // more useful question for a big tangled tree: "how much of `engine` could
  // leave TODAY, if the parts that reach upward simply stayed behind?" A module
  // that pokes at `AppState` is application wiring, not library code, so leaving
  // it in app_lib is a defensible boundary rather than a compromise.
  //
  // Fixpoint: start with every unit under the prefix, then repeatedly drop any
  // unit with an edge to an excluded unit or to an already-dropped one.
  const prefix = flag('--portable');
  const excludeRoots = (flag('--exclude') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const isExcluded = (u) => excludeRoots.some((e) => u === e || u.startsWith(`${e}::`));
  const inPrefix = (u) => u === prefix || u.startsWith(`${prefix}::`);

  const keep = new Set([...loc.keys()].filter(inPrefix));
  const dropped = new Map(); // unit -> why
  for (;;) {
    let changed = false;
    for (const u of [...keep]) {
      for (const [to] of edges.get(u) ?? []) {
        if (to === 'personas-core' || to === 'personas-db' || keep.has(to)) continue;
        if (inPrefix(to) && !dropped.has(to)) continue;
        const why = dropped.has(to) ? `via ${to}` : `-> ${to}`;
        if (isExcluded(to) || dropped.has(to)) {
          keep.delete(u);
          dropped.set(u, why);
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }

  const sum = (s) => [...s].reduce((a, u) => a + (loc.get(u) ?? 0), 0);
  const keptRows = [...keep].map((u) => [u, loc.get(u) ?? 0]).sort((a, b) => b[1] - a[1]);
  const dropRows = [...dropped].map(([u, w]) => [u, loc.get(u) ?? 0, w]).sort((a, b) => b[1] - a[1]);
  console.log(`PORTABLE subset of \`${prefix}\` — ${keep.size} units, ${sum(keep)} LOC\n`);
  for (const [u, n] of keptRows) console.log(`  ${String(n).padStart(6)}  ${u}`);
  console.log(`\nSTAYS BEHIND — ${dropped.size} units, ${sum(new Set(dropped.keys()))} LOC`);
  console.log('(reason: reaches an excluded unit, directly or through another that does)\n');
  for (const [u, n, w] of dropRows) console.log(`  ${String(n).padStart(6)}  ${u.padEnd(38)} ${w}`);
  process.exit(0);
}

if (flag('--closure')) {
  const seed = flag('--closure').split(',').map((s) => s.trim());
  // Units the caller commits to keeping OUT of the move. The closure stops at
  // them instead of expanding, and every reference that crosses into one is
  // reported as an edge that has to be broken by hand. This is the mode that
  // makes the tool useful: without it a single `crate::engine::SOME_CONST` in a
  // 1.5k-LOC module drags all 157k LOC of `engine` into the answer.
  // Prefix-aware: `--exclude commands` stops at `commands::fleet` too. Without
  // this, one `crate::commands::fleet::now_ms` in a repo file quietly readmits
  // all 123k LOC of `commands` to the closure.
  const excludeRoots = (flag('--exclude') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const excluded = {
    has: (u) => excludeRoots.some((e) => u === e || u.startsWith(`${e}::`)),
    size: excludeRoots.length,
    [Symbol.iterator]: () => excludeRoots[Symbol.iterator](),
  };
  const set = new Set(seed);
  const queue = [...seed];
  /** excluded unit -> total references into it from inside the closure */
  const breaks = new Map();
  while (queue.length) {
    const u = queue.shift();
    for (const [to, count] of edges.get(u) ?? []) {
      if (to === 'personas-core' || to === 'personas-db' || set.has(to)) continue;
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
