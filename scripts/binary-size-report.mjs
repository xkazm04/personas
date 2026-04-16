// scripts/binary-size-report.mjs
//
// Reports installer and binary sizes after a Tauri build.
// Optionally compares against a baseline file to detect regressions.
//
// Usage:
//   node scripts/binary-size-report.mjs                    # report only
//   node scripts/binary-size-report.mjs --save-baseline    # save current as baseline
//   node scripts/binary-size-report.mjs --budget 55        # fail if any installer > 55 MB
//
// Baseline file: .baseline/binary-sizes.json

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, basename } from "path";

const ROOT = join(import.meta.dirname, "..");
const BUNDLE_DIR = join(ROOT, "src-tauri", "target", "release", "bundle");
const BINARY_PATH = join(ROOT, "src-tauri", "target", "release", "personas-desktop.exe");
const BASELINE_DIR = join(ROOT, ".baseline");
const BASELINE_PATH = join(BASELINE_DIR, "binary-sizes.json");

// ── Parse CLI flags ────────────────────────────────────────────────

const args = process.argv.slice(2);
const saveBaseline = args.includes("--save-baseline");
const budgetIdx = args.indexOf("--budget");
const budgetMB = budgetIdx !== -1 ? Number(args[budgetIdx + 1]) : null;

// ── Collect sizes ──────────────────────────────────────────────────

function collectSizes() {
  const sizes = {};

  // Main binary
  if (existsSync(BINARY_PATH)) {
    sizes["personas-desktop.exe"] = statSync(BINARY_PATH).size;
  }

  // Installers
  const subdirs = ["nsis", "msi", "deb", "appimage", "dmg", "macos"];
  for (const sub of subdirs) {
    const dir = join(BUNDLE_DIR, sub);
    if (!existsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir)) {
        const fullPath = join(dir, file);
        const stat = statSync(fullPath);
        if (stat.isFile() && stat.size > 1024) {
          sizes[`${sub}/${file}`] = stat.size;
        }
      }
    } catch {
      // Directory may not exist on this platform
    }
  }

  return sizes;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ── Load baseline ──────────────────────────────────────────────────

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

// ── Report ─────────────────────────────────────────────────────────

const sizes = collectSizes();
const baseline = loadBaseline();

if (Object.keys(sizes).length === 0) {
  console.error("No build artifacts found. Run 'npx tauri build' first.");
  process.exit(1);
}

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║               Personas Build Size Report                   ║");
console.log("╠══════════════════════════════════════════════════════════════╣");

let budgetExceeded = false;

for (const [name, bytes] of Object.entries(sizes).sort((a, b) => b[1] - a[1])) {
  const size = formatBytes(bytes);
  let delta = "";

  if (baseline && baseline[name]) {
    const diff = bytes - baseline[name];
    if (diff !== 0) {
      const sign = diff > 0 ? "+" : "";
      const pct = ((diff / baseline[name]) * 100).toFixed(1);
      delta = ` (${sign}${formatBytes(Math.abs(diff))}, ${sign}${pct}%)`;
      if (diff > 0) delta = `\x1b[31m${delta}\x1b[0m`; // red for increase
      else delta = `\x1b[32m${delta}\x1b[0m`; // green for decrease
    }
  }

  // Budget check applies to installer files, not the raw binary
  if (budgetMB && !name.endsWith(".exe") && bytes > budgetMB * 1024 * 1024) {
    budgetExceeded = true;
    console.log(`║  ⚠  ${name.padEnd(40)} ${size.padStart(10)}${delta}`);
  } else {
    console.log(`║  ${name.padEnd(43)} ${size.padStart(10)}${delta}`);
  }
}

console.log("╚══════════════════════════════════════════════════════════════╝\n");

// ── Save baseline ──────────────────────────────────────────────────

if (saveBaseline) {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(sizes, null, 2) + "\n");
  console.log(`Baseline saved to ${BASELINE_PATH}`);
}

// ── Budget enforcement ─────────────────────────────────────────────

if (budgetExceeded) {
  console.error(`\nERROR: One or more installers exceed the ${budgetMB} MB budget.`);
  process.exit(1);
}

// ── Machine-readable output for CI ─────────────────────────────────

if (args.includes("--json")) {
  console.log(JSON.stringify({ sizes, baseline, budgetMB }, null, 2));
}
