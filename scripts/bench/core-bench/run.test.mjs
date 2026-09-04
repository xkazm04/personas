// core-bench unit tests — the PURE parts only (no network, no app).
// Run: node --test scripts/bench/core-bench/
//
// Covers: composition determinism, payload field-name validation against the
// REAL committed bindings (parsed at test time, not a fixture copy), the dial
// band cuts, budget stop-at-cap, and gate logic incl. the unmeasured case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ROOT,
  fnv1a,
  parseBindingFields,
  loadBindingFields,
  validateAgainstBinding,
  validateCellPayloads,
  loadInputs,
  composeCells,
  materializeCell,
  buildArchetypeCore,
  pickScenario,
  resolveScenarioIntent,
  resolveEnvPositiveNumber,
  BudgetLedger,
  L1_ASSERTS,
} from "./cells.mjs";
import { evaluateGate, expectedCellsFor } from "./gate.mjs";
import { verdictSchema, JUDGE_DIMS } from "./judge-packet.mjs";

const inputs = loadInputs();

// ---------------------------------------------------------------------------
// Composition determinism
// ---------------------------------------------------------------------------

test("composition is deterministic: two composes over the same inputs are deep-equal", () => {
  const a = composeCells(inputs);
  const b = composeCells(loadInputs());
  assert.deepEqual(a, b);
});

test("matrix covers all 9 archetypes and all 7 focus domains, with 1-2 templates per cell pair", () => {
  const cells = composeCells(inputs);
  assert.ok(cells.length > 0, "composed zero cells — looked at nothing is not success");
  const archetypes = new Set(cells.map((c) => c.archetypeId));
  const domains = new Set(cells.map((c) => c.domainId));
  assert.equal(archetypes.size, 9);
  assert.equal(domains.size, 7);
  const perPair = new Map();
  for (const c of cells) {
    const k = `${c.archetypeId}.${c.domainId}`;
    perPair.set(k, (perPair.get(k) ?? 0) + 1);
  }
  assert.equal(perPair.size, 63, "every archetype × domain pair composes");
  for (const [pair, n] of perPair) {
    assert.ok(n >= 1 && n <= 2, `${pair} picked ${n} templates (brief: 1-2)`);
  }
});

test("cell ids are unique and keyed on archetype × domain × template, nothing else", () => {
  const cells = composeCells(inputs);
  const ids = new Set(cells.map((c) => c.id));
  assert.equal(ids.size, cells.length, "duplicate cell ids");
  const byArchetype = new Map(inputs.archetypes.map((a) => [a.id, a]));
  for (const c of cells) {
    // The id IS the key: dropping the deleted dials from the cell must not
    // change which cells exist or what identifies them.
    assert.equal(c.id, `${c.archetypeId}.${c.domainId}.${c.templateId}`);
    assert.ok(byArchetype.has(c.archetypeId), `unknown archetype ${c.archetypeId}`);
  }
});

test("materialization is deterministic and Date-free for the same cell", () => {
  const cells = composeCells(inputs);
  const cell = cells[7];
  const a = materializeCell(cell, inputs, "p-1");
  const b = materializeCell(cell, inputs, "p-1");
  assert.deepEqual(a, b);
});

test("design payload substitutes the archetype Core but keeps the template capabilities", () => {
  const cells = composeCells(inputs);
  const cell = cells.find((c) => c.domainId === "finance");
  const archetype = inputs.archetypes.find((a) => a.id === cell.archetypeId);
  const template = inputs.templatesByCategory
    .get(cell.category)
    .find((t) => t.id === cell.templateId);
  const { designPayload } = materializeCell(cell, inputs);
  // Archetype Character substituted in…
  assert.equal(designPayload.persona.core.riskTolerance, archetype.persona.core.riskTolerance);
  assert.equal(designPayload.persona.identity.role, archetype.persona.identity.role);
  assert.deepEqual(designPayload.persona.principles, archetype.persona.principles);
  // …the template capabilities kept…
  assert.deepEqual(designPayload.use_cases, template.payload.use_cases);
  assert.equal(designPayload.persona.goal, template.payload.persona.goal);
  // …and the persona named per cell (unique names for live cleanup).
  assert.equal(designPayload.persona_meta.name, cell.personaName);
});

test("buildArchetypeCore folds identity/voice/principles into camelCase PersonaCore fields", () => {
  const guardian = inputs.archetypes.find((a) => a.id === "guardian");
  const core = buildArchetypeCore(guardian);
  assert.equal(typeof core.northStarCommitment, "string");
  assert.ok(core.identity.includes(guardian.persona.identity.role));
  assert.equal(core.voice, guardian.persona.voice.style);
  assert.deepEqual(core.decisionPrinciples, guardian.persona.decision_principles);
  assert.ok(!("decision_principles" in core), "wire is camelCase, not snake_case");
});

// ---------------------------------------------------------------------------
// Dial bands — the two tests that lived here are GONE with the machinery they
// covered (`band`, `expectedDialDirectives`, `DIAL_DIRECTIVES`). WP2 deleted
// the band tables from `core_section.rs`; a mirror of prose that no longer
// exists cannot fail honestly. The grid-shape test above is what now proves
// the 126 cells survived their removal.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Payload validation against the REAL bindings
// ---------------------------------------------------------------------------

test("parseBindingFields reads the committed CreatePersonaResponsibilityInput", () => {
  const fields = loadBindingFields("CreatePersonaResponsibilityInput");
  for (const required of [
    "personaId",
    "title",
    "outcomes",
    "objectives",
    "scopeRung",
    "refusalClasses",
    "approvalGates",
    "owner",
    "cadence",
    "tenure",
  ]) {
    assert.ok(fields.has(required), `binding lost field ${required}`);
    assert.equal(fields.get(required).optional, false, `${required} should be required`);
  }
  for (const optional of ["domain", "budgetMonthlyUsd", "status", "projectId"]) {
    assert.ok(fields.has(optional), `binding lost field ${optional}`);
    assert.equal(fields.get(optional).optional, true, `${optional} should be optional`);
  }
  assert.ok(!fields.has("source"), "source is stamped by the command, never wire input");
});

test("every composed cell's payloads validate against the bindings (zero problems)", () => {
  const cells = composeCells(inputs);
  const problems = [];
  for (const cell of cells) {
    problems.push(...validateCellPayloads(cell, materializeCell(cell, inputs), ROOT));
  }
  assert.deepEqual(problems, []);
});

test("validation FAILS on a bogus key and on a missing required field (the check can fail)", () => {
  const fields = loadBindingFields("CreatePersonaResponsibilityInput");
  const bogus = validateAgainstBinding({ personaId: "p", bogusField: 1 }, fields);
  assert.deepEqual(bogus.unknownKeys, ["bogusField"]);
  assert.ok(bogus.missingRequired.includes("title"));
});

test("parseBindingFields fails loud on a source with no type body", () => {
  assert.throws(() => parseBindingFields("// nothing here"), /no `export type/);
});

test("PersonaCore binding still carries the living-agent additive fields the composer writes", () => {
  const fields = loadBindingFields("PersonaCore");
  for (const f of ["identity", "voice", "principles", "constraints", "decisionPrinciples"]) {
    assert.ok(fields.has(f), `PersonaCore lost ${f}`);
  }
});

// ---------------------------------------------------------------------------
// L2 scenario pick
// ---------------------------------------------------------------------------

test("pickScenario is deterministic, area-matched, and null (not 0) when the bank has no row", () => {
  const scenarios = JSON.parse(
    readFileSync(
      path.join(ROOT, "docs", "tests", "onboarding-bench", "scenarios", "scenarios.json"),
      "utf8",
    ),
  ).scenarios;
  const cells = composeCells(inputs);
  const cell = cells.find((c) => c.category === "finance");
  const s1 = pickScenario(cell, scenarios);
  const s2 = pickScenario(cell, scenarios);
  assert.ok(s1, "finance has bank rows");
  assert.equal(s1.id, s2.id, "seeded pick is stable");
  assert.equal(s1.business_area, "finance");
  const none = pickScenario({ ...cell, category: "no-such-area" }, scenarios);
  assert.equal(none, null);
});

test("resolveScenarioIntent substitutes the connector placeholders", () => {
  const text = resolveScenarioIntent({
    true_intent: "use {{CONNECTOR}} not {{DECOY}}",
    connector_choice: { preferred_pick: "teams", decoy: "slack" },
  });
  assert.equal(text, "use teams not slack");
});

// ---------------------------------------------------------------------------
// Budget: stop-at-cap
// ---------------------------------------------------------------------------

test("BudgetLedger admits while under cap and stops once measured spend reaches it", () => {
  const ledger = new BudgetLedger(1.0);
  assert.equal(ledger.admit(), true);
  ledger.record(0.6);
  assert.equal(ledger.admit(), true, "under cap: next cell admitted");
  ledger.record(0.5); // total 1.1 — a cell may overshoot; the NEXT one is refused
  assert.equal(ledger.admit(), false, "at/over cap: no further admissions");
  ledger.record(Number.NaN); // junk cost never corrupts the ledger
  assert.equal(ledger.spentUsd, 1.1);
});

test("resolveEnvPositiveNumber: unset and set-to-empty both mean the default; corrupt halts", () => {
  const NAME = "CORE_BENCH_TEST_RESOLVER";
  const prior = process.env[NAME];
  try {
    delete process.env[NAME];
    assert.equal(resolveEnvPositiveNumber(NAME, 15), 15, "unset -> default");
    process.env[NAME] = "";
    assert.equal(resolveEnvPositiveNumber(NAME, 15), 15, "set-to-empty -> default, never Number('')=0");
    process.env[NAME] = "  ";
    assert.equal(resolveEnvPositiveNumber(NAME, 15), 15, "whitespace -> default");
    process.env[NAME] = "30";
    assert.equal(resolveEnvPositiveNumber(NAME, 15), 30, "a typed value wins");
    process.env[NAME] = "unlimited";
    assert.throws(() => resolveEnvPositiveNumber(NAME, 15), /finite positive/, "corrupt halts");
    process.env[NAME] = "0";
    assert.throws(() => resolveEnvPositiveNumber(NAME, 15), /finite positive/, "0 is not a cap that admits nothing by accident");
    process.env[NAME] = "-1";
    assert.throws(() => resolveEnvPositiveNumber(NAME, 15), /finite positive/, "negative halts");
  } finally {
    if (prior === undefined) delete process.env[NAME];
    else process.env[NAME] = prior;
  }
});

// ---------------------------------------------------------------------------
// Gate: regression, unmeasured (≠ zero), pass
// ---------------------------------------------------------------------------

const gateBaseline = {
  defaults: { mustPass: true, requiredExpectations: ["core_section_present"] },
  l2: { requiredExpectations: ["execution_terminal"] },
  cells: {},
};

test("gate passes a fully-measured green L1 run", () => {
  const result = {
    mode: "l1",
    cells: [
      { id: "a.x.t", verdict: "pass", asserts: { core_section_present: "pass" } },
      { id: "b.x.t", verdict: "pass", asserts: { core_section_present: "pass" } },
    ],
  };
  const v = evaluateGate({ baseline: gateBaseline, result, expectedCellIds: ["a.x.t", "b.x.t"] });
  assert.equal(v.ok, true, JSON.stringify(v.failures));
});

test("gate fails on a regression (a measured fail)", () => {
  const result = {
    mode: "l1",
    cells: [{ id: "a.x.t", verdict: "fail", asserts: { core_section_present: "fail" } }],
  };
  const v = evaluateGate({ baseline: gateBaseline, result, expectedCellIds: ["a.x.t"] });
  assert.equal(v.ok, false);
  assert.equal(v.failures[0].kind, "regression");
});

test("gate fails on UNMEASURED cells and asserts — unmeasured is never 0", () => {
  const result = {
    mode: "l1",
    cells: [
      { id: "a.x.t", verdict: "incomplete", reason: "adopt failed", asserts: {} },
      { id: "b.x.t", verdict: "pass", asserts: {} }, // claims pass but never measured the assert
    ],
  };
  const v = evaluateGate({
    baseline: gateBaseline,
    result,
    expectedCellIds: ["a.x.t", "b.x.t", "c.x.t"], // c.x.t absent entirely
  });
  assert.equal(v.ok, false);
  const kinds = v.failures.map((f) => f.kind);
  assert.deepEqual([...new Set(kinds)], ["unmeasured"]);
  assert.equal(v.failures.length, 3, "incomplete cell + unmeasured assert + absent cell all count");
});

test("gate refuses an EMPTY cell universe — looked at nothing is not green", () => {
  const result = {
    mode: "l1",
    cells: [{ id: "a.x.t", verdict: "pass", asserts: { core_section_present: "pass" } }],
  };
  const v = evaluateGate({ baseline: gateBaseline, result, expectedCellIds: [] });
  assert.equal(v.ok, false, "zero expected cells must not pass");
  assert.equal(v.failures[0].kind, "unmeasured");
  assert.match(v.failures[0].detail, /enumeration.*broken/);
});

test("gate refuses to treat a dry-run plan as measured", () => {
  const v = evaluateGate({
    baseline: gateBaseline,
    result: { mode: "dry-run", cells: [] },
    expectedCellIds: ["a.x.t"],
  });
  assert.equal(v.ok, false);
  assert.match(v.failures[0].detail, /dry-run plan is not a pass/);
});

test("gate on L2 answers only for the cells the run admitted, honors --allow-budget-cap", () => {
  const result = {
    mode: "l2",
    cells: [
      { id: "a.x.t", verdict: "pass", asserts: { execution_terminal: "pass" } },
      { id: "b.x.t", verdict: "incomplete", reason: "budget_cap", asserts: {} },
    ],
  };
  const expected = expectedCellsFor(result, ["a.x.t", "b.x.t", "z.z.z"]);
  assert.deepEqual(expected, ["a.x.t", "b.x.t"], "L2 never answers for unsampled cells");
  const strict = evaluateGate({ baseline: gateBaseline, result, expectedCellIds: expected });
  assert.equal(strict.ok, false, "budget_cap is unmeasured by default");
  const relaxed = evaluateGate({
    baseline: gateBaseline,
    result,
    expectedCellIds: expected,
    allowBudgetCap: true,
  });
  assert.equal(relaxed.ok, true, JSON.stringify(relaxed.failures));
});

test("baseline.json's required expectations are exactly the driver's L1 assert ids", () => {
  const baseline = JSON.parse(
    readFileSync(path.join(ROOT, "scripts", "bench", "core-bench", "baseline.json"), "utf8"),
  );
  assert.deepEqual(baseline.defaults.requiredExpectations, L1_ASSERTS);
});

// ---------------------------------------------------------------------------
// Judge packet schema
// ---------------------------------------------------------------------------

test("verdict schema carries all five judge dims and six criteria slots", () => {
  const s = verdictSchema("a.x.t", "l1");
  assert.deepEqual(Object.keys(s.dims), JUDGE_DIMS);
  assert.equal(s.criteria.length, 6);
  assert.equal(s.verdict, null, "the judge fills the verdict; the schema never pre-passes");
});

// ---------------------------------------------------------------------------
// Hash stability (composition seeds)
// ---------------------------------------------------------------------------

test("fnv1a is stable across runs (pinned values)", () => {
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
  assert.equal(fnv1a("core-bench"), fnv1a("core-bench"));
});
