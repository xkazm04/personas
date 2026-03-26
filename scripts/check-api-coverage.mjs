#!/usr/bin/env node
/**
 * Lists API modules in src/api/ that have no corresponding test file.
 * Run with: node scripts/check-api-coverage.mjs
 */
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname, basename, extname } from "node:path";

const API_DIR = join(import.meta.dirname, "..", "src", "api");
const SRC_DIR = join(import.meta.dirname, "..", "src");

/** Recursively collect all .ts files (non-test, non-declaration) under a directory. */
function collectTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      results.push(...collectTsFiles(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(full);
    }
  }
  return results;
}

/** Collect all test files under src/. */
function collectTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectTestFiles(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))
    ) {
      results.push(full);
    }
  }
  return results;
}

const apiModules = collectTsFiles(API_DIR);
const allTests = collectTestFiles(SRC_DIR);
const testBaseNames = new Set(allTests.map((t) => basename(t).replace(/\.test\.tsx?$/, "")));

const covered = [];
const uncovered = [];

for (const mod of apiModules) {
  const rel = relative(API_DIR, mod);
  const base = basename(mod, extname(mod));
  // Check if a test exists with matching base name anywhere under src/
  if (testBaseNames.has(base)) {
    covered.push(rel);
  } else {
    uncovered.push(rel);
  }
}

console.log("=== API Module Test Coverage ===\n");
console.log(`Total API modules: ${apiModules.length}`);
console.log(`Covered:           ${covered.length}`);
console.log(`Uncovered:         ${uncovered.length}`);
console.log(`Coverage:          ${((covered.length / apiModules.length) * 100).toFixed(1)}%\n`);

if (uncovered.length > 0) {
  console.log("Uncovered modules:");
  for (const u of uncovered.sort()) {
    console.log(`  - ${u}`);
  }
}

if (covered.length > 0) {
  console.log("\nCovered modules:");
  for (const c of covered.sort()) {
    console.log(`  + ${c}`);
  }
}

process.exit(0);
