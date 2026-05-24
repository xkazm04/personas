#!/usr/bin/env node
// Parallel codegen runner. Replaces the long `&&` chains in predev/prebuild
// so independent codegen scripts run concurrently with a per-task timeout —
// a network hang in one script no longer stalls `npm run dev` indefinitely.
//
// Usage: node scripts/run-codegen.mjs <preset>
//   preset = "predev" | "prebuild"
//
// Per-task default timeout: 60s. Override with CODEGEN_TIMEOUT_MS env var.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Each task name maps to a script path (relative to repo root).
// Keep this mapping flat and explicit — no glob/auto-discovery, so the set
// of codegen tasks is reviewable in one place.
const TASKS = {
  commands:  "scripts/generate-command-names.mjs",
  i18n:      "scripts/i18n/gen-types.mjs",
  // Splits per-locale JSON into section-scoped JSON chunks under
  // src/i18n/section-locales/<lang>/<section>.json + regenerates
  // src/i18n/generated/enSectionStrings.ts.
  "i18n-split": "scripts/i18n/split-locales.mjs",
  connectors:"scripts/generate-connector-seed.mjs",
  checksums: "scripts/generate-template-checksums.mjs",
  "n8n-limits": "scripts/generate-n8n-limits.mjs",
  "host-check": "scripts/check-build-cache.mjs",
  // Advisory Rust build-cache size check. Argless spawn = --guard mode: reads
  // a cached measurement, warns above 80% of CACHE_BUDGET_GB, refreshes the
  // cache in a detached background process. Exits 0 unconditionally — it must
  // never block or fail a build.
  "cache-budget": "scripts/cache-budget.mjs",
  // Composes per-agent WebP icons into sprite sheets. Previously orphaned
  // in vite buildStart only (asymmetric: `npm run dev` regenerated, plain
  // `npm run predev` did not). Listing here keeps the documented codegen
  // surface in sync with what actually runs.
  sprites:   "scripts/generate-agent-icon-sprites.mjs",
  // Regenerates src/features/shared/components/CATALOG.md — the discoverable
  // index of shared components (referenced from CLAUDE.md). Keeps it fresh so
  // new/removed shared components surface without a manual step.
  catalog:   "scripts/docs/gen-shared-catalog.mjs",
};

const PRESETS = {
  predev:   ["commands", "i18n", "i18n-split", "connectors", "n8n-limits", "host-check", "cache-budget", "sprites", "catalog"],
  prebuild: ["commands", "i18n", "i18n-split", "connectors", "n8n-limits", "checksums", "cache-budget", "sprites", "catalog"],
};

const TIMEOUT_MS = Number(process.env.CODEGEN_TIMEOUT_MS) || 60_000;

function runTask(name) {
  const scriptPath = TASKS[name];
  if (!scriptPath) {
    return Promise.reject(new Error(`Unknown codegen task: ${name}`));
  }
  const fullPath = join(repoRoot, scriptPath);
  const started = performance.now();

  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [fullPath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rej(Object.assign(new Error(`task "${name}" timed out after ${TIMEOUT_MS}ms`), {
        name, stdout, stderr, timedOut: true,
      }));
    }, TIMEOUT_MS);

    child.on("error", (err) => { clearTimeout(timer); rej(Object.assign(err, { name, stdout, stderr })); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const ms = Math.round(performance.now() - started);
      if (code === 0) {
        res({ name, ms, stdout, stderr });
      } else {
        rej(Object.assign(new Error(`task "${name}" exited ${code}`), {
          name, code, ms, stdout, stderr,
        }));
      }
    });
  });
}

const preset = process.argv[2];
if (!preset || !PRESETS[preset]) {
  console.error(`usage: node scripts/run-codegen.mjs <preset>`);
  console.error(`presets: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(2);
}

const tasks = PRESETS[preset];
const overall = performance.now();

const results = await Promise.allSettled(tasks.map(runTask));

let failed = 0;
for (const r of results) {
  if (r.status === "fulfilled") {
    const { name, ms, stdout } = r.value;
    process.stdout.write(`\n— ${name} (${ms}ms) —\n`);
    if (stdout.trim()) process.stdout.write(stdout);
  } else {
    failed += 1;
    const e = r.reason;
    process.stderr.write(`\n— ${e.name ?? "?"} FAILED —\n`);
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    process.stderr.write(`error: ${e.message}\n`);
  }
}

const totalMs = Math.round(performance.now() - overall);
process.stdout.write(`\n${preset}: ${tasks.length - failed}/${tasks.length} tasks ok (${totalMs}ms)\n`);

process.exit(failed === 0 ? 0 : 1);
