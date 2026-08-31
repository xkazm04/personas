#!/usr/bin/env node
// core-bench regression gate — exits non-zero when a run's result.json
// regresses baseline.json OR when a required expectation went UNMEASURED.
//
// Repo law, copied doctrine: unmeasured ≠ zero. A cell that never ran, a run
// in dry-run mode, an assert the driver never reached — all of those are
// `incomplete`, and this gate treats incomplete as NOT-GREEN, never as pass
// and never as a silent 0. (Precedents: engine/src/headless.rs backbone_verdict,
// scoring.rs verdict_status, kp baseline requiredExpectations.)
//
// Usage:
//   node scripts/bench/core-bench/gate.mjs                     # latest run dir
//   node scripts/bench/core-bench/gate.mjs --run <dir>         # specific run
//   node scripts/bench/core-bench/gate.mjs --allow-budget-cap  # L2: accept budget_cap incompletes

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadInputs, composeCells } from "./cells.mjs";

export const RUNS_DIR = path.join(ROOT, "docs", "tests", "core-bench", "runs");

/**
 * Pure gate logic.
 *
 * baseline: { defaults: { mustPass, requiredExpectations: [...] }, cells: { <id>: {...overrides} } }
 * result:   a run's result.json ({ mode, cells: [{ id, verdict, reason?, asserts: {name: pass|fail|incomplete} }] })
 * expectedCellIds: the cell ids the gate holds the run accountable for.
 * allowBudgetCap: accept `incomplete{budget_cap}` cells (L2 sampling stopped at the cap by design).
 *
 * Returns { ok, failures: [{ kind: 'regression'|'unmeasured', ... }] }.
 */
export function evaluateGate({ baseline, result, expectedCellIds, allowBudgetCap = false }) {
  const failures = [];
  const mode = result?.mode;
  if (mode !== "l1" && mode !== "l2") {
    failures.push({
      kind: "unmeasured",
      detail: `run mode '${mode ?? "unknown"}' carries no measured expectations — a dry-run plan is not a pass`,
    });
    return { ok: false, failures };
  }
  // Mode-aware expectations: L1 runs answer for the deterministic prompt
  // asserts; L2 runs answer for the execution asserts of the cells they admitted.
  const modeDefaults =
    mode === "l2"
      ? {
          ...(baseline.defaults ?? {}),
          requiredExpectations: baseline.l2?.requiredExpectations ?? [],
        }
      : (baseline.defaults ?? {});
  const byId = new Map((result?.cells ?? []).map((c) => [c.id, c]));
  for (const id of expectedCellIds) {
    const cellBaseline = { ...modeDefaults, ...((baseline.cells ?? {})[id] ?? {}) };
    if (cellBaseline.mustPass === false) continue;
    const cell = byId.get(id);
    if (!cell) {
      failures.push({ kind: "unmeasured", cellId: id, detail: "cell absent from result.json" });
      continue;
    }
    if (cell.verdict === "incomplete") {
      if (allowBudgetCap && cell.reason === "budget_cap") continue;
      failures.push({
        kind: "unmeasured",
        cellId: id,
        detail: `incomplete: ${cell.reason ?? "unspecified"}`,
      });
      continue;
    }
    for (const exp of cellBaseline.requiredExpectations ?? []) {
      const v = cell.asserts?.[exp];
      if (v === "pass") continue;
      if (v === undefined || v === "incomplete") {
        failures.push({ kind: "unmeasured", cellId: id, expectation: exp });
      } else {
        failures.push({ kind: "regression", cellId: id, expectation: exp, value: v });
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

/** The expected-cell universe for a result: L1 answers for the FULL matrix;
 *  L2 answers for the cells its own sampling admitted (listed in the result). */
export function expectedCellsFor(result, allCellIds) {
  if (result?.mode === "l2") return (result.cells ?? []).map((c) => c.id);
  return allCellIds;
}

export function latestRunDir() {
  if (!existsSync(RUNS_DIR)) return null;
  const dirs = readdirSync(RUNS_DIR)
    .filter((d) => existsSync(path.join(RUNS_DIR, d, "result.json")))
    .sort();
  return dirs.length ? path.join(RUNS_DIR, dirs[dirs.length - 1]) : null;
}

function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run");
  const allowBudgetCap = args.includes("--allow-budget-cap");
  const runDir = runIdx >= 0 ? path.resolve(args[runIdx + 1]) : latestRunDir();
  if (!runDir || !existsSync(path.join(runDir, "result.json"))) {
    console.error("gate: no run with a result.json found — nothing measured, and unmeasured is not green.");
    process.exit(1);
  }
  const result = JSON.parse(readFileSync(path.join(runDir, "result.json"), "utf8"));
  const baseline = JSON.parse(
    readFileSync(path.join(ROOT, "scripts", "bench", "core-bench", "baseline.json"), "utf8"),
  );
  const allCellIds = composeCells(loadInputs(), {
    maxTemplates: result.maxTemplates ?? 2,
  }).map((c) => c.id);
  const expectedCellIds = expectedCellsFor(result, allCellIds);
  const verdict = evaluateGate({ baseline, result, expectedCellIds, allowBudgetCap });
  const unmeasured = verdict.failures.filter((f) => f.kind === "unmeasured").length;
  const regressions = verdict.failures.filter((f) => f.kind === "regression").length;
  console.log(
    `gate: run=${path.basename(runDir)} mode=${result.mode} cells-expected=${expectedCellIds.length} ` +
      `regressions=${regressions} unmeasured=${unmeasured}`,
  );
  for (const f of verdict.failures.slice(0, 40)) console.log("  -", JSON.stringify(f));
  if (verdict.failures.length > 40) console.log(`  … +${verdict.failures.length - 40} more`);
  process.exit(verdict.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
