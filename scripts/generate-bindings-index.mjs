#!/usr/bin/env node
/**
 * generate-bindings-index — regenerates `src/lib/bindings/index.ts`, the barrel
 * that re-exports every ts-rs binding.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Until this script, the barrel was the ONE artifact in the ts-rs pipeline with
 * no automation at all. Its header comment quoted a shell one-liner and nothing
 * ran it; no gate compared it to the directory. So every binding add or removal
 * rotted it silently: a new binding was simply absent from the barrel, and a
 * deleted one left an `export type … from "./Gone"` that breaks `tsc` — which is
 * how it was noticed, by a deletion in the lane before this one.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM IS THE CONTRACT
 * ---------------------------------------------------------------------------
 * No timestamps, no counts in the header, LF endings, one fixed sort. `--check`
 * is therefore a byte comparison, the only kind of freshness check that cannot
 * drift on a rerun, and a no-op run rewrites the same bytes and leaves the tree
 * clean.
 *
 * The sort is `Intl.Collator("en")`, which reproduces the committed file
 * exactly. A bare `.localeCompare(b)` would too **on this machine** — it uses
 * the runtime's default locale, so it is a machine-dependent sort wearing a
 * deterministic-looking API, and it would reorder the file on a box with a
 * different default. The collator is pinned for that reason. Note this is NOT
 * `Array#sort()`'s code-unit order: they first disagree at index 60
 * (`AutomationDeployStatus` vs `AutoRunStatus`).
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT IN THE BARREL
 * ---------------------------------------------------------------------------
 * Top-level `*.ts` files only, `index.ts` excluded. ts-rs also writes
 * `src/lib/bindings/serde_json/JsonValue.ts` — a nested module for
 * `serde_json::Value` — which the barrel has never exported and which the walk
 * deliberately does not descend into. Adding it would change the public surface
 * of `@/lib/bindings`, which is a decision, not a codegen detail.
 *
 * Usage:
 *   node scripts/generate-bindings-index.mjs           # write
 *   node scripts/generate-bindings-index.mjs --check   # byte-compare, exit 1 on drift
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
export const BINDINGS_DIR = join(ROOT, "src", "lib", "bindings");
const INDEX_REL = "src/lib/bindings/index.ts";

/**
 * A floor on how many bindings the walk must SEE. Below it the result is
 * untrustworthy and the run refuses rather than writing — because an empty
 * directory read produces a valid, tiny, completely wrong barrel that deletes
 * every export, and `--check` would then happily go green on the next run.
 * 1,039 bindings at the commit that added this; 800 is ~23% below.
 */
const MIN_BINDINGS = 800;

const HEADER = [
  "// Auto-generated barrel index for ts-rs bindings. DO NOT EDIT.",
  "// Regenerate: node scripts/generate-bindings-index.mjs",
  "// Runs automatically in predev/prebuild (scripts/run-codegen.mjs, task `bindings-index`).",
  "// Verified by: node scripts/generate-bindings-index.mjs --check (npm run check).",
  "",
];

/** Every top-level binding module name, in barrel order. */
export function listBindingModules(dir = BINDINGS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && e.name !== "index.ts")
    .map((e) => e.name.slice(0, -3))
    .sort(new Intl.Collator("en").compare);
}

/** The exact bytes the barrel should hold for a given module list. */
export function renderIndex(modules) {
  return (
    HEADER.join("\n") +
    "\n" +
    modules.map((n) => `export type { ${n} } from "./${n}";`).join("\n") +
    "\n"
  );
}

function main() {
  const check = process.argv.includes("--check");
  const modules = listBindingModules();

  if (modules.length < MIN_BINDINGS) {
    console.error(
      `Only ${modules.length} binding module(s) found in ${INDEX_REL.replace("/index.ts", "")}; ` +
        `the floor is ${MIN_BINDINGS}.\nRefusing to act on a partial read — an empty directory ` +
        `produces a valid-looking barrel that\ndeletes every export, and --check would go green ` +
        `on it the next run. Fix the walk,\nor lower MIN_BINDINGS in the same commit that removes ` +
        `the bindings.`,
    );
    process.exit(1);
  }

  const next = renderIndex(modules);
  const path = join(ROOT, INDEX_REL);
  let current = null;
  try {
    current = readFileSync(path, "utf-8");
  } catch {
    /* first run / deleted file */
  }

  if (current === next) {
    console.log(`${INDEX_REL} up to date (${modules.length} bindings).`);
    return;
  }

  if (check) {
    const have = current === null ? [] : [...current.matchAll(/from "\.\/(.+?)";/g)].map((m) => m[1]);
    const haveSet = new Set(have);
    const wantSet = new Set(modules);
    const missing = modules.filter((n) => !haveSet.has(n));
    const extra = have.filter((n) => !wantSet.has(n));
    console.error(
      `${INDEX_REL} is stale.\n` +
        (missing.length ? `  ${missing.length} binding(s) not exported: ${missing.join(", ")}\n` : "") +
        (extra.length ? `  ${extra.length} export(s) with no file: ${extra.join(", ")}\n` : "") +
        (!missing.length && !extra.length ? "  Same set, different bytes (order or header).\n" : "") +
        "Run: node scripts/generate-bindings-index.mjs",
    );
    process.exit(1);
  }

  writeFileSync(path, next, "utf-8");
  console.log(`${INDEX_REL} regenerated (${modules.length} bindings).`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
