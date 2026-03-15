#!/usr/bin/env node
/**
 * bundle-size-report.mjs — Generate a markdown bundle size report.
 *
 * Reads all .js files in dist/assets/, produces a markdown table of the
 * top 10 largest chunks with sizes (and deltas vs baseline if available),
 * plus total JS size and budget pass/fail status.
 *
 * Usage:  node scripts/bundle-size-report.mjs [--save-baseline]
 *
 * Options:
 *   --save-baseline   Write current sizes to dist/bundle-sizes.json
 *
 * Baseline:  If scripts/bundle-baseline.json exists, the report shows
 *            size deltas compared to that baseline.
 *
 * Output:    Markdown report to stdout.
 */

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS_DIR = join(ROOT, "dist", "assets");
const BASELINE_PATH = join(__dirname, "bundle-baseline.json");
const SIZES_OUTPUT = join(ROOT, "dist", "bundle-sizes.json");

const MAX_CHUNK_KB = 850;
const MAX_TOTAL_KB = 5000;
const TOP_N = 10;

const args = process.argv.slice(2);
const saveBaseline = args.includes("--save-baseline");

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Strip the Vite content-hash from a chunk filename.
 *   index-C1anhLSB.js         -> index
 *   chart-vendor-ZQ-a7Ypa.js  -> chart-vendor
 */
function normalizeChunkName(filename) {
  const base = filename.replace(/\.js$/, "");
  const match = base.match(/^(.+)-[A-Za-z0-9_-]{7,12}$/);
  return match ? match[1] : base;
}

function formatKB(kb) {
  return kb.toFixed(1);
}

function formatDelta(delta) {
  if (delta === null || delta === undefined) return "\u2014";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)} KB`;
}

// ── Read chunks ──────────────────────────────────────────────────────

let files;
try {
  files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".js"));
} catch {
  console.error("dist/assets/ not found — run `npm run build` first.");
  process.exit(1);
}

const rawChunks = files
  .map((f) => {
    const sizeKB = statSync(join(ASSETS_DIR, f)).size / 1024;
    return { file: f, name: normalizeChunkName(f), sizeKB };
  })
  .sort((a, b) => b.sizeKB - a.sizeKB);

// Disambiguate duplicate normalized names by appending #2, #3, etc.
// Sorted by descending size so the largest keeps the bare name.
const nameCounts = {};
const chunks = rawChunks.map((c) => {
  const count = (nameCounts[c.name] = (nameCounts[c.name] || 0) + 1);
  const key = count === 1 ? c.name : `${c.name}#${count}`;
  return { ...c, key };
});

const totalKB = chunks.reduce((sum, c) => sum + c.sizeKB, 0);

// ── Load baseline (if exists) ────────────────────────────────────────

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
} catch {
  // No baseline — deltas will be omitted
}

// ── Build chunk map for JSON output ──────────────────────────────────

const chunkMap = {};
for (const c of chunks) {
  chunkMap[c.key] = Math.round(c.sizeKB * 10) / 10;
}

// ── Save baseline if requested ───────────────────────────────────────

if (saveBaseline) {
  const output = {
    timestamp: new Date().toISOString(),
    totalKB: Math.round(totalKB),
    chunks: chunkMap,
  };
  try {
    mkdirSync(dirname(SIZES_OUTPUT), { recursive: true });
  } catch {
    // dist/ may already exist
  }
  writeFileSync(SIZES_OUTPUT, JSON.stringify(output, null, 2) + "\n");
  // Also stderr so stdout stays clean for markdown
  process.stderr.write(`Saved bundle sizes to ${SIZES_OUTPUT}\n`);
}

// ── Generate markdown report ─────────────────────────────────────────

const lines = [];
lines.push("### Bundle Size Report");
lines.push("");
lines.push("| Chunk | Size | Delta |");
lines.push("|-------|------|-------|");

const topChunks = chunks.slice(0, TOP_N);

for (const c of topChunks) {
  const label = c.key === "index" ? "`index` (main)" : `\`${c.key}\``;
  const size = `${formatKB(c.sizeKB)} KB`;

  let delta = "\u2014";
  if (baseline && baseline.chunks) {
    const baselineSize = baseline.chunks[c.key];
    if (baselineSize !== undefined) {
      const diff = c.sizeKB - baselineSize;
      delta = Math.abs(diff) < 0.05 ? "\u2014" : formatDelta(diff);
    } else {
      delta = "NEW";
    }
  }

  lines.push(`| ${label} | ${size} | ${delta} |`);
}

// Remaining count
const remaining = chunks.length - TOP_N;
if (remaining > 0) {
  const remainingKB = chunks.slice(TOP_N).reduce((s, c) => s + c.sizeKB, 0);
  lines.push(`| _...${remaining} more_ | ${formatKB(remainingKB)} KB | |`);
}

// Total row
let totalDelta = "\u2014";
if (baseline && baseline.totalKB !== undefined) {
  const diff = Math.round(totalKB) - baseline.totalKB;
  totalDelta = diff === 0 ? "\u2014" : `**${formatDelta(diff)}**`;
}
lines.push(`| **Total** | **${Math.round(totalKB)} KB** | ${totalDelta} |`);

lines.push("");

// Budget pass/fail
const chunkOverBudget = chunks.filter((c) => c.sizeKB > MAX_CHUNK_KB);
const totalOverBudget = totalKB > MAX_TOTAL_KB;
const passed = chunkOverBudget.length === 0 && !totalOverBudget;

lines.push(
  `Budget: ${MAX_CHUNK_KB} KB/chunk, ${MAX_TOTAL_KB} KB total \u2014 **${passed ? "PASS" : "FAIL"}**`
);

if (!passed) {
  if (chunkOverBudget.length > 0) {
    lines.push("");
    lines.push(
      `> ${chunkOverBudget.length} chunk(s) over budget: ${chunkOverBudget
        .map((c) => `\`${c.name}\` (${formatKB(c.sizeKB)} KB)`)
        .join(", ")}`
    );
  }
  if (totalOverBudget) {
    lines.push("");
    lines.push(`> Total bundle (${Math.round(totalKB)} KB) exceeds ${MAX_TOTAL_KB} KB limit`);
  }
}

// Output
console.log(lines.join("\n"));
