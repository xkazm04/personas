#!/usr/bin/env node
// Self-test for scripts/check-command-feature-coverage.mjs.
//
// The pure halves are the ones a plausible implementation gets wrong SILENTLY,
// and silence here is the whole hazard: this gate's job is to report an absence,
// so every wrong answer it can give looks like a clean tree. The cases below are
// the traps hit while building it.
//
//   1. A cfg predicate the evaluator does not model must return null, not false.
//      Returning false invents an exposure; returning true hides every real one.
//   2. `desktop-full` must expand transitively, and must NOT pick up
//      `test-automation` -- that expansion is what decides whether the shipped
//      binary is judged against the right feature set.
//   3. Cargo.toml comments contain quoted prose ("keychain unavailable" sits in
//      the desktop block), and a naive quote sweep reads it as a feature name.
//   4. `dep:` and `crate/feature` entries are not local features and must not
//      enter the set, or a `#[cfg(feature = "image")]` would read as satisfied
//      because `dep:image` was listed.
//
// Run:  node scripts/__tests__/check-command-feature-coverage.test.mjs

import {
  evalCfg,
  parseCargoFeatures,
  expandFeatures,
} from "../check-command-feature-coverage.mjs";

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

const F = (...names) => ({ features: new Set(names), debugAssertions: false });

console.log("evalCfg");
expect("feature present", evalCfg('feature = "p2p"', F("p2p")) === true);
expect("feature absent", evalCfg('feature = "p2p"', F("desktop")) === false);
expect(
  "debug_assertions is false for a shipped build",
  evalCfg("debug_assertions", F("desktop")) === false,
);
expect(
  "debug_assertions honours the flag",
  evalCfg("debug_assertions", { features: new Set(), debugAssertions: true }) === true,
);
expect("any()", evalCfg('any(feature = "ml", feature = "p2p")', F("p2p")) === true);
expect("any() none", evalCfg('any(feature = "ml", feature = "p2p")', F("desktop")) === false);
expect("all()", evalCfg('all(feature = "ml", feature = "p2p")', F("ml")) === false);
expect("not()", evalCfg('not(feature = "ml")', F("desktop")) === true);
expect(
  "nested any(all())",
  evalCfg('any(all(feature = "ml", feature = "p2p"), feature = "desktop")', F("desktop")) === true,
);
// The load-bearing one: an unmodelled predicate is null, never a guess.
expect(
  "unmodelled predicate returns null",
  evalCfg('target_os = "android"', F("desktop")) === null,
  "a guess here either invents an exposure or hides every real one",
);
expect(
  "unmodelled predicate inside any() propagates null",
  evalCfg('any(target_os = "android", feature = "p2p")', F("desktop")) === null,
);

console.log("parseCargoFeatures / expandFeatures");
const TOML = `
[package]
name = "x"

[features]
default = []
# Core desktop feature. Without this, that crate compiles its mobile
# "keychain unavailable" stub instead.
desktop = ["personas-core/desktop", "dep:arboard", "dep:image"]
ml = ["dep:ort"]
p2p = ["dep:quinn"]
desktop-full = ["desktop", "ml", "p2p"]
test-automation = ["dep:xcap", "dep:image"]
daemon = ["desktop-full"]

[dependencies]
serde = "1"
`;
const table = parseCargoFeatures(TOML);
expect("parses every feature", table.size === 7, `got ${table.size}: ${[...table.keys()]}`);
expect("stops at the next section", !table.has("serde"));

const full = expandFeatures(["desktop-full"], table);
expect("expands transitively", full.has("desktop") && full.has("ml") && full.has("p2p"));
expect(
  "desktop-full does NOT imply test-automation",
  !full.has("test-automation"),
  "this is what decides whether a shipped binary is judged correctly",
);
expect(
  "comment prose is not a feature",
  !full.has("keychain unavailable"),
  `got ${[...full].join(", ")}`,
);
expect("dep: entries are not local features", !full.has("dep:arboard") && !full.has("image"));
expect("crate/feature entries are not local features", !full.has("personas-core/desktop"));

const daemon = expandFeatures(["daemon"], table);
expect("two-hop expansion", daemon.has("ml") && daemon.has("p2p") && daemon.has("desktop"));
expect("empty feature list expands to nothing", expandFeatures([], table).size === 0);

console.log("");
if (failed) {
  console.error(`${failed} failure(s):\n` + failures.map((f) => `  ${f}`).join("\n"));
  process.exit(1);
}
console.log(`All ${passed} assertions passed.`);
