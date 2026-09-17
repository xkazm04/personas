#!/usr/bin/env node
/**
 * check-test-feature-cells — fails when a cargo feature gates test code that no
 * `cargo test` invocation in this repository ever enables.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY NOTHING ELSE HERE CAN SEE IT
 * ---------------------------------------------------------------------------
 * The Rust gate varies two independent things. `ci.yml`'s `rust-tests` job
 * varies the OPERATING SYSTEM (three values) and pins the feature set to
 * `desktop`. `ci.yml`'s `rust-features` job varies the FEATURE SET (three
 * shapes) and pins the OS to Linux -- and runs `cargo check`, not `cargo test`.
 * Both jobs are correct and the split is deliberate (`ci.yml:405-407` explains
 * it). The consequence neither job's scope contains is that the union covers
 * the OS axis at one feature value and the feature axis at ZERO test values.
 *
 * Measured 2026-09-17 in a detached worktree at 91b684dfb, private target dir,
 * `personas-engine` only, with a filter matching nothing so that the runner's
 * "filtered out" figure is the crate's compiled test total:
 *
 *     --features desktop      1340 tests compiled   <- what CI reports
 *     --features ml           1189 tests compiled
 *     --features desktop,ml   1352 tests compiled
 *
 * So 12 tests in this one crate are compiled by no cell any job runs (1352 -
 * 1340), and the cells are NOT NESTED -- `desktop` holds 163 tests `ml` does
 * not, so "just run the richer shape" trades one blind region for another.
 * Only the union is the suite.
 *
 * Every population check already in this repository returns clean, because
 * each one is defined INSIDE a cell:
 *
 *   - A selection floor cannot fire. Conditional compilation removes the test
 *     module before the runner enumerates anything, so the lane's selection
 *     count is correct for its own cell. Nothing was deselected or skipped.
 *   - `check-binding-orphans.mjs` reconciles bindings against declarations --
 *     one axis, computed inside the `desktop` cell.
 *   - `check-command-feature-coverage.mjs` asks the per-configuration question
 *     for COMMANDS and reasons explicitly that the two selectors are
 *     independent. It is the right shape; its subject is the shipped command
 *     surface, not the suite.
 *   - Clippy on the reported cell stays green: verified by deliberately
 *     breaking `chunker.rs`'s `test_chunk_short_text` (an `ml`-gated test) and
 *     running `cargo clippy -p personas-engine --features desktop -- -D
 *     warnings`, which exited 0. The same break turned
 *     `cargo test -p personas-engine --features ml chunker` red (11 passed, 1
 *     failed, exit 101). The break is visible ONLY in the cell nothing runs.
 *
 * `docs/concepts/golden-paths/feature-flagged-compilation.md` §"C. Variants
 * nothing compiles" already states and quantifies this gap in prose, and it has
 * been standing while the gate went unchanged -- which is the argument for an
 * instrument rather than a further paragraph.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS
 * ---------------------------------------------------------------------------
 * Two sets, compared:
 *
 *   ENABLED  the union of every feature any `cargo test` invocation in the
 *            repository passes, expanded transitively through `[features]`.
 *   GATING   every feature named by a `#[cfg(all(test, feature = "X"))]`
 *            attribute -- i.e. features that decide whether test code exists.
 *
 * GATING minus ENABLED is the finding, reported with the gated test count per
 * site. Both sets are read from the DECLARATIONS -- Cargo.toml, and the
 * workflow and script text -- rather than from a run, because a run cannot
 * report a region it never compiled. An enumeration assembled from the jobs
 * would be a list of the cells somebody remembered, and would agree with
 * itself by construction.
 *
 * Baseline convention, as in `check-command-feature-coverage.mjs`: the run
 * fails when the uncovered set RISES above the recorded baseline and also when
 * a baseline entry DROPS OUT without the file being updated, since a silent
 * drop is what a broken matcher looks like.
 *
 * Usage:
 *   node scripts/check-test-feature-cells.mjs            # gate
 *   node scripts/check-test-feature-cells.mjs --report   # print both sets
 *   node scripts/check-test-feature-cells.mjs --update   # rewrite the baseline
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(import.meta.dirname, "..");
const CARGO_TOML = join(REPO, "src-tauri", "Cargo.toml");
const BASELINE = join(REPO, "scripts", "test-feature-cells-baseline.json");

const args = new Set(process.argv.slice(2));
const REPORT = args.has("--report");
const UPDATE = args.has("--update");

/* ---------------------------------------------------------------- features */

/** Parse the workspace root's `[features]` table into name -> dependents. */
export function parseFeatureTable(text) {
  const table = {};
  const lines = text.split(/\r?\n/);
  let inFeatures = false;
  let pendingName = null;
  let buffer = "";
  for (const raw of lines) {
    // Comments carry quoted prose -- the `desktop` block quotes "keychain
    // unavailable" -- so a naive quote sweep reads it as a feature name.
    const line = raw.replace(/#.*$/, "").trim();
    if (/^\[[^\]]+\]$/.test(line)) {
      inFeatures = line === "[features]";
      continue;
    }
    if (!inFeatures || !line) continue;
    if (pendingName === null) {
      const m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
      if (!m) continue;
      pendingName = m[1];
      buffer = m[2];
    } else {
      buffer += " " + line;
    }
    // A value is complete once its brackets balance.
    const opens = (buffer.match(/\[/g) || []).length;
    const closes = (buffer.match(/\]/g) || []).length;
    if (opens === closes) {
      const inner = buffer.slice(buffer.indexOf("[") + 1, buffer.lastIndexOf("]"));
      table[pendingName] = [...inner.matchAll(/"([^"]+)"/g)]
        .map((x) => x[1])
        // A `dep:` or `crate/feature` entry is not a feature of this package.
        .filter((f) => !f.startsWith("dep:") && !f.includes("/"));
      pendingName = null;
      buffer = "";
    }
  }
  return table;
}

/** Transitively expand a set of feature names through the table. */
export function expand(names, table) {
  const out = new Set();
  const stack = [...names];
  while (stack.length) {
    const f = stack.pop();
    if (out.has(f)) continue;
    out.add(f);
    for (const child of table[f] || []) stack.push(child);
  }
  return out;
}

/**
 * Every `--features` value on a line that invokes the test runner.
 * `--features a,b` and `--features 'crate/a,b'` alike; `--all-features` widens
 * to everything and is returned as `*`.
 */
export function featuresOnTestLine(line) {
  if (!/cargo\s+test|['"]test['"]/.test(line)) return [];
  if (/--all-features/.test(line)) return ["*"];
  const out = [];
  // `--features desktop`, `--features=desktop`, and the argv-array form
  // `'--features', 'personas-core/desktop,...'` that run-rust-tests.mjs:193
  // uses. The separator class has to admit quotes and commas or that whole
  // invocation reads as enabling nothing.
  for (const m of line.matchAll(/--features['"]?[=,\s]+['"]?([A-Za-z0-9_,/-]+)/g)) {
    for (const f of m[1].split(",")) {
      if (!f) continue;
      out.push(f.includes("/") ? f.slice(f.indexOf("/") + 1) : f);
    }
  }
  return out;
}

/**
 * Every gated test module in one file's text, with its own test count.
 *
 * A FILE-level count over-reports. `twin.rs` opens a second, UNGATED
 * `#[cfg(test)]` module below its gated one and the ten tests in it do run, so
 * the scan stops at the next top-level `#[cfg`.
 */
export function countGatedTests(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#\[cfg\(all\(test,\s*feature\s*=\s*"([A-Za-z0-9_-]+)"\)\)\]/);
    if (!m) continue;
    let count = 0;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#\[cfg/.test(lines[j])) break;
      if (/^\s*#\[(tokio::)?test\]/.test(lines[j])) count++;
    }
    out.push({ line: i + 1, feature: m[1], tests: count });
  }
  return out;
}

/** GATING minus ENABLED. The pure comparison the gate's verdict rests on. */
export function uncoveredCells(gating, enabled) {
  const byFeature = new Map();
  for (const g of gating.filter((x) => !enabled.has(x.feature))) {
    const e = byFeature.get(g.feature) || { feature: g.feature, tests: 0, sites: [] };
    e.tests += g.tests;
    e.sites.push(`${g.file}:${g.line}`);
    byFeature.set(g.feature, e);
  }
  return [...byFeature.values()]
    .map((e) => ({ ...e, sites: e.sites.sort() }))
    .sort((a, b) => a.feature.localeCompare(b.feature));
}

/* ------------------------------------------------------------------- files */

const SKIP_DIRS = new Set(["node_modules", "target", ".git", "dist", "build", ".next", "coverage"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Forward slashes, always: the baseline is committed here and read on Linux. */
const rel = (file) => relative(REPO, file).split(sep).join("/");

// Every text that can invoke the test runner.
const INVOCATION_EXT = new Set([".yml", ".yaml", ".mjs", ".js", ".ts", ".sh", ".ps1", ".toml", ".json", ".just"]);

function collectEnabled(allFiles) {
  const enabled = new Set();
  const sites = [];
  for (const file of allFiles) {
    const ext = file.slice(file.lastIndexOf("."));
    if (!INVOCATION_EXT.has(ext)) continue;
    // A file that DESCRIBES an invocation is not a file that runs one, and
    // three kinds of file here describe them. Both were caught by the
    // self-test, and both make the gate report clean over the exact gap it
    // exists for — the assertion inheriting the instrument's own bias:
    //
    //   - the docs tree, which quantifies this gap in prose;
    //   - this check's own header, which quotes `--features ml` as the example
    //     of a cell nothing runs;
    //   - scripts/__tests__/, whose fixtures include `cargo test
    //     --all-features` as a parser case. Read as a real site that one widens
    //     ENABLED to every declared feature and empties the finding entirely.
    if (file.includes(`${sep}docs${sep}`)) continue;
    if (file.includes(`${sep}__tests__${sep}`)) continue;
    if (file.endsWith("check-test-feature-cells.mjs")) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("cargo test") && !text.includes("'test'") && !text.includes('"test"')) continue;
    for (const line of text.split(/\r?\n/)) {
      const names = featuresOnTestLine(line);
      if (!names.length) continue;
      for (const n of names) enabled.add(n);
      sites.push({ file: rel(file), features: names });
    }
  }
  return { enabled, sites };
}

function collectGating(allFiles) {
  const found = [];
  for (const file of allFiles) {
    if (!file.endsWith(".rs")) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("cfg(all(test")) continue;
    for (const g of countGatedTests(text)) found.push({ ...g, file: rel(file) });
  }
  return found;
}

/* -------------------------------------------------------------------- main */

// Same guard as check-command-feature-coverage.mjs:468 — the pure halves above
// are imported by scripts/__tests__/check-test-feature-cells.test.mjs, and a
// module that gates on import would run the gate inside its own self-test.
const IS_MAIN =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (!IS_MAIN) {
  // Importers get the pure functions and nothing else.
} else {
const allFiles = walk(REPO);
const table = parseFeatureTable(readFileSync(CARGO_TOML, "utf8"));
const { enabled: enabledDirect, sites } = collectEnabled(allFiles);
const enabled = enabledDirect.has("*") ? new Set(Object.keys(table)) : expand(enabledDirect, table);
const gating = collectGating(allFiles);
const current = uncoveredCells(gating, enabled);

if (REPORT) {
  console.log("features declared in [features]:", Object.keys(table).sort().join(" "));
  console.log("features enabled by some `cargo test`:", [...enabled].sort().join(" ") || "(none)");
  console.log("\ninvocation sites read:");
  for (const s of sites) console.log(`  ${s.file}  --features ${s.features.join(",")}`);
  console.log("\ntest-gating features:");
  for (const g of gating) console.log(`  ${g.file}:${g.line}  feature="${g.feature}"  ${g.tests} test(s)`);
  console.log("");
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { cells: [] };

if (UPDATE) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note: "Uncovered test-feature cells. Entries are removed by making them true, never by editing this file alone.",
        cells: current,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`baseline written: ${current.length} uncovered feature cell(s)`);
  process.exit(0);
}

const key = (c) => `${c.feature}:${c.tests}:${c.sites.join(",")}`;
const baseKeys = new Set((baseline.cells || []).map(key));
const currKeys = new Set(current.map(key));
const risen = current.filter((c) => !baseKeys.has(key(c)));
const dropped = (baseline.cells || []).filter((c) => !currKeys.has(key(c)));

let failed = false;

if (risen.length) {
  failed = true;
  console.error("\nA cargo feature gates test code that no `cargo test` invocation enables.");
  console.error("These tests are in no cell of any reported result:\n");
  for (const c of risen) {
    console.error(`  feature "${c.feature}" — ${c.tests} test(s) gated`);
    for (const s of c.sites) console.error(`      ${s}`);
  }
  console.error(
    "\nClose it by adding a test cell on the feature axis (a `cargo test --features <shape>`\n" +
      "leg beside the existing `cargo check` one), not by widening this gate's baseline.\n" +
      "Deciding NOT to run a cell is legitimate; recording the decision here is the price.",
  );
}

if (dropped.length) {
  failed = true;
  console.error("\nBaseline entries no longer found. Either they were closed (run --update), or this");
  console.error("check's matcher has stopped matching, which looks identical from here:\n");
  for (const c of dropped) console.error(`  feature "${c.feature}" — ${c.tests} test(s) at ${c.sites.join(", ")}`);
}

if (!failed) {
  const total = current.reduce((n, c) => n + c.tests, 0);
  console.log(
    current.length
      ? `ok — ${current.length} uncovered test-feature cell(s), ${total} gated test(s), all at baseline`
      : "ok — every test-gating feature is enabled by some `cargo test` invocation",
  );
}

process.exit(failed ? 1 : 0);
}
