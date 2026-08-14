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

// ---------------------------------------------------------------- CSP ------
// The Content-Security-Policy is the single most load-bearing string in this
// repo's client security, and until 2026-08-14 NOTHING read it. This script
// validated schema, overlays and features and skipped `csp` entirely; there is
// no ESLint rule and no test. A one-word edit adding 'unsafe-inline' passed
// `npm run check`, 2,400 Vitest tests and CI.
//
// It matters more here than in a web app: `withGlobalTauri: true` exposes the
// IPC surface to any script that executes in the renderer, so script execution
// is not a session-cookie problem, it is local command execution. A 2026-08-14
// audit found ZERO unsanitized sinks (5 dangerouslySetInnerHTML, all
// sanitized; rehype-raw absent; 32/32 anchors carrying rel) — and concluded
// the CSP is doing more work than every sanitizer combined, while being the
// only one of them that nothing verifies.
//
// This assertion FAILS rather than SKIPS when the key is missing. A check that
// silently passes on absent input is the failure mode this repo has found in
// four separate gates during this wave — an FK assertion against an empty
// database, a parity test comparing a file to itself, a secret scan exiting 0
// when the scanner is absent, and a doc-sync glob matching no file.
// Parse DIRECTIVES, never substring-match the whole policy.
//
// The first version of this check did `csp.includes("'unsafe-inline'")` and
// immediately failed the clean tree — because `style-src 'unsafe-inline'` is
// present, normal, and required by React/Tailwind inline styles. It is not a
// script-execution risk. That is the same error this repo has now found four
// times (the Tauri command count that counted string literals in its own
// checker, the timestamp columns compared across different tables, the index
// names matched globally): a substring match answers "does this text appear",
// never "is this a thing". Caught here only because the gate was tested
// against the real tree before landing, which is the whole argument for the
// positive control.
//
// Only script-executing directives are checked. `default-src` counts because
// it is the fallback when `script-src` is absent.
const SCRIPT_DIRECTIVES = new Set(["script-src", "script-src-elem", "script-src-attr", "default-src"]);
const BANNED_CSP_TOKENS = ["'unsafe-inline'", "'unsafe-eval'"];

function parseCsp(text) {
  const out = new Map();
  for (const part of text.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [directive, ...values] = trimmed.split(/\s+/);
    out.set(directive.toLowerCase(), values);
  }
  return out;
}

function checkCsp(name, json) {
  const csp = json?.app?.security?.csp;
  if (csp === undefined) {
    // Overlays legitimately omit it — they inherit the canonical value. The
    // canonical config must not.
    if (name === CANONICAL) {
      problems.push(
        `${name}: app.security.csp is MISSING. Absent is not the same as permissive-by-accident — ` +
          `declare it explicitly. This check fails rather than skips precisely so a deleted CSP ` +
          `cannot read as a clean run.`,
      );
    }
    return;
  }
  if (csp === null) {
    problems.push(`${name}: app.security.csp is null, which disables CSP entirely.`);
    return;
  }
  const text = typeof csp === "string" ? csp : JSON.stringify(csp);
  const directives = parseCsp(text);

  for (const [directive, values] of directives) {
    if (!SCRIPT_DIRECTIVES.has(directive)) continue;
    for (const token of BANNED_CSP_TOKENS) {
      if (values.includes(token)) {
        problems.push(
          `${name}: app.security.csp has ${token} in "${directive}". With withGlobalTauri enabled ` +
            `that turns any injected markup into local command execution. If this is deliberate, ` +
            `remove the token from BANNED_CSP_TOKENS with a written reason — never weaken it silently. ` +
            `(style-src 'unsafe-inline' is NOT checked: it is required by React/Tailwind and cannot ` +
            `execute script.)`,
        );
      }
    }
  }

  if (!directives.has("script-src") && !directives.has("default-src")) {
    problems.push(
      `${name}: app.security.csp declares neither script-src nor default-src, so script loading is ungoverned.`,
    );
  }
}
checkCsp(CANONICAL, canonical);
for (const { name, json } of overlays) checkCsp(name, json);

if (problems.length) {
  console.error("Tauri config check failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Tauri configs ok (${[CANONICAL, ...OVERLAYS].join(", ")})`);
