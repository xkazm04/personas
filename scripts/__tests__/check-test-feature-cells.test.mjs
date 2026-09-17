#!/usr/bin/env node
// Self-test for scripts/check-test-feature-cells.mjs.
//
// This gate reports an ABSENCE — a cell of the configuration space that no
// `cargo test` invocation covers — so every wrong answer it can give looks
// like a clean tree. The cases below are the traps hit while building it, each
// one a way the gate goes quiet over a real gap.
//
//   1. THE GATE MUST FIRE, AND MUST GO QUIET. Measured on the real tree: with
//      no invocation enabling `ml` the gate exits 1 naming 25 tests at 4 sites;
//      with one `cargo test --features desktop-full` line present it exits 0.
//      A gate that cannot pass is as useless as one that cannot fail.
//   2. A FILE-LEVEL TEST COUNT OVER-REPORTS. twin.rs opens a second, UNGATED
//      `#[cfg(test)]` module below its gated one; its ten tests DO run. Counting
//      to end-of-file inflates the finding, and an inflated finding is what gets
//      the gate deleted.
//   3. `desktop-full` MUST EXPAND TRANSITIVELY to `ml`, or the one invocation
//      that would close the gap reads as not closing it.
//   4. `dep:` AND `crate/feature` ENTRIES ARE NOT LOCAL FEATURES. Letting
//      `dep:image` into the table makes a `#[cfg(feature = "image")]` read as
//      satisfied.
//   5. CARGO.TOML COMMENTS CARRY QUOTED PROSE (the desktop block quotes
//      "keychain unavailable"); a naive quote sweep reads it as a feature name.
//   6. THE SCANNER MUST NOT READ ITS OWN DOC COMMENT. This gate's header quotes
//      `--features ml` as the example of a cell nothing runs. Read as an
//      invocation site it certifies its own blind spot — the assertion
//      inheriting the instrument's bias — and the gate reports clean over the
//      exact gap it was written for. That happened on the first run.
//
// Run:  node scripts/__tests__/check-test-feature-cells.test.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  countGatedTests,
  expand,
  featuresOnTestLine,
  parseFeatureTable,
  uncoveredCells,
} from "../check-test-feature-cells.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let passed = 0,
  failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok ${label}`);
  } else {
    failed++;
    failures.push(`${label}${detail ? ` -- ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------- parseFeatureTable */

console.log("parseFeatureTable");
{
  const toml = [
    "[package]",
    'name = "x"',
    "[features]",
    "default = []",
    "# Forwards the OS-keychain path. Without this, the crate compiles its",
    '# mobile "keychain unavailable" stub instead.',
    "desktop = [",
    '    "personas-core/desktop",',
    '    "dep:arboard",',
    '    "dep:image",',
    "]",
    'desktop-full = ["desktop", "ml", "p2p"]',
    'ml = ["dep:fastembed"]',
    "p2p = []",
    "[dependencies]",
    'serde = "1"',
  ].join("\n");
  const t = parseFeatureTable(toml);

  expect("the [features] table is found", Boolean(t["desktop-full"]));
  expect("a later [section] ends the table", t.serde === undefined);
  // Trap 5.
  expect(
    'quoted prose in a comment is not a feature ("keychain unavailable")',
    !Object.keys(t).some((k) => k.includes("keychain")) &&
      !Object.values(t).flat().some((v) => v.includes("keychain")),
    JSON.stringify(t),
  );
  // Trap 4.
  expect("`dep:` entries are excluded", !t.desktop.includes("dep:arboard") && !t.desktop.includes("arboard"));
  expect("`crate/feature` entries are excluded", !t.desktop.some((f) => f.includes("/")));
  expect("a multi-line value is read whole", t.desktop.length === 0, JSON.stringify(t.desktop));

  // Trap 3.
  const e = expand(["desktop-full"], t);
  expect("desktop-full expands to ml", e.has("ml"));
  expect("desktop-full expands to p2p", e.has("p2p"));
  expect("desktop-full expands to desktop", e.has("desktop"));
  expect("desktop-full does NOT reach test-automation", !e.has("test-automation"));
  expect("expand terminates on an unknown feature", expand(["nope"], t).has("nope"));
}

/* ------------------------------------------------------ featuresOnTestLine */

console.log("featuresOnTestLine");
expect(
  "a plain cargo test line",
  featuresOnTestLine("run: cargo test --workspace --features desktop --no-fail-fast").join() === "desktop",
);
expect(
  "a comma list",
  featuresOnTestLine("cargo test --features desktop,ml").join() === "desktop,ml",
);
expect(
  "package-qualified features are taken bare",
  featuresOnTestLine("'test', '--features', 'personas-core/desktop,personas-db/desktop'").join() === "desktop,desktop",
);
expect("--all-features widens to everything", featuresOnTestLine("cargo test --all-features").join() === "*");
expect("a non-test line contributes nothing", featuresOnTestLine("cargo check --features ml").length === 0);
expect("a bare cargo test contributes nothing", featuresOnTestLine("cargo test --workspace").length === 0);

/* ---------------------------------------------------------- countGatedTests */

console.log("countGatedTests");
{
  // Trap 2, in miniature: a gated module of two tests, then an UNGATED
  // #[cfg(test)] module of three. Counting to EOF returns 5.
  const rs = [
    "pub fn f() {}",
    '#[cfg(all(test, feature = "ml"))]',
    "mod tests {",
    "    #[test]",
    "    fn a() {}",
    "    #[tokio::test]",
    "    async fn b() {}",
    "}",
    "#[cfg(test)]",
    "mod more {",
    "    #[test]",
    "    fn c() {}",
    "    #[test]",
    "    fn d() {}",
    "    #[test]",
    "    fn e() {}",
    "}",
  ].join("\n");
  const g = countGatedTests(rs);
  expect("one gated module found", g.length === 1, JSON.stringify(g));
  expect("the gating feature is read", g[0]?.feature === "ml");
  expect("the count stops at the next top-level #[cfg (2, not 5)", g[0]?.tests === 2, String(g[0]?.tests));
  expect("#[tokio::test] counts", g[0]?.tests === 2);
  expect("an ungated #[cfg(test)] module is not reported", !g.some((x) => x.feature === undefined));
  expect("a file with no gated module yields nothing", countGatedTests("#[cfg(test)]\nmod t { #[test] fn a(){} }").length === 0);
}

/* ------------------------------------------------------------ uncoveredCells */

console.log("uncoveredCells");
{
  const gating = [
    { file: "a.rs", line: 10, feature: "ml", tests: 4 },
    { file: "b.rs", line: 20, feature: "ml", tests: 12 },
    { file: "c.rs", line: 30, feature: "desktop", tests: 6 },
  ];
  const open = uncoveredCells(gating, new Set(["desktop"]));
  expect("a covered feature is not reported", !open.some((c) => c.feature === "desktop"));
  expect("an uncovered feature is reported once", open.length === 1 && open[0].feature === "ml");
  expect("its tests are summed across sites", open[0].tests === 16, String(open[0]?.tests));
  expect("its sites are listed and sorted", open[0].sites.join() === "a.rs:10,b.rs:20");
  // The green direction: nothing is reported once every gating feature is enabled.
  expect("all covered yields nothing", uncoveredCells(gating, new Set(["ml", "desktop"])).length === 0);
}

/* ------------------------------------ the gate end to end, both directions */

console.log("the gate, on this tree");
{
  const run = (args) => {
    try {
      const out = execFileSync(process.execPath, [join(REPO, "scripts", "check-test-feature-cells.mjs"), ...args], {
        cwd: REPO,
        encoding: "utf8",
      });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };

  // Trap 1, quiet direction: at the committed baseline the gate passes, so it
  // does not block today's build while the gap is worked down.
  const atBaseline = run([]);
  expect("green at the committed baseline", atBaseline.code === 0, atBaseline.out.trim());

  // Trap 6: the scanner must not have read its own doc comment. If it had, the
  // baseline would hold zero cells and the gap would read as closed.
  const baseline = JSON.parse(readFileSync(join(REPO, "scripts", "test-feature-cells-baseline.json"), "utf8"));
  expect(
    "the baseline records a real uncovered cell (the gate did not read its own header)",
    (baseline.cells ?? []).some((c) => c.tests > 0),
    JSON.stringify(baseline.cells),
  );

  // Trap 1, loud direction: the report lists the gating sites it found, so a
  // matcher that has stopped matching is visible rather than silent.
  const report = run(["--report"]);
  expect("--report names the gating sites", /feature="ml"/.test(report.out), report.out.trim().slice(0, 200));
  expect(
    "--report names the invocation sites it read",
    /--features desktop/.test(report.out),
    report.out.trim().slice(0, 200),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error("\nfailures:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
