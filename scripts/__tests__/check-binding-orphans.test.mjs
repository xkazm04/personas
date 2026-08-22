// Self-test for scripts/check-binding-orphans.mjs, its Rust scanner
// (scripts/lib/rustTsExports.mjs) and the barrel generator
// (scripts/generate-bindings-index.mjs).
//
// Every case here is a shape that ACTUALLY EXISTS in this tree and that a
// plausible matcher gets wrong. Three of them are traps that were hit while
// building this, and all three fail SILENTLY in production: a missed export
// turns a live binding into a phantom orphan, a phantom export hides a real
// one, and an empty walk makes the orphan set EMPTY — which is indistinguishable
// from a clean tree.
//
// Run:  node scripts/__tests__/check-binding-orphans.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkBindingOrphans,
  parseAllowlist,
  isFailure,
} from "../check-binding-orphans.mjs";
import { discoverTsExports } from "../lib/rustTsExports.mjs";
import { listBindingModules, renderIndex } from "../generate-bindings-index.mjs";

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

const roots = [];
/** Build a throwaway tree of `{ relPath: contents }` and return its root. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "bindorph-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body, "utf-8");
  }
  roots.push(root);
  return root;
}
const names = (root) => discoverTsExports(root).exports.map((e) => e.name).sort();

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 1: THE MULTI-LINE ATTRIBUTE TRAP (src/radio/mod.rs:49)");
{
  // A line-shaped "is this an attribute?" test reads `tag = "kind",` as the
  // item, gives up, and reports StationSource as having no source — i.e. as an
  // orphan. Bracket depth is what skips an attribute, not line shape.
  const root = fixture({
    "a.rs": `
#[derive(Serialize, TS)]
#[ts(export)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StationSource {
    YoutubeTracks { tracks: Vec<Track> },
}
`,
  });
  expect("multi-line #[serde(...)] is skipped", JSON.stringify(names(root)) === '["StationSource"]', names(root).join(","));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 2: doc comments, line comments and nested-bracket attributes");
{
  const root = fixture({
    "a.rs": `
#[ts(export)]
/// A doc comment sitting between the attribute and the item.
pub struct Alpha { pub a: String }

#[ts(export)]
// A line comment there instead.
pub enum Beta { X }

#[ts(export)]
#[cfg(all(not(feature = "x"), feature = "y"))]
/// Attribute WITH NESTED BRACKETS, then a doc comment, then the item.
pub(crate) struct Gamma { pub a: String }

#[ts(export)]
pub type Delta = String;
`,
  });
  expect("all four are found", JSON.stringify(names(root)) === '["Alpha","Beta","Delta","Gamma"]', names(root).join(","));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 3: THE `Err` TRAP — macro-generated exports, and the doc comment that looks like a call");
{
  // `#[ts(export)]` appears ONCE inside declare_lifecycle! and produces THREE
  // real bindings whose names exist only at the call sites. The documented
  // reason an earlier count of this population was wrong by 19.
  //
  // The trap: the macro's own rustdoc shows a usage example, `/// my_macro! {`.
  // Treated as a call site it resolved forward to `type Err = String` inside the
  // macro body and reported a phantom binding named `Err`.
  const root = fixture({
    "m.rs": `
/// Example:
/// \`\`\`
/// my_macro! {
///     pub enum Example, entity = "x" { A("a") => [] }
/// }
/// \`\`\`
#[macro_export]
macro_rules! my_macro {
    (
        pub enum $Name:ident, entity = $entity:literal { $( $V:ident ( $s:literal ) => [ $( $T:ident ),* ] ),+ }
    ) => {
        #[derive(Serialize, TS)]
        #[ts(export)]
        pub enum $Name { $( $V, )+ }

        impl std::str::FromStr for $Name {
            type Err = String;
            fn from_str(s: &str) -> Result<Self, Self::Err> { unimplemented!() }
        }
    };
}

my_macro! {
    pub enum RealOne, entity = "one" { A("a") => [] }
}
`,
    "n.rs": `
crate::my_macro! {
    /// Docs on the generated type.
    pub enum RealTwo, entity = "two" { B("b") => [] }
}
`,
    // An ABBREVIATED doc example, whose braces do not balance. The brace-bounded
    // scan cannot save this one — only the "a comment is not a call site" filter
    // can — so this fixture is what keeps that filter honest. Without it the walk
    // runs past the comment and reports the next real item as macro-generated.
    "p.rs": `
/// Usage:
/// \`\`\`ignore
/// my_macro! {
///     pub enum Sketched, entity = "s" { A("a") => [] }
/// (closing brace elided)
#[derive(Serialize)]
pub struct NotGenerated { pub a: String }
`,
    // A paren-delimited invocation that generates nothing of its own. If the
    // invocation body is bounded by braces ALONE, this one never "starts", the
    // scan runs to end of file, and the next unrelated item is reported as
    // macro-generated.
    "q.rs": `
my_macro!(NoItemsHere);

#[derive(Serialize)]
pub struct AlsoNotGenerated { pub a: String }
`,
  });
  const got = names(root);
  expect("both macro call sites resolve", got.includes("RealOne") && got.includes("RealTwo"), got.join(","));
  expect("the rustdoc usage example produces NO phantom `Err`", !got.includes("Err"), got.join(","));
  expect("an unbalanced doc example does not adopt the next real item", !got.includes("NotGenerated"), got.join(","));
  expect("a paren-form invocation does not adopt the next item", !got.includes("AlsoNotGenerated"), got.join(","));
  expect("nothing else leaks out", got.length === 2, got.join(","));
  const r = discoverTsExports(root);
  expect("the macro template is reported, not counted as an export", r.macroTemplates.length === 1 && r.unresolved.length === 0);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 4: the `export` TOKEN, not the literal `#[ts(export)]`");
{
  const root = fixture({
    "a.rs": `
#[ts(export, concrete(T = String))]
pub struct WithArgs { pub a: String }

#[ts(type = "number")]
pub struct NotExported { pub a: String }

// #[ts(export)] in a comment
pub struct Commented { pub a: String }
`,
  });
  expect("args after `export` are fine; `type = ...` alone is not an export", JSON.stringify(names(root)) === '["WithArgs"]', names(root).join(","));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 5: #[ts(rename)] / #[ts(export_to)] break the name→file mapping and must FAIL");
{
  const root = fixture({ "a.rs": '#[ts(export, rename = "Other")]\npub struct Thing { pub a: String }\n' });
  const bindings = fixture({ "Thing.ts": "export type Thing = {};\n" });
  const r = checkBindingOrphans({
    rustRoot: root,
    bindingsDir: bindings,
    orphanAllowlist: [],
    missingAllowlist: [],
    minRustExports: 0,
    minBindingFiles: 0,
  });
  expect("the rename is reported", r.renamed.length === 1, JSON.stringify(r.renamed));
  expect("and it fails the run even with zero orphans", isFailure(r) && r.orphans.length === 0);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 6: orphan + missing detection, and the two-sided allowlist");
{
  const rust = fixture({
    "a.rs": "#[ts(export)]\npub struct Kept { pub a: String }\n\n#[ts(export)]\npub struct NeverGenerated { pub a: String }\n",
  });
  const bindings = fixture({
    "Kept.ts": "export type Kept = {};\n",
    "Gone.ts": "export type Gone = {};\n",
    "index.ts": 'export type { Kept } from "./Kept";\n',
  });
  const run = (orphanAllowlist, missingAllowlist) =>
    checkBindingOrphans({
      rustRoot: rust,
      bindingsDir: bindings,
      orphanAllowlist,
      missingAllowlist,
      minRustExports: 0,
      minBindingFiles: 0,
    });

  const bare = run([], []);
  expect("the orphan is found", JSON.stringify(bare.orphans) === '["Gone"]', JSON.stringify(bare.orphans));
  expect("the missing type is found", bare.missing.length === 1 && bare.missing[0].name === "NeverGenerated");
  expect("index.ts is never an orphan", !bare.orphans.includes("index"));
  expect("an unlisted orphan FAILS", isFailure(bare) && bare.unlistedOrphans.length === 1);

  const allowed = run(["Gone"], ["NeverGenerated"]);
  expect("allowlisting both makes it green", !isFailure(allowed), JSON.stringify(allowed));

  const stale = run(["Gone", "AlreadyFixed"], ["NeverGenerated"]);
  expect("an allowlisted name that is NOT an orphan FAILS", isFailure(stale) && JSON.stringify(stale.staleOrphans) === '["AlreadyFixed"]');

  const staleMissing = run(["Gone"], ["NeverGenerated", "AlsoFixed"]);
  expect("same for the missing list", isFailure(staleMissing) && JSON.stringify(staleMissing.staleMissing) === '["AlsoFixed"]');
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 7: THE GREEN-FOR-NOTHING TRAP — an empty binding dir has ZERO orphans");
{
  const rust = fixture({ "a.rs": "#[ts(export)]\npub struct Kept { pub a: String }\n" });
  const bindings = fixture({ ".keep": "" });
  const r = checkBindingOrphans({
    rustRoot: rust,
    bindingsDir: bindings,
    orphanAllowlist: [],
    missingAllowlist: ["Kept"],
    minRustExports: 0,
    minBindingFiles: 1,
  });
  expect("zero binding files ⇒ zero orphans (the whole problem)", r.orphans.length === 0);
  expect("but the floor catches it and FAILS anyway", r.belowFloor && isFailure(r));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 8: allowlist parsing");
{
  const parsed = parseAllowlist("# header\n\nFooType   # src-tauri/src/x.rs:12\n   BarType\n\n# trailing\n");
  expect("comments and blanks dropped, inline comments trimmed", JSON.stringify(parsed) === '["FooType","BarType"]', JSON.stringify(parsed));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 9: the barrel is deterministic, and NOT in code-unit order");
{
  const rendered = renderIndex(["Beta", "Alpha"]);
  expect("renderIndex sorts nothing — order is the caller's", rendered.includes('"./Beta"') && rendered.indexOf("Beta") < rendered.indexOf("Alpha"));
  expect("output is LF and ends with a newline", !rendered.includes("\r") && rendered.endsWith("\n"));

  const dir = fixture({
    "AutoRunStatus.ts": "export type AutoRunStatus = {};\n",
    "AutomationDeployStatus.ts": "export type AutomationDeployStatus = {};\n",
    "index.ts": "",
  });
  const mods = listBindingModules(dir);
  // Array#sort() puts AutoRunStatus first ('R' < 'm' by code unit); the pinned
  // Intl.Collator("en") puts AutomationDeployStatus first, which is what the
  // committed file holds. These first disagree at index 60 of the real barrel.
  expect(
    "collator order, not code-unit order",
    JSON.stringify(mods) === '["AutomationDeployStatus","AutoRunStatus"]',
    JSON.stringify(mods),
  );
  expect("index.ts is excluded from the barrel", !mods.includes("index"));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nCase 10: the REAL tree is green against the committed allowlists");
{
  const r = checkBindingOrphans();
  expect(
    `real tree passes (${r.rustExportCount} exports, ${r.bindingFileCount} bindings, ${r.orphans.length} allowlisted orphans, ${r.missing.length} allowlisted missing)`,
    !isFailure(r),
    JSON.stringify({
      unlistedOrphans: r.unlistedOrphans,
      staleOrphans: r.staleOrphans,
      unlistedMissing: r.unlistedMissing,
      staleMissing: r.staleMissing,
      unresolved: r.unresolved,
      renamed: r.renamed,
    }),
  );
  expect("the real barrel is byte-identical to a fresh render", renderIndex(listBindingModules()) === (await import("node:fs")).readFileSync(new URL("../../src/lib/bindings/index.ts", import.meta.url), "utf-8"));
}

for (const r of roots) rmSync(r, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
