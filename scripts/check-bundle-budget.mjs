#!/usr/bin/env node
/**
 * check-bundle-budget.mjs — Ratchet-enforce chunk sizes on the Vite build output.
 *
 * Reads all .js files in dist/assets/ and the chunk graph the build wrote
 * (node_modules/.cache/personas/bundle-graph.json, see
 * scripts/build/bundle-graph-vite-plugin.mjs). Each chunk is keyed by the
 * source module it loads (a lazy route, a locale section, the HTML entry), or
 * `shared:<name>` when it has none; "startup JS" is the entry plus its static
 * imports. The result is compared against the last honestly-measured build
 * recorded in scripts/bundle-baseline.json. Fails only when the total, the
 * startup JS, or an individual chunk GROWS beyond a small tolerance (see
 * scripts/lib/bundle-budget.mjs). A chunk that shrinks, or
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

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import {
  MAX_CHUNK_KB as DEFAULT_MAX_CHUNK_KB,
  MAX_TOTAL_KB as DEFAULT_MAX_TOTAL_KB,
  buildGraphChunkMap,
  evaluateBudget,
  readBuild,
  startupFiles,
} from "./lib/bundle-budget.mjs";
import { BUNDLE_GRAPH_PATH } from "./build/bundle-graph-vite-plugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST_DIR = join(ROOT, "dist");
const ASSETS_DIR = join(DIST_DIR, "assets");
const BASELINE_PATH = join(__dirname, "bundle-baseline.json");
const GRAPH_PATH = join(ROOT, BUNDLE_GRAPH_PATH);

const args = process.argv.slice(2);

function flag(name, fallback) {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
}

// Flags still override the no-baseline fallback ceiling (handy for ad-hoc
// local checks); they have no effect on the ratchet comparison itself.
const MAX_CHUNK_KB = flag("max-chunk-kb", DEFAULT_MAX_CHUNK_KB);
const MAX_TOTAL_KB = flag("max-total-kb", DEFAULT_MAX_TOTAL_KB);

/**
 * Assert that nothing large escaped the directory this gate actually scans.
 *
 * WHY, and it is not hypothetical. Vite emits Web Worker bundles into
 * `dist/assets` alongside ordinary chunks, so `readCurrentBuild` below has
 * always *seen* them — `normalizeChunkName('comparisonDiff.worker-BFWhsbBf.js')`
 * returns `comparisonDiff.worker`, and a 22,706 KB worker with no baseline entry
 * produced two violations (a `new-chunk` over the 850 KB cap and a +22,706 KB
 * total rise). Verified 2026-09-20 by replaying the real measured size through
 * `evaluateBudget`. The worker was never a blind spot — the gate was **red and
 * ignored**, which is a different and worse failure.
 *
 * What WOULD be a blind spot is a large `.js` emitted anywhere else under
 * `dist/`: `assetsDir`, a plugin's `emitFile`, a worker config change, a copied
 * public asset. The scan is one directory deep by construction, so this check
 * exists to make "the gate is not looking at it" impossible to reach silently.
 */
function assertNothingLargeOutsideAssets(maxChunkKB) {
  if (!existsSync(DIST_DIR)) return [];
  const escapees = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== ASSETS_DIR) walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      const sizeKB = statSync(full).size / 1024;
      if (sizeKB > maxChunkKB) escapees.push({ file: relative(DIST_DIR, full), sizeKB });
    }
  };
  walk(DIST_DIR);
  return escapees;
}

function readCurrentBuild() {
  try {
    return readBuild({ assetsDir: ASSETS_DIR, graphPath: GRAPH_PATH, graphLabel: relative(ROOT, GRAPH_PATH) });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
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
    // schema 2 (2026-10-25): chunks keyed by source module (see chunkKeyFromGraph), plus startupKB.
    schema: 2,
    timestamp: new Date().toISOString(),
    totalKB: Math.round(current.totalKB),
    startupKB: Math.round(current.startupKB),
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
  console.log(`  Startup JS (entry + static imports): ${current.startupKB.toFixed(1)} KB across ${current.startupFiles} chunks`);

  if (result.violations.length > 0) {
    console.log(`\n  FAIL: ${result.violations.length} rise(s) beyond tolerance:`);
    for (const v of result.violations) {
      if (v.kind === "total") {
        const baselineStr = v.baselineKB === null ? `no baseline, cap ${MAX_TOTAL_KB} KB` : `baseline ${v.baselineKB} KB`;
        console.log(`    - total: ${v.currentKB.toFixed(1)} KB (${baselineStr}, +${v.diffKB.toFixed(1)} KB over)`);
      } else if (v.kind === "startup") {
        console.log(`    - startup: ${v.currentKB.toFixed(1)} KB (baseline ${v.baselineKB} KB, +${v.diffKB.toFixed(1)} KB, tolerance ${v.toleranceKB.toFixed(1)} KB)`);
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
      } else if (n.kind === "total" || n.kind === "startup") {
        console.log(`    - ${n.kind}: ${n.currentKB.toFixed(1)} KB (baseline ${n.baselineKB} KB, ${n.diffKB.toFixed(1)} KB)`);
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

  // Startup is ratcheted like the total: a +40 KB rise on a 300 KB startup fails.
  const startupResult = evaluateBudget(
    { totalKB: 1000, startupKB: 340, chunks: baseline.chunks },
    { ...baseline, startupKB: 300 },
  );
  const caughtStartupRise = startupResult.violations.some((v) => v.kind === "startup");

  // Graph keys: a facade chunk is keyed by its source module; two facade-less
  // chunks sharing a name are told apart; startup follows static imports only.
  const graph = {
    chunks: [
      { file: "index-a.js", name: "index", facade: "index.html", isEntry: true, imports: ["shared-b.js"] },
      { file: "shared-b.js", name: "util", facade: null, isEntry: false, imports: [] },
      { file: "shared-c.js", name: "util", facade: null, isEntry: false, imports: [] },
      { file: "page-d.js", name: "index", facade: "src/pages/Page.tsx", isEntry: false, imports: ["shared-c.js"] },
    ],
  };
  const sizes = { "index-a.js": 100, "shared-b.js": 50, "shared-c.js": 20, "page-d.js": 70 };
  const graphMap = buildGraphChunkMap(graph, (f) => sizes[f]);
  const keyedBySource = graphMap["src/pages/Page.tsx"] === 70 && graphMap["index.html"] === 100;
  const sharedDisambiguated = graphMap["shared:util"] === 50 && graphMap["shared:util#2"] === 20;
  const startup = startupFiles(graph);
  const startupIsStaticClosure = startup.join(",") === "index-a.js,shared-b.js";

  const checks = [
    ["rise beyond tolerance on startup JS is caught", caughtStartupRise],
    ["a facade chunk is keyed by its source module", keyedBySource],
    ["facade-less chunks with one name are disambiguated", sharedDisambiguated],
    ["startup is the entry's static-import closure, not lazy chunks", startupIsStaticClosure],
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

  const escapees = assertNothingLargeOutsideAssets(MAX_CHUNK_KB);
  if (escapees.length > 0) {
    console.log(`\n  FAIL: ${escapees.length} JS file(s) over ${MAX_CHUNK_KB} KB live OUTSIDE dist/assets, where this gate does not scan:`);
    for (const e of escapees) console.log(`    - ${e.file}: ${e.sizeKB.toFixed(1)} KB`);
    console.log("    Either move them under dist/assets or widen readCurrentBuild — an unscanned megabyte is not a passing build.");
  }

  process.exit(result.violations.length > 0 || escapees.length > 0 ? 1 : 0);
}

if (args.includes("--self-test")) {
  runSelfTest();
} else if (args.includes("--update")) {
  runUpdate();
} else {
  runCheck();
}
