#!/usr/bin/env node
// Self-test for scripts/check-command-registration.mjs and its definition
// scanner (scripts/lib/rustCommandDefs.mjs).
//
// Every case here is a shape that ACTUALLY EXISTS in src-tauri/ and that a
// plausible matcher gets wrong. Two of them are the traps that were hit while
// building this, and both fail SILENTLY in production -- a missed definition
// turns a live command into a phantom "registered but undefined", and a phantom
// definition turns a doc example into a phantom orphan. Neither throws.
//
// Run:  node scripts/__tests__/check-command-registration.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCommandRegistration, parseAllowlist, isFailure } from "../check-command-registration.mjs";
import { discoverCommandDefinitions } from "../lib/rustCommandDefs.mjs";

let passed = 0,
  failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok ${label}`);
  } else {
    failed++;
    failures.push({ label, detail });
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Build a throwaway tree of `{ relPath: contents }` and return its root. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "cmdreg-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body, "utf-8");
  }
  return root;
}

const roots = [];
const build = (files) => {
  const r = fixture(files);
  roots.push(r);
  return r;
};
const run = (root, allowlist = []) =>
  checkCommandRegistration({ rustRoot: root, srcRoot: root, allowlist, minDefinitions: 0 });
const names = (root) => discoverCommandDefinitions(root).definitions.map((d) => d.name).sort();

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 1: THE 7-MISS TRAP — a doc comment between the attribute and the fn");
{
  // `/#\[tauri::command\]\s*(?:#\[[^\]]*\]\s*)*(?:pub )?fn (\w+)/` allows only
  // `#[...]` in between and misses every one of these. Seven real definitions
  // in this tree have this shape; each produced a phantom "registered but
  // undefined" report.
  const root = build({
    "a.rs": `
#[tauri::command]
/// A doc comment sitting between the attribute and the fn.
pub fn alpha() {}

#[tauri::command]
// A line comment there instead.
pub async fn beta() {}

#[tauri::command]
#[cfg(all(not(feature = "x"), feature = "y"))]
/// Attribute WITH NESTED BRACKETS, then a doc comment, then the fn.
pub(crate) fn gamma() {}
`,
  });
  expect("all three are found", JSON.stringify(names(root)) === '["alpha","beta","gamma"]', names(root).join(","));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 2: MASKING — the attribute inside a doc comment or a string is not a definition");
{
  // macros/src/lib.rs shows `#[tauri::command]` four times in the `#[requires]`
  // rustdoc; core/src/context_fingerprint.rs and commands/testing/mod.rs quote
  // it too. Twelve such sites exist in src-tauri/. Unmasked, each becomes an
  // orphan with a real-looking file:line.
  const root = build({
    "b.rs": `
/// Usage:
///
/// \`\`\`ignore
/// #[tauri::command]
/// pub fn phantom_from_docs() {}
/// \`\`\`
pub fn real_thing() {}

fn emits() -> &'static str {
    "#[tauri::command]\\npub fn phantom_from_a_string() {}"
}

/* #[tauri::command]
   pub fn phantom_from_a_block_comment() {} */

#[tauri::command]
pub fn the_only_real_command() {}
`,
  });
  expect("only the real one survives", JSON.stringify(names(root)) === '["the_only_real_command"]', names(root).join(","));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 3: #[cfg(test)] modules are not definitions");
{
  const root = build({
    "c.rs": `
#[tauri::command]
pub fn live_one() {}

#[cfg(test)]
mod tests {
    use super::*;
    #[tauri::command]
    pub fn only_in_tests() {}
}
`,
  });
  expect("the test-module command is excluded", JSON.stringify(names(root)) === '["live_one"]', names(root).join(","));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 4: THE isRustTestFile TRAP — a command file whose NAME looks like a test");
{
  // Applying `isRustTestFile()` to the definition side drops nine REAL,
  // REGISTERED commands purely on filename: commands/companion/browser_test.rs,
  // commands/execution/test_suites.rs and test_automation.rs. Each then reports
  // as "registered but not defined".
  const root = build({
    "commands/browser_test.rs": `
#[tauri::command]
pub fn browser_bridge_status() {}
`,
    "test_suites.rs": `
#[tauri::command]
pub fn list_test_suites() {}
`,
    "tests/real_test_dir.rs": `
#[tauri::command]
pub fn not_a_real_command() {}
`,
    "lib.rs": `
pub fn run() {
    ipc_auth::wrap_invoke_handler(tauri::generate_handler![
        commands::browser_test::browser_bridge_status,
        list_test_suites,
    ])
}
`,
  });
  const found = names(root);
  expect(
    "filename-shaped test files still count as definitions",
    found.includes("browser_bridge_status") && found.includes("list_test_suites"),
    found.join(","),
  );
  expect("a real tests/ DIRECTORY is excluded", !found.includes("not_a_real_command"), found.join(","));

  const r = run(root);
  expect("registered count is 2", r.registeredCount === 2, String(r.registeredCount));
  expect("no orphans, no phantoms", r.orphans.length === 0 && r.unlisted.length === 0, JSON.stringify(r.orphans));
  expect("the run is green", !isFailure(r));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 5: the gate itself — an unregistered command is a finding");
{
  const root = build({
    "cmds.rs": `
#[tauri::command]
pub fn registered_one() {}

#[tauri::command]
pub fn forgotten_one() {}
`,
    "lib.rs": `
tauri::generate_handler![
    cmds::registered_one,
]
`,
  });

  const bare = run(root);
  expect("the orphan is found", bare.orphans.map((o) => o.name).join() === "forgotten_one");
  expect("it is unlisted", bare.unlisted.join() === "forgotten_one");
  expect("an unlisted orphan FAILS the run", isFailure(bare));
  expect("it reports a real file:line", bare.orphans[0].file === "cmds.rs" && bare.orphans[0].line === 5, JSON.stringify(bare.orphans[0]));

  const allowed = run(root, ["forgotten_one"]);
  expect("allowlisting it clears the run", !isFailure(allowed) && allowed.unlisted.length === 0);

  const stale = run(root, ["forgotten_one", "registered_one"]);
  expect("a name that is NO LONGER an orphan is stale", stale.stale.join() === "registered_one");
  expect("a stale entry FAILS the run (silent drops are findings too)", isFailure(stale));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 6: a multi-block, multi-file registration (lib.rs is about to be split)");
{
  const root = build({
    "cmds.rs": `
#[tauri::command]
pub fn from_block_a() {}

#[tauri::command]
pub fn from_block_b() {}
`,
    "handlers/a.rs": `pub fn a() { tauri::generate_handler![cmds::from_block_a,] }`,
    "handlers/b.rs": `pub fn b() { tauri::generate_handler![cmds::from_block_b,] }`,
  });
  const r = run(root);
  expect("both blocks are unioned", r.registeredCount === 2, String(r.registeredCount));
  expect("nothing is orphaned", r.orphans.length === 0, JSON.stringify(r.orphans));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 7: the floor — a scan that sees nothing must not report a clean tree");
{
  const root = build({ "empty.rs": "pub fn nothing() {}\n" });
  const r = checkCommandRegistration({ rustRoot: root, srcRoot: root, allowlist: [], minDefinitions: 1 });
  expect("0 definitions is below the floor", r.belowFloor);
  expect("below the floor FAILS even with zero orphans", isFailure(r) && r.orphans.length === 0);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 8: allowlist parsing");
{
  const parsed = parseAllowlist(
    "# a header comment\n\nfoo_command   # src-tauri/src/x.rs:12\n   bar_command\n\n# trailing\n",
  );
  expect("comments and blanks are dropped, inline comments trimmed", JSON.stringify(parsed) === '["foo_command","bar_command"]', JSON.stringify(parsed));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 9: the REAL tree is green against the committed allowlist");
{
  const r = checkCommandRegistration();
  expect(`real tree passes (${r.definitionCount} defs, ${r.registeredCount} registered, ${r.orphans.length} allowlisted orphans)`, !isFailure(r), JSON.stringify({ unlisted: r.unlisted, stale: r.stale, unresolved: r.unresolved }));
}

for (const r of roots) rmSync(r, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
