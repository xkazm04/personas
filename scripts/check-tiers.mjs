#!/usr/bin/env node
// Compile each VITE_APP_TIER variant locally to catch tier-gated import
// regressions before they reach CI. Mirrors the loop in .github/workflows/ci.yml.
//
// Usage: node scripts/check-tiers.mjs [tier...]
//   default tiers: starter team builder

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TIERS = process.argv.slice(2);
if (TIERS.length === 0) TIERS.push("starter", "team", "builder");

// Codegen (i18n split, command names, ts-rs bindings, sprites, …) is wired
// into the predev/prebuild npm hooks, and vite's buildStart codegen was
// deliberately removed (see vite.config.ts). Since the tier loop below spawns
// `vite build` DIRECTLY — bypassing prebuild — run codegen once up front so
// the tier builds don't compile against stale generated files.
function runCodegen() {
  return new Promise((res, rej) => {
    const child = spawn(
      process.execPath,
      [join(repoRoot, "scripts", "run-codegen.mjs"), "prebuild"],
      { stdio: "inherit", cwd: repoRoot },
    );
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`codegen exited ${code}`))));
    child.on("error", rej);
  });
}

function viteBuild(tier) {
  return new Promise((res, rej) => {
    const child = spawn("npx", ["vite", "build"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, VITE_APP_TIER: tier },
    });
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`tier=${tier} exited ${code}`))));
    child.on("error", rej);
  });
}

try {
  await runCodegen();
} catch (e) {
  process.stderr.write(`codegen failed before tier builds: ${e.message}\n`);
  process.exit(1);
}

let failed = 0;
for (const tier of TIERS) {
  process.stdout.write(`\n=== VITE_APP_TIER=${tier} ===\n`);
  try {
    await viteBuild(tier);
  } catch (e) {
    failed += 1;
    process.stderr.write(`${e.message}\n`);
    // Keep going so a single broken tier doesn't hide breakage in the others.
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed}/${TIERS.length} tier builds failed\n`);
  process.exit(1);
}
process.stdout.write(`\nAll ${TIERS.length} tier builds ok.\n`);
