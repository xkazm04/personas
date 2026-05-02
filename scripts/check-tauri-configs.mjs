#!/usr/bin/env node
// Validate the three Tauri config files: tauri.conf.json (canonical) and
// the tauri.lite / tauri.stable overlay configs. Catches:
//   - JSON parse errors
//   - $schema drift between configs
//   - overlays setting unexpected keys (so the overlay surface stays small)
//   - features referenced by configs that don't exist in Cargo.toml's [features]

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(repoRoot, "src-tauri");
const cargoToml = join(tauriDir, "Cargo.toml");

const CANONICAL = "tauri.conf.json";
const OVERLAYS = ["tauri.lite.conf.json", "tauri.stable.conf.json"];

// Keys an overlay is allowed to override. Expand intentionally.
const ALLOWED_OVERLAY_KEYS = new Set([
  "build.features",
  "bundle.targets",
]);

const problems = [];

function readJson(name) {
  const p = join(tauriDir, name);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
    return null;
  }
}

// Walk an object and yield "a.b.c" paths for each leaf-or-array.
function* paths(obj, prefix = "") {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    yield prefix;
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    yield* paths(v, next);
  }
}

function readCargoFeatures() {
  const text = readFileSync(cargoToml, "utf8");
  // Parse the [features] table by hand — avoids a TOML dependency and the
  // table is shallow (key = [...] lines only).
  const m = text.match(/^\[features\][\s\S]*?(?=^\[|\Z)/m);
  if (!m) return new Set();
  const out = new Set();
  for (const line of m[0].split(/\r?\n/)) {
    const mm = line.match(/^\s*([A-Za-z][\w-]*)\s*=/);
    if (mm) out.add(mm[1]);
  }
  return out;
}

const canonical = readJson(CANONICAL);
const overlays = OVERLAYS.map((n) => ({ name: n, json: readJson(n) }));

if (canonical && canonical.$schema) {
  for (const { name, json } of overlays) {
    if (json && json.$schema && json.$schema !== canonical.$schema) {
      problems.push(`${name}: $schema differs from ${CANONICAL} (${json.$schema} vs ${canonical.$schema})`);
    }
  }
}

for (const { name, json } of overlays) {
  if (!json) continue;
  for (const path of paths(json)) {
    if (path === "$schema") continue;
    if (!ALLOWED_OVERLAY_KEYS.has(path)) {
      // Allow paths that descend through allowed keys (e.g. "build.features"
      // is allowed; "build.features.0" should be too via prefix match).
      const allowed = [...ALLOWED_OVERLAY_KEYS].some((k) => path === k || path.startsWith(`${k}.`));
      if (!allowed) {
        problems.push(`${name}: overlays unexpected key "${path}" (allowed: ${[...ALLOWED_OVERLAY_KEYS].join(", ")})`);
      }
    }
  }
}

const declared = readCargoFeatures();
function checkFeatures(name, json) {
  const list = json?.build?.features;
  if (!Array.isArray(list)) return;
  for (const f of list) {
    if (!declared.has(f)) {
      problems.push(`${name}: build.features references "${f}" which is not declared in src-tauri/Cargo.toml [features]`);
    }
  }
}
checkFeatures(CANONICAL, canonical);
for (const { name, json } of overlays) checkFeatures(name, json);

if (problems.length) {
  console.error("Tauri config check failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Tauri configs ok (${[CANONICAL, ...OVERLAYS].join(", ")})`);
