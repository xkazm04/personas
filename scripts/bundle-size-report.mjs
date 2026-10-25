#!/usr/bin/env node
/**
 * bundle-size-report.mjs — the markdown bundle report posted on a PR.
 *
 * It reports exactly what the gate (scripts/check-bundle-budget.mjs) measures
 * and decides, from the same reader (readBuild) and the same ratchet
 * (evaluateBudget): total JS, startup JS and its distance to
 * STARTUP_TARGET_KB, the largest chunks keyed by the source module they load
 * with their delta against the baseline, and the ratchet's verdict.
 *
 * Until 2026-10-25 this printed "Budget: 850 KB/chunk, 5000 KB total — FAIL"
 * on every PR: the flat caps the gate had replaced on 2026-08-30 (they are its
 * no-baseline fallback only), against a build the gate was passing. A comment
 * that disagrees with the gate is worse than no comment.
 *
 * Usage:  node scripts/bundle-size-report.mjs   (after `npm run build`)
 * Output: Markdown to stdout.
 */

import { readFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { STARTUP_TARGET_KB, evaluateBudget, readBuild } from "./lib/bundle-budget.mjs";
import { BUNDLE_GRAPH_PATH } from "./build/bundle-graph-vite-plugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GRAPH_PATH = join(ROOT, BUNDLE_GRAPH_PATH);
const BASELINE_PATH = join(__dirname, "bundle-baseline.json");
const TOP_N = 10;

if (process.argv.includes("--save-baseline")) {
  // Retired 2026-10-25: only check-bundle-budget.mjs writes the schema-2 baseline.
  process.stderr.write("--save-baseline is retired: run `node scripts/check-bundle-budget.mjs --update`.\n");
  process.exit(1);
}

let current;
try {
  current = readBuild({ assetsDir: join(ROOT, "dist", "assets"), graphPath: GRAPH_PATH, graphLabel: relative(ROOT, GRAPH_PATH) });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
} catch {
  // No baseline: no deltas, and the verdict falls back as the gate's does.
}
const result = evaluateBudget(current, baseline);

const kb = (n) => `${n.toFixed(1)} KB`;
const delta = (now, then) => {
  if (then === undefined || then === null) return "new";
  const d = now - then;
  return Math.abs(d) < 0.05 ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)} KB`;
};

const lines = ["### Bundle report", ""];
lines.push("| | Now | vs baseline |");
lines.push("|---|---|---|");
lines.push(`| **Startup JS** (entry + static imports, ${current.startupFiles} chunks) | **${kb(current.startupKB)}** | ${delta(current.startupKB, baseline?.startupKB)} |`);
lines.push(`| Total JS (${current.fileCount} chunks, most lazy) | ${kb(current.totalKB)} | ${delta(current.totalKB, baseline?.totalKB)} |`);
lines.push("");
const toGo = current.startupKB - STARTUP_TARGET_KB;
lines.push(
  toGo > 0
    ? `Startup target ${STARTUP_TARGET_KB} KB: ${kb(toGo)} to go (tracked; the ratchet below is what fails a PR).`
    : `Startup target ${STARTUP_TARGET_KB} KB: met, with ${kb(-toGo)} to spare.`,
);
lines.push("");

lines.push("| Largest chunks (keyed by the module they load) | Size | vs baseline |");
lines.push("|---|---|---|");
const sorted = Object.entries(current.chunks).sort((a, b) => b[1] - a[1]);
for (const [key, size] of sorted.slice(0, TOP_N)) {
  lines.push(`| \`${key}\` | ${kb(size)} | ${delta(size, baseline?.chunks?.[key])} |`);
}
if (sorted.length > TOP_N) {
  const rest = sorted.slice(TOP_N).reduce((s, [, v]) => s + v, 0);
  lines.push(`| _${sorted.length - TOP_N} more_ | ${kb(rest)} | |`);
}
lines.push("");

if (result.violations.length === 0) {
  lines.push("Ratchet (max(1%, 10 KB) per value against `scripts/bundle-baseline.json`): **PASS**");
} else {
  lines.push(`Ratchet (max(1%, 10 KB) per value against \`scripts/bundle-baseline.json\`): **FAIL**, ${result.violations.length} rise(s)`);
  lines.push("");
  for (const v of result.violations.slice(0, 15)) {
    const name = v.key ?? v.kind;
    lines.push(
      v.kind === "new-chunk"
        ? `- \`${name}\`: new chunk at ${kb(v.currentKB)}, over the ${v.maxChunkKB} KB cap for a chunk with no baseline`
        : `- \`${name}\`: ${kb(v.currentKB)} (baseline ${v.baselineKB ?? "none"} KB, +${v.diffKB.toFixed(1)} KB)`,
    );
  }
}

console.log(lines.join("\n"));
