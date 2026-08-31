#!/usr/bin/env node
// core-bench driver — Core×industry generalization bench for the living-agent
// Core/Responsibility model. Three modes:
//
//   --dry-run  (DEFAULT)  compose every cell, validate payload field names
//                         against the real ts-rs bindings, write the plan +
//                         synthetic assertions. NO network, no app needed.
//   --l1                  live, no execution spend: adopt each cell's persona
//                         (archetype Core × industry template), create its
//                         responsibility charter, fetch the assembled prompt
//                         (preview_execution), run the deterministic asserts,
//                         write per-cell prompt artifacts for the judge,
//                         tear the persona down.
//   --l2 --sample <n>     live, AFTER L1: sampled cells run ONE scenario from
//                         the onboarding-bench bank (true_intent as the task),
//                         poll to terminal state, record real cost. Budget-
//                         capped by CORE_BENCH_MAX_USD (default 15): cells not
//                         admitted report incomplete{budget_cap} — unmeasured
//                         is never reported as 0.
//
// Prerequisite for --l1/--l2: the app running `npm run tauri:dev:test`
// (test-automation HTTP server on 127.0.0.1:17320). See README.md — that
// port evals arbitrary JS in the app WebView; treat it as an RCE surface.
//
// Serial by design. Every cell verdict ∈ pass | fail | incomplete{reason}.

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ROOT,
  loadInputs,
  composeCells,
  materializeCell,
  validateCellPayloads,
  pickScenario,
  resolveScenarioIntent,
  BudgetLedger,
  L1_ASSERTS,
  L2_ASSERTS,
} from "./cells.mjs";

const RUNS_DIR = path.join(ROOT, "docs", "tests", "core-bench", "runs");
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "timeout"]);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    base: "http://127.0.0.1:17320",
    sample: 5,
    limit: Infinity,
    maxTemplates: 2,
    emitPayloads: false,
    keepPersonas: false,
    seed: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.mode = "dry-run";
    else if (a === "--l1") args.mode = "l1";
    else if (a === "--l2") args.mode = "l2";
    else if (a === "--base") args.base = argv[++i];
    else if (a === "--sample") args.sample = Number(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--max-templates") args.maxTemplates = Number(argv[++i]);
    else if (a === "--emit-payloads") args.emitPayloads = true;
    else if (a === "--keep-personas") args.keepPersonas = true;
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// HTTP driver (test-automation server on :17320)
// ---------------------------------------------------------------------------

async function post(base, route, body, timeoutMs = 120_000) {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${route} -> non-JSON response: ${text.slice(0, 400)}`);
  }
}

/** invokeCommand passthrough: any Tauri command via the bridge. */
async function invokeCommand(base, command, params, timeoutSecs = 90) {
  const envelope = await post(base, "/bridge-exec", {
    method: "invokeCommand",
    params: { command, params },
    timeout_secs: timeoutSecs,
  });
  if (!envelope || envelope.success !== true) {
    throw new Error(`invokeCommand ${command} failed: ${envelope?.error ?? JSON.stringify(envelope).slice(0, 300)}`);
  }
  return envelope.result;
}

async function bridge(base, method, params, timeoutSecs = 90) {
  return post(base, "/bridge-exec", { method, params, timeout_secs: timeoutSecs });
}

async function adoptCell(base, cell, designPayload) {
  const res = await post(base, "/adopt-template", {
    template_name: cell.templateId,
    design_result_json: JSON.stringify(designPayload),
  });
  if (res?.success !== true) throw new Error(`adopt failed: ${res?.error ?? "unknown"}`);
  const personaId = res?.result?.persona?.id;
  if (!personaId) throw new Error("adopt succeeded but returned no persona.id");
  return personaId;
}

async function teardown(base, personaId, keep) {
  if (keep || !personaId) return;
  try {
    await bridge(base, "deletePersona", { personaId }, 60);
  } catch (e) {
    console.warn(`  teardown of ${personaId} failed (non-fatal): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Cell verdicts
// ---------------------------------------------------------------------------

function verdictFrom(asserts, requiredNames) {
  const values = requiredNames.map((n) => asserts[n]);
  if (values.some((v) => v === "fail")) return "fail";
  if (values.every((v) => v === "pass")) return "pass";
  return "incomplete";
}

function newAsserts(names) {
  return Object.fromEntries(names.map((n) => [n, "incomplete"]));
}

// ---------------------------------------------------------------------------
// L1 — deterministic asserts over the assembled prompt (no execution spend)
// ---------------------------------------------------------------------------

async function runL1Cell(base, cell, inputs, cellDir, keepPersonas) {
  const asserts = newAsserts(L1_ASSERTS);
  let reason;
  let personaId;
  try {
    const { designPayload, responsibilityInput } = materializeCell(cell, inputs);

    personaId = await adoptCell(base, cell, designPayload);
    asserts.adopted = "pass";

    // core_profile stamped with the archetype's dials?
    const persona = await invokeCommand(base, "get_persona", { id: personaId });
    const rawCore = persona?.core_profile;
    asserts.core_profile_stamped = rawCore ? "pass" : "fail";
    if (rawCore) {
      try {
        const stamped = JSON.parse(rawCore);
        const d = cell.expected.dials;
        const dialsMatch =
          stamped.riskTolerance === d.riskTolerance &&
          stamped.speedVsQuality === d.speedVsQuality &&
          stamped.deference === d.deference &&
          String(stamped.conflictStyle) === String(d.conflictStyle);
        asserts.core_dials_match = dialsMatch ? "pass" : "fail";
        writeFileSync(path.join(cellDir, "core_profile.json"), JSON.stringify(stamped, null, 2));
      } catch {
        asserts.core_dials_match = "fail";
      }
    }

    // Create the responsibility charter through the operator door.
    responsibilityInput.personaId = personaId;
    const responsibility = await invokeCommand(
      base,
      "create_persona_responsibility",
      { input: responsibilityInput },
    );
    asserts.responsibility_created = responsibility?.id ? "pass" : "fail";

    // Assembled prompt — same path a real run takes (preview_execution).
    const preview = await invokeCommand(base, "preview_execution", {
      personaId,
      inputData: null,
      useCaseId: null,
    });
    const prompt = preview?.prompt_preview ?? "";
    writeFileSync(path.join(cellDir, "prompt.md"), prompt);

    asserts.core_section_present = prompt.includes("## Core") ? "pass" : "fail";
    asserts.responsibilities_section_present = prompt.includes("## Responsibilities")
      ? "pass"
      : "fail";
    const dir = cell.expected.directives;
    const dialProse =
      prompt.includes(dir.riskTolerance) &&
      prompt.includes(dir.speedVsQuality) &&
      prompt.includes(dir.deference) &&
      (dir.conflictStyle === null || prompt.includes(dir.conflictStyle));
    asserts.dial_prose_matches_band = dialProse ? "pass" : "fail";
    asserts.responsibility_title_present = prompt.includes(
      `### ${cell.responsibilityTitle} (${cell.family})`,
    )
      ? "pass"
      : "fail";
  } catch (e) {
    reason = e.message.slice(0, 500);
  } finally {
    await teardown(base, personaId, keepPersonas);
  }
  const verdict = reason ? "incomplete" : verdictFrom(asserts, L1_ASSERTS);
  return { verdict, reason, asserts, personaId };
}

// ---------------------------------------------------------------------------
// L2 — sampled live executions, budget-capped
// ---------------------------------------------------------------------------

function loadScenarios() {
  const file = path.join(
    ROOT,
    "docs",
    "tests",
    "onboarding-bench",
    "scenarios",
    "scenarios.json",
  );
  return JSON.parse(readFileSync(file, "utf8")).scenarios;
}

async function pollExecutionTerminal(base, executionId, personaId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await invokeCommand(base, "get_execution", {
      id: executionId,
      callerPersonaId: personaId,
    });
    if (TERMINAL_STATUSES.has(last?.status)) return last;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return last ?? null;
}

async function runL2Cell(base, cell, inputs, scenarios, cellDir, ledger, keepPersonas) {
  const asserts = newAsserts(L2_ASSERTS);
  let reason;
  let personaId;
  let costUsd = 0;
  try {
    const scenario = pickScenario(cell, scenarios);
    if (!scenario) {
      return {
        verdict: "incomplete",
        reason: `no scenario in the bank for business_area '${cell.category}'`,
        asserts,
        costUsd: 0,
      };
    }
    const task = resolveScenarioIntent(scenario);

    const { designPayload, responsibilityInput } = materializeCell(cell, inputs);
    personaId = await adoptCell(base, cell, designPayload);
    responsibilityInput.personaId = personaId;
    await invokeCommand(base, "create_persona_responsibility", { input: responsibilityInput });

    const execRes = await post(base, "/execute-persona", {
      name_or_id: personaId,
      input_data: { task, source: "core-bench L2", scenario_id: scenario.id },
    });
    if (execRes?.success !== true) throw new Error(`execute failed: ${execRes?.error ?? "unknown"}`);
    const executionId = execRes?.execution?.id;
    if (!executionId) throw new Error("execute returned no execution.id");

    const timeoutMs = Number(process.env.CORE_BENCH_L2_TIMEOUT_MS ?? 600_000);
    const finalRow = await pollExecutionTerminal(base, executionId, personaId, timeoutMs);
    writeFileSync(
      path.join(cellDir, "execution.json"),
      JSON.stringify({ scenarioId: scenario.id, task, execution: finalRow }, null, 2),
    );
    if (finalRow?.output_data) {
      writeFileSync(path.join(cellDir, "transcript.md"), String(finalRow.output_data));
    }

    const terminal = TERMINAL_STATUSES.has(finalRow?.status);
    asserts.execution_terminal = terminal ? "pass" : "fail";
    asserts.execution_completed = finalRow?.status === "completed" ? "pass" : "fail";
    costUsd = Number(finalRow?.cost_usd ?? 0);
    asserts.cost_recorded = Number.isFinite(costUsd) && terminal ? "pass" : "incomplete";
    ledger.record(costUsd);
  } catch (e) {
    reason = e.message.slice(0, 500);
  } finally {
    await teardown(base, personaId, keepPersonas);
  }
  const verdict = reason ? "incomplete" : verdictFrom(asserts, L2_ASSERTS);
  return { verdict, reason, asserts, costUsd, personaId };
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function newRunDir(mode) {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(RUNS_DIR, `${iso}-${mode}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeResult(runDir, result) {
  writeFileSync(path.join(runDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(`\nresult: ${path.join(runDir, "result.json")}`);
}

function summarize(cells) {
  const counts = { pass: 0, fail: 0, incomplete: 0 };
  for (const c of cells) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
  return counts;
}

async function dryRun(args) {
  const inputs = loadInputs();
  const cells = composeCells(inputs, { maxTemplates: args.maxTemplates });
  const runDir = newRunDir("dry-run");

  const problems = [];
  const planCells = [];
  for (const cell of cells) {
    const materialized = materializeCell(cell, inputs);
    problems.push(...validateCellPayloads(cell, materialized, ROOT));
    planCells.push({
      ...cell,
      syntheticAsserts: L1_ASSERTS,
      responsibilityInput: materialized.responsibilityInput,
      designPayloadBytes: JSON.stringify(materialized.designPayload).length,
    });
    if (args.emitPayloads) {
      const cellDir = path.join(runDir, "cells", cell.id);
      mkdirSync(cellDir, { recursive: true });
      writeFileSync(
        path.join(cellDir, "design_payload.json"),
        JSON.stringify(materialized.designPayload, null, 2),
      );
    }
  }

  const archetypes = new Set(cells.map((c) => c.archetypeId));
  const domains = new Set(cells.map((c) => c.domainId));
  const templates = new Set(cells.map((c) => c.templateId));

  writeFileSync(path.join(runDir, "plan.json"), JSON.stringify({ cells: planCells }, null, 2));
  writeResult(runDir, {
    version: 1,
    mode: "dry-run",
    startedAt: new Date().toISOString(),
    maxTemplates: args.maxTemplates,
    matrix: {
      archetypes: archetypes.size,
      domains: domains.size,
      distinctTemplates: templates.size,
      cells: cells.length,
    },
    payloadValidation: {
      problems,
      ok: problems.length === 0,
      bindingsChecked: [
        "CreatePersonaResponsibilityInput",
        "ResponsibilityOutcome",
        "ResponsibilityObjective",
        "ResponsibilityCadence",
        "ResponsibilityTenure",
        "PersonaCore",
      ],
    },
    // Dry-run composes and validates; it MEASURES nothing. Every cell is
    // incomplete by definition — unmeasured is never reported as 0 or pass.
    cells: cells.map((c) => ({
      id: c.id,
      verdict: "incomplete",
      reason: "not_executed_dry_run",
      asserts: Object.fromEntries(L1_ASSERTS.map((a) => [a, "incomplete"])),
    })),
  });

  console.log(
    `dry-run: composed ${cells.length} cells ` +
      `(${archetypes.size} archetypes × ${domains.size} domains, ${templates.size} distinct templates)`,
  );
  if (problems.length > 0) {
    console.error(`payload validation FAILED — ${problems.length} problems:`);
    for (const p of problems.slice(0, 20)) console.error("  -", p);
    process.exit(1);
  }
  console.log("payload validation: all field names match the committed bindings");
  const warned = cells.filter((c) => c.compositionWarnings.length > 0);
  if (warned.length > 0) {
    console.log(`composition warnings on ${warned.length} cells (recorded in plan.json)`);
  }
}

async function l1Run(args) {
  const inputs = loadInputs();
  const cells = composeCells(inputs, { maxTemplates: args.maxTemplates }).slice(0, args.limit);
  const runDir = newRunDir("l1");
  const results = [];
  let n = 0;
  for (const cell of cells) {
    n++;
    const cellDir = path.join(runDir, "cells", cell.id);
    mkdirSync(cellDir, { recursive: true });
    process.stdout.write(`[${n}/${cells.length}] ${cell.id} … `);
    const r = await runL1Cell(args.base, cell, inputs, cellDir, args.keepPersonas);
    console.log(r.verdict + (r.reason ? ` (${r.reason.slice(0, 120)})` : ""));
    results.push({ id: cell.id, verdict: r.verdict, reason: r.reason, asserts: r.asserts });
    writeFileSync(path.join(cellDir, "asserts.json"), JSON.stringify(r, null, 2));
  }
  writeResult(runDir, {
    version: 1,
    mode: "l1",
    startedAt: new Date().toISOString(),
    base: args.base,
    maxTemplates: args.maxTemplates,
    limited: Number.isFinite(args.limit) ? args.limit : null,
    totals: summarize(results),
    cells: results,
  });
  console.log("totals:", JSON.stringify(summarize(results)));
}

async function l2Run(args) {
  const inputs = loadInputs();
  const all = composeCells(inputs, { maxTemplates: args.maxTemplates });
  const scenarios = loadScenarios();
  const capUsd = Number(process.env.CORE_BENCH_MAX_USD ?? 15);
  const ledger = new BudgetLedger(capUsd);

  // Seeded sample: rotate a deterministic offset through the matrix so
  // repeated L2 runs (different --seed) cover different cells.
  const sampled = [];
  const stride = Math.max(1, Math.floor(all.length / Math.max(1, args.sample)));
  for (let i = 0; i < args.sample && i * stride < all.length; i++) {
    sampled.push(all[(i * stride + args.seed) % all.length]);
  }

  const runDir = newRunDir("l2");
  const results = [];
  let n = 0;
  for (const cell of sampled) {
    n++;
    const cellDir = path.join(runDir, "cells", cell.id);
    mkdirSync(cellDir, { recursive: true });
    if (!ledger.admit()) {
      console.log(`[${n}/${sampled.length}] ${cell.id} — NOT ADMITTED (budget cap $${capUsd} reached at $${ledger.spentUsd.toFixed(2)})`);
      results.push({
        id: cell.id,
        verdict: "incomplete",
        reason: "budget_cap",
        asserts: Object.fromEntries(L2_ASSERTS.map((a) => [a, "incomplete"])),
      });
      continue;
    }
    process.stdout.write(`[${n}/${sampled.length}] ${cell.id} (spent $${ledger.spentUsd.toFixed(2)}/${capUsd}) … `);
    const r = await runL2Cell(args.base, cell, inputs, scenarios, cellDir, ledger, args.keepPersonas);
    console.log(`${r.verdict} ($${(r.costUsd ?? 0).toFixed(3)})` + (r.reason ? ` (${r.reason.slice(0, 120)})` : ""));
    results.push({
      id: cell.id,
      verdict: r.verdict,
      reason: r.reason,
      asserts: r.asserts,
      costUsd: r.costUsd ?? 0,
    });
    writeFileSync(path.join(cellDir, "asserts.json"), JSON.stringify(r, null, 2));
  }
  writeResult(runDir, {
    version: 1,
    mode: "l2",
    startedAt: new Date().toISOString(),
    base: args.base,
    maxTemplates: args.maxTemplates,
    sample: args.sample,
    seed: args.seed,
    budget: { capUsd, spentUsd: ledger.spentUsd },
    totals: summarize(results),
    cells: results,
  });
  console.log(`totals: ${JSON.stringify(summarize(results))} spend $${ledger.spentUsd.toFixed(2)} of $${capUsd}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "dry-run") await dryRun(args);
  else if (args.mode === "l1") await l1Run(args);
  else if (args.mode === "l2") await l2Run(args);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error("core-bench driver failed:", e);
    process.exit(1);
  });
}
