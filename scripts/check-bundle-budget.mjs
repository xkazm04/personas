#!/usr/bin/env node
/**
 * check-bundle-budget.mjs — Enforce chunk size budgets on the Vite build output.
 *
 * Reads all .js files in dist/assets/ and fails if any chunk exceeds
 * the configured budget. Designed to run in CI after `npm run build`.
 *
 * Usage:  node scripts/check-bundle-budget.mjs [--max-chunk-kb=500] [--max-total-kb=4000]
 * Exit:   0 = within budget, 1 = over budget
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);

function flag(name, fallback) {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
}

const MAX_CHUNK_KB = flag("max-chunk-kb", 500);
const MAX_TOTAL_KB = flag("max-total-kb", 5000);
const ASSETS_DIR = join(process.cwd(), "dist", "assets");

let files;
try {
  files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".js"));
} catch {
  console.error("dist/assets/ not found — run `npm run build` first.");
  process.exit(1);
}

const results = files
  .map((f) => ({
    name: f,
    sizeKB: statSync(join(ASSETS_DIR, f)).size / 1024,
  }))
  .sort((a, b) => b.sizeKB - a.sizeKB);

const totalKB = results.reduce((sum, r) => sum + r.sizeKB, 0);
const violations = results.filter((r) => r.sizeKB > MAX_CHUNK_KB);

// Report
console.log(`\nBundle Budget Report (max chunk: ${MAX_CHUNK_KB} KB, max total: ${MAX_TOTAL_KB} KB)`);
console.log("─".repeat(70));

for (const r of results.slice(0, 15)) {
  const marker = r.sizeKB > MAX_CHUNK_KB ? " ** OVER BUDGET **" : "";
  console.log(`  ${r.sizeKB.toFixed(1).padStart(8)} KB  ${r.name}${marker}`);
}
if (results.length > 15) {
  console.log(`  ... and ${results.length - 15} more chunks`);
}
console.log("─".repeat(70));
console.log(`  Total JS: ${totalKB.toFixed(1)} KB across ${results.length} chunks`);

let exitCode = 0;

if (violations.length > 0) {
  console.log(`\n  FAIL: ${violations.length} chunk(s) exceed ${MAX_CHUNK_KB} KB budget:`);
  for (const v of violations) {
    console.log(`    - ${v.name}: ${v.sizeKB.toFixed(1)} KB (+${(v.sizeKB - MAX_CHUNK_KB).toFixed(1)} KB over)`);
  }
  exitCode = 1;
}

if (totalKB > MAX_TOTAL_KB) {
  console.log(`\n  FAIL: Total JS bundle (${totalKB.toFixed(1)} KB) exceeds ${MAX_TOTAL_KB} KB budget.`);
  exitCode = 1;
}

if (exitCode === 0) {
  console.log("\n  PASS: All chunks within budget.");
}

process.exit(exitCode);
