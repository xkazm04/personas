#!/usr/bin/env node
/**
 * check-gate-negative-controls.mjs — every gate must be able to fail.
 *
 * A gate that has never been observed failing is an unvalidated instrument:
 * it exits 0, and that is all anyone knows. It may be asserting a tautology,
 * globbing zero files, or returning before its assertion. Every one of those
 * states is spelled "pass", indistinguishable from real coverage — and the
 * green mark is then quoted as evidence in exactly the arguments where it is
 * worth least.
 *
 * This script enumerates the gate registry rather than a hand-written list,
 * so a gate added without a negative control fails discovery instead of
 * review. The registry is package.json's `check:*` scripts: whatever those
 * invoke IS the gate set, by definition, because that is what CI runs.
 *
 * A gate is considered validated when a self-test exists at
 * scripts/__tests__/<gate-basename>.test.mjs. That file is where the negative
 * control lives: feed the gate a fixture engineered to violate the rule and
 * assert it reports the violation, then feed it a clean fixture and assert it
 * does not.
 *
 * Ratchet, not a wall. Most gates predate this script, so a hard failure on
 * day one would be turned off within the week. The baseline below is the
 * count of unvalidated gates at adoption; the check fails when that count
 * GROWS. Lower it whenever you add a self-test — never raise it.
 *
 * Run:   node scripts/check-gate-negative-controls.mjs
 *        node scripts/check-gate-negative-controls.mjs --json
 *        node scripts/check-gate-negative-controls.mjs --list
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Unvalidated gates at adoption (2026-09-06), measured by this script rather
// than counted by hand: the hand count from a directory listing said 14 gates
// and 3 validated, and was wrong on both halves. Ratchet down, never up.
const BASELINE_UNVALIDATED = 21;

/** Gate scripts this check deliberately does not require a self-test for. */
const EXEMPT = new Map([
  // Platform-specific crash-reporter probe; runs a real binary on Windows and
  // has no pure-function surface a fixture could drive.
  ["check-crash.ps1", "no fixture-drivable surface (launches a real binary)"],
]);

const SCRIPT_RE = /(?:^|\s)(?:node|bash|sh|pwsh|powershell)\s+(scripts\/[\w./-]+)/g;

function gateRegistry() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  const scripts = pkg.scripts ?? {};
  const gates = new Map(); // file -> Set of npm script names that invoke it

  for (const [name, body] of Object.entries(scripts)) {
    if (!name.startsWith("check:")) continue;
    for (const m of String(body).matchAll(SCRIPT_RE)) {
      const file = m[1];
      // A self-test invoked directly by a check:* script is not itself a gate
      // needing a negative control — it IS one. Without this the script asks
      // for <name>.test.test.mjs and reports a permanent MISS it can never
      // satisfy.
      if (file.includes("__tests__/") || /\.test\.m?js$/.test(file)) continue;
      // A check:* script may chain a generator before the gate proper
      // (`generate-x --check && check-y`); every script it runs is a gate,
      // because every one of them can fail the command CI depends on.
      if (!gates.has(file)) gates.set(file, new Set());
      gates.get(file).add(name);
    }
  }
  return gates;
}

function selfTestFor(file) {
  const stem = basename(file).replace(/\.(mjs|js|sh|ps1)$/, "");
  const candidate = `scripts/__tests__/${stem}.test.mjs`;
  return existsSync(resolve(ROOT, candidate)) ? candidate : null;
}

const gates = gateRegistry();
const rows = [...gates.entries()]
  .map(([file, viaSet]) => {
    const via = [...viaSet].sort();
    const exempt = EXEMPT.get(basename(file)) ?? null;
    const selfTest = selfTestFor(file);
    return { file, via, selfTest, exempt, missing: !selfTest && !exempt };
  })
  .sort((a, b) => a.file.localeCompare(b.file));

const missing = rows.filter((r) => r.missing);
const validated = rows.filter((r) => r.selfTest);

// An empty registry is the failure this script is most likely to have, and it
// would otherwise report a clean pass. Absence of gates is not proof of
// validated gates. This runs BEFORE the --json branch: the machine-readable
// path is the one CI reads, so exempting it from the guard would put the
// silent failure exactly where nobody is looking.
if (rows.length === 0) {
  console.error("check-gate-negative-controls: found no check:* scripts in package.json.");
  console.error("  Either the registry moved or the parser broke — this is a failure, not a pass.");
  process.exit(1);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ baseline: BASELINE_UNVALIDATED, total: rows.length, validated: validated.length, unvalidated: missing.length, rows }, null, 2));
  process.exit(missing.length > BASELINE_UNVALIDATED ? 1 : 0);
}

console.log(`Gate negative controls — ${validated.length}/${rows.length} gates carry a self-test\n`);

for (const r of rows) {
  const mark = r.selfTest ? "ok  " : r.exempt ? "skip" : "MISS";
  const note = r.selfTest ? r.selfTest : r.exempt ? `exempt — ${r.exempt}` : `expected scripts/__tests__/${basename(r.file).replace(/\.(mjs|js|sh|ps1)$/, "")}.test.mjs`;
  console.log(`  ${mark}  ${r.file}`);
  if (process.argv.includes("--list")) console.log(`        via ${r.via.join(", ")}`);
  console.log(`        ${note}`);
}

console.log(`\nunvalidated: ${missing.length} (baseline ${BASELINE_UNVALIDATED})`);

if (missing.length > BASELINE_UNVALIDATED) {
  console.error(`\nFAIL — ${missing.length - BASELINE_UNVALIDATED} gate(s) added without a negative control.`);
  console.error("Add scripts/__tests__/<gate>.test.mjs asserting the gate fires on a violating");
  console.error("fixture and stays quiet on a clean one, or add an EXEMPT entry with a reason.");
  process.exit(1);
}

if (missing.length < BASELINE_UNVALIDATED) {
  console.log(`\nBaseline is stale — lower BASELINE_UNVALIDATED to ${missing.length}.`);
}

process.exit(0);
