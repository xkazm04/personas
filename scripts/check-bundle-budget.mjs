#!/usr/bin/env node
/**
 * check-bundle-budget.mjs — Ratchet-enforce chunk sizes on the Vite build output.
 *
 * Reads all .js files in dist/assets/, normalizes each to a logical chunk
 * name (stripping the Vite content-hash), and compares the result against
 * the last honestly-measured build recorded in scripts/bundle-baseline.json.
 * Fails only when the total, or an individual chunk, GROWS beyond a small
 * tolerance (see scripts/lib/bundle-budget.mjs). A chunk that shrinks, or
 * disappears, never fails the gate — it prints a non-fatal "baseline stale"
 * notice instead, because a drop is either a real win (re-baseline it) or a
 * broken measurement, never a regression.
 *
 * Known-oversized chunks already recorded in the baseline (vendor-three, the
 * `en` locale chunk) are grandfathered at their recorded size: they fail
 * only if they grow further, not because they exceed MAX_CHUNK_KB. There is
 * no gate here that a single fresh commit could "clear" by shrinking a
 * chunk — see docs/concepts (or the ADR "bundle-gate-resurrection") for why
 * this replaced the old flat 850 KB/chunk, 5000 KB total check, which had
 * drifted so far from the real build (~31.9 MB total, 2 chunks over) that it
 * had been running green under CI's `if: always()` without anyone noticing
 * it was failing.
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs                 # ratchet check (default)
 *   node scripts/check-bundle-budget.mjs --update         # record dist/ as the new baseline
 *   node scripts/check-bundle-budget.mjs --self-test       # prove the ratchet fails on a simulated rise
 *   node scripts/check-bundle-budget.mjs --max-chunk-kb=N --max-total-kb=N   # override the no-baseline fallback caps
 *
 * Exit: 0 = within budget (or --update / --self-test succeeded), 1 = over budget (or self-test failed).
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  MAX_CHUNK_KB as DEFAULT_MAX_CHUNK_KB,
  MAX_TOTAL_KB as DEFAULT_MAX_TOTAL_KB,
  buildChunkMap,
  evaluateBudget,
} from "./lib/bundle-budget.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS_DIR = join(ROOT, "dist", "assets");
const BASELINE_PATH = join(__dirname, "bundle-baseline.json");

const args = process.argv.slice(2);

function flag(name, fallback) {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
}

// Flags still override the no-baseline fallback ceiling (handy for ad-hoc
// local checks); they have no effect on the ratchet comparison itself.
const MAX_CHUNK_KB = flag("max-chunk-kb", DEFAULT_MAX_CHUNK_KB);
const MAX_TOTAL_KB = flag("max-total-kb", DEFAULT_MAX_TOTAL_KB);

function readCurrentBuild() {
  let files;
  try {
    files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".js"));
  } catch {
    console.error("dist/assets/ not found — run `npm run build` first.");
    process.exit(1);
  }
  const entries = files.map((f) => ({
    file: f,
    sizeKB: statSync(join(ASSETS_DIR, f)).size / 1024,
  }));
  const chunks = buildChunkMap(entries);
  const totalKB = Object.values(chunks).reduce((sum, kb) => sum + kb, 0);
  return { totalKB: Math.round(totalKB * 10) / 10, chunks, fileCount: entries.length };
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeBaseline(current) {
  const output = {
    timestamp: new Date().toISOString(),
    totalKB: Math.round(current.totalKB),
    chunks: current.chunks,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(output, null, 2) + "\n");
  return output;
}

// ── Report rendering (shared by the real run and nothing else — --self-test
// uses synthetic data and its own short-form output so it never touches the
// filesystem) ──────────────────────────────────────────────────────────

function printReport(current, baseline, result) {
  const baselineNote = baseline
    ? `ratchet vs baseline ${baseline.timestamp} (tolerance: max(1%, 10 KB) per value)`
    : `no baseline recorded — falling back to flat caps (max chunk: ${MAX_CHUNK_KB} KB, max total: ${MAX_TOTAL_KB} KB)`;

  console.log(`\nBundle Budget Report — ${baselineNote}`);
  console.log("─".repeat(70));

  const sorted = Object.entries(current.chunks).sort((a, b) => b[1] - a[1]);
  const violationKeys = new Set(
    result.violations.filter((v) => v.key).map((v) => v.key)
  );

  for (const [key, sizeKB] of sorted.slice(0, 15)) {
    const marker = violationKeys.has(key) ? " ** OVER BUDGET **" : "";
    console.log(`  ${sizeKB.toFixed(1).padStart(8)} KB  ${key}${marker}`);
  }
  if (sorted.length > 15) {
    console.log(`  ... and ${sorted.length - 15} more chunks`);
  }
  console.log("─".repeat(70));
  console.log(`  Total JS: ${current.totalKB.toFixed(1)} KB across ${current.fileCount} chunks`);

  if (result.violations.length > 0) {
    console.log(`\n  FAIL: ${result.violations.length} rise(s) beyond tolerance:`);
    for (const v of result.violations) {
      if (v.kind === "total") {
        const baselineStr = v.baselineKB === null ? `no baseline, cap ${MAX_TOTAL_KB} KB` : `baseline ${v.baselineKB} KB`;
        console.log(`    - total: ${v.currentKB.toFixed(1)} KB (${baselineStr}, +${v.diffKB.toFixed(1)} KB over)`);
      } else if (v.kind === "chunk") {
        console.log(
          `    - ${v.key}: ${v.currentKB.toFixed(1)} KB (baseline ${v.baselineKB} KB, +${v.diffKB.toFixed(1)} KB, tolerance ${v.toleranceKB.toFixed(1)} KB)`
        );
      } else if (v.kind === "new-chunk") {
        console.log(`    - ${v.key}: NEW chunk at ${v.currentKB.toFixed(1)} KB exceeds ${v.maxChunkKB} KB cap`);
      }
    }
  }

  if (result.staleNotices.length > 0) {
    console.log(
      `\n  NOTICE: ${result.staleNotices.length} baseline entr${result.staleNotices.length === 1 ? "y is" : "ies are"} stale (dropped beyond tolerance or disappeared) — non-fatal. Run \`node scripts/check-bundle-budget.mjs --update\` to re-baseline:`
    );
    for (const n of result.staleNotices) {
      if (n.kind === "removed-chunk") {
        console.log(`    - ${n.key}: gone from the build (was ${n.baselineKB} KB)`);
      } else if (n.kind === "total") {
        console.log(`    - total: ${n.currentKB.toFixed(1)} KB (baseline ${n.baselineKB} KB, ${n.diffKB.toFixed(1)} KB)`);
      } else {
        console.log(`    - ${n.key}: ${n.currentKB.toFixed(1)} KB (baseline ${n.baselineKB} KB, ${n.diffKB.toFixed(1)} KB)`);
      }
    }
  }

  if (result.newChunks.length > 0) {
    console.log(`\n  INFO: ${result.newChunks.length} new chunk(s) with no baseline entry yet (within cap, not gated):`);
    for (const n of result.newChunks.slice(0, 10)) {
      console.log(`    - ${n.key}: ${n.currentKB.toFixed(1)} KB`);
    }
    if (result.newChunks.length > 10) {
      console.log(`    ... and ${result.newChunks.length - 10} more`);
    }
  }

  if (result.violations.length === 0) {
    console.log("\n  PASS: no chunk or total grew beyond its baseline tolerance.");
  }
}

// ── Modes ────────────────────────────────────────────────────────────

function runSelfTest() {
  // Synthetic, in-memory only — no dist/ read, no file writes. Proves the
  // ratchet actually fails a build that rose beyond tolerance, and does NOT
  // fail one that stayed within it or dropped.
  const baseline = {
    timestamp: "self-test-baseline",
    totalKB: 1000,
    chunks: { foo: 500, bar: 300, baz: 10 },
  };

  // A simulated rise: `foo` grows by 40 KB (tolerance is max(500*0.01,10)=10 KB),
  // `bar` stays flat, `baz` (tiny, tolerance floor 10 KB) grows by 3 KB (within
  // tolerance — must NOT fail), total rises to match.
  const risen = {
    totalKB: 1043,
    chunks: { foo: 540, bar: 300, baz: 13 },
  };

  const risenResult = evaluateBudget(risen, baseline);
  const caughtChunkRise = risenResult.violations.some((v) => v.kind === "chunk" && v.key === "foo");
  const caughtTotalRise = risenResult.violations.some((v) => v.kind === "total");
  const falsePositiveOnBaz = risenResult.violations.some((v) => v.key === "baz");

  // A simulated drop: `bar` shrinks by 50 KB — must produce a non-fatal
  // stale notice, never a violation.
  const dropped = {
    totalKB: 950,
    chunks: { foo: 500, bar: 250, baz: 10 },
  };
  const droppedResult = evaluateBudget(dropped, baseline);
  const noFalseFailOnDrop = droppedResult.violations.length === 0;
  const noticedDrop = droppedResult.staleNotices.some((n) => n.kind === "chunk" && n.key === "bar");

  // A brand-new oversized chunk with no baseline entry — must fail via the
  // absolute cap fallback.
  const withNewChunk = {
    totalKB: 1000 + 900,
    chunks: { foo: 500, bar: 300, baz: 10, quux: 900 },
  };
  const newChunkResult = evaluateBudget(withNewChunk, baseline, { maxChunkKB: 850 });
  const caughtNewOversizedChunk = newChunkResult.violations.some((v) => v.kind === "new-chunk" && v.key === "quux");

  const checks = [
    ["rise beyond tolerance on an existing chunk is caught", caughtChunkRise],
    ["rise beyond tolerance on the total is caught", caughtTotalRise],
    ["a small in-tolerance rise on a tiny chunk is NOT flagged", !falsePositiveOnBaz],
    ["a drop never produces a violation", noFalseFailOnDrop],
    ["a drop produces a non-fatal stale notice", noticedDrop],
    ["a brand-new chunk over the absolute cap is caught", caughtNewOversizedChunk],
  ];

  console.log("\nBundle budget ratchet self-test (synthetic data, no filesystem access)");
  console.log("─".repeat(70));
  let allPassed = true;
  for (const [label, passed] of checks) {
    console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}`);
    if (!passed) allPassed = false;
  }
  console.log("─".repeat(70));
  console.log(allPassed ? "\n  SELF-TEST PASS: the ratchet correctly fails on a simulated rise.\n" : "\n  SELF-TEST FAIL: the ratchet did not behave as expected — see above.\n");
  process.exit(allPassed ? 0 : 1);
}

function runUpdate() {
  const current = readCurrentBuild();
  const written = writeBaseline(current);
  console.log(`\nWrote new baseline to ${BASELINE_PATH}`);
  console.log(`  totalKB: ${written.totalKB}`);
  console.log(`  chunks: ${Object.keys(written.chunks).length}`);
  console.log(
    "\nThis is a deliberate re-baseline — it belongs in a diff a reviewer sees, same as `npm run census -- --update`. Never run this to make a real regression disappear."
  );
  process.exit(0);
}

function runCheck() {
  const current = readCurrentBuild();
  const baseline = loadBaseline();
  const result = evaluateBudget(current, baseline, { maxChunkKB: MAX_CHUNK_KB, maxTotalKB: MAX_TOTAL_KB });
  printReport(current, baseline, result);
  process.exit(result.violations.length > 0 ? 1 : 0);
}

if (args.includes("--self-test")) {
  runSelfTest();
} else if (args.includes("--update")) {
  runUpdate();
} else {
  runCheck();
}
