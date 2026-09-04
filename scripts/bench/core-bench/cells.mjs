// core-bench cell composition — PURE, deterministic given the JSON inputs.
//
// A cell = (archetype × focus domain × template): the archetype supplies the
// Core under test (identity + voice + principles), the template supplies the
// capabilities (use cases, tools, connectors), and the focus domain supplies
// the industry (kp role family + which template folders the capabilities come
// from). The grid is keyed on archetype × domain × template and on nothing
// else — the 7 numeric dials were deleted from the product in the
// agent-manifest rebase, and the grid did not shrink by a cell.
//
// No Date.now, no Math.random, no network, no app: composition is seeded by
// cell id (fnv1a) so two runs over the same JSON inputs compose byte-identical
// cells. The driver (run.mjs) materializes payloads from cells at call time.
//
// Ground truth this module is derived from (re-check before editing):
//   - scripts/templates/_archetypes.json          (9 archetypes, persona.core prose)
//   - scripts/templates/<category>/*.json         (schema-v3 templates)
//   - scripts/templates/_recipe_seeds.json        (recipe_ref id -> use-case name/description)
//   - scripts/bench/core-bench/domains.json       (industry mapping)
//   - src/lib/bindings/CreatePersonaResponsibilityInput.ts (+ nested bindings)

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// ---------------------------------------------------------------------------
// Deterministic hashing
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a over a string — the composition seed. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Dial bands — REMOVED (agent-manifest rebase, WP7).
//
// This module used to carry `band()` plus a VERBATIM copy of the dial and
// conflict directive prose from `src-tauri/engine/src/prompt/core_section.rs`,
// so the L1 asserts `core_dials_match` and `dial_prose_matches_band` could
// grep the assembled prompt for those exact sentences. WP2 deleted the band
// tables from the engine — the prose no longer exists anywhere in the product,
// so a mirror of it here would be a table that matches nothing, and two
// asserts that could only ever fail. Both are gone; the grid is unaffected
// because it is keyed on archetype × domain × template, never on a dial value.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Binding-field parsing (payload validation against the REAL ts-rs bindings)
// ---------------------------------------------------------------------------

/**
 * Parse a ts-rs binding file's `export type X = { ... }` into a field map.
 * Returns Map<fieldName, { optional: boolean }>. Tolerates the interleaved
 * JSDoc comments ts-rs emits; splits fields on top-level commas (tracking
 * <> {} [] () depth) so `Array<ResponsibilityOutcome>` never confuses it.
 */
export function parseBindingFields(tsSource) {
  const noComments = tsSource.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const m = noComments.match(/export type \w+\s*=\s*\{([\s\S]*)\}\s*;/);
  if (!m) throw new Error("parseBindingFields: no `export type X = {...};` found");
  const body = m[1];
  const fields = new Map();
  let depth = 0;
  let part = "";
  const flush = () => {
    const fm = part.match(/^\s*([A-Za-z_$][\w$]*)(\?)?\s*:/);
    if (fm) fields.set(fm[1], { optional: fm[2] === "?" });
    part = "";
  };
  for (const ch of body) {
    if ("<{[(".includes(ch)) depth++;
    else if (">}])".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      flush();
      continue;
    }
    part += ch;
  }
  flush();
  if (fields.size === 0) throw new Error("parseBindingFields: parsed zero fields — matcher broken, not a clean binding");
  return fields;
}

/** Load a binding's field map from src/lib/bindings/<Name>.ts. */
export function loadBindingFields(name, root = ROOT) {
  const file = path.join(root, "src", "lib", "bindings", `${name}.ts`);
  return parseBindingFields(readFileSync(file, "utf8"));
}

/**
 * Validate an object against a binding field map.
 * Returns { unknownKeys: string[], missingRequired: string[] } — both empty = valid.
 */
export function validateAgainstBinding(obj, fields) {
  const unknownKeys = Object.keys(obj).filter((k) => !fields.has(k));
  const missingRequired = [...fields.entries()]
    .filter(([, meta]) => !meta.optional)
    .map(([k]) => k)
    .filter((k) => obj[k] === undefined);
  return { unknownKeys, missingRequired };
}

/**
 * Validate a synthesized CreatePersonaResponsibilityInput (incl. nested
 * outcomes/objectives/cadence/tenure) and the synthesized PersonaCore against
 * the real committed bindings. Throws with a precise message on any drift —
 * this is the dry-run's "payload field names match the wire contract" gate.
 */
export function validateCellPayloads(cell, materialized, root = ROOT) {
  const problems = [];
  const check = (label, obj, bindingName) => {
    const res = validateAgainstBinding(obj, loadBindingFields(bindingName, root));
    for (const k of res.unknownKeys) problems.push(`${cell.id}: ${label}.${k} is not a field of ${bindingName}`);
    for (const k of res.missingRequired) problems.push(`${cell.id}: ${label} missing required ${bindingName}.${k}`);
  };
  const input = materialized.responsibilityInput;
  check("responsibilityInput", input, "CreatePersonaResponsibilityInput");
  input.outcomes.forEach((o, i) => check(`outcomes[${i}]`, o, "ResponsibilityOutcome"));
  input.objectives.forEach((o, i) => check(`objectives[${i}]`, o, "ResponsibilityObjective"));
  check("cadence", input.cadence, "ResponsibilityCadence");
  check("tenure", input.tenure, "ResponsibilityTenure");
  check("persona.core", materialized.designPayload.persona.core, "PersonaCore");
  return problems;
}

// ---------------------------------------------------------------------------
// Input loading
// ---------------------------------------------------------------------------

export function loadInputs(root = ROOT) {
  const readJson = (...p) => JSON.parse(readFileSync(path.join(root, ...p), "utf8"));

  const archetypesDoc = readJson("scripts", "templates", "_archetypes.json");
  const domains = readJson("scripts", "bench", "core-bench", "domains.json");
  const recipeSeeds = readJson("scripts", "templates", "_recipe_seeds.json");
  const recipesById = new Map(recipeSeeds.recipes.map((r) => [r.id, r]));

  // Load every template of every category a focus domain draws from.
  const templatesByCategory = new Map();
  const wanted = new Set(domains.focusDomains.flatMap((d) => d.categories));
  for (const category of wanted) {
    const dir = path.join(root, "scripts", "templates", category);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const templates = files.map((f) => {
      const t = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      return { ...t, _category: category, _file: f };
    });
    templatesByCategory.set(category, templates);
  }

  return { archetypes: archetypesDoc.archetypes, domains, recipesById, templatesByCategory };
}

// ---------------------------------------------------------------------------
// Template selection — affinity-ranked, seeded tie-break
// ---------------------------------------------------------------------------

/** Score a template for an archetype: count of its recipes whose seed category
 *  is one of the archetype's recipeAffinity buckets. Soft signal — recipe
 *  categories only partially overlap the 9-bucket vocabulary. */
function affinityScore(template, archetype, recipesById) {
  const affinity = new Set(archetype.recipeAffinity ?? []);
  let score = 0;
  for (const uc of template.payload?.use_cases ?? []) {
    const id = uc.recipe_ref?.id;
    const recipe = id ? recipesById.get(id) : undefined;
    if (recipe && affinity.has(recipe.category)) score++;
  }
  return score;
}

/** Pick up to `maxTemplates` templates from the domain's pool for one
 *  archetype: rank by affinity score desc, seeded hash asc (a deterministic
 *  shuffle within equal scores so different archetypes spread over the pool). */
export function pickTemplates(pool, archetype, domain, recipesById, maxTemplates) {
  const ranked = [...pool].sort((a, b) => {
    const sa = affinityScore(a, archetype, recipesById);
    const sb = affinityScore(b, archetype, recipesById);
    if (sb !== sa) return sb - sa;
    const ha = fnv1a(`${archetype.id}:${domain.id}:${a.id}`);
    const hb = fnv1a(`${archetype.id}:${domain.id}:${b.id}`);
    if (ha !== hb) return ha - hb;
    return a.id < b.id ? -1 : 1;
  });
  return ranked.slice(0, Math.max(1, Math.min(maxTemplates, ranked.length)));
}

// ---------------------------------------------------------------------------
// Cell composition
// ---------------------------------------------------------------------------

/** Resolve a template's recipe_ref use cases against the seed catalog.
 *  Tolerates inline (non-ref) use cases; records unresolvable refs. */
export function resolveUseCases(template, recipesById) {
  const resolved = [];
  const warnings = [];
  for (const uc of template.payload?.use_cases ?? []) {
    if (uc.recipe_ref?.id) {
      const recipe = recipesById.get(uc.recipe_ref.id);
      if (recipe) {
        resolved.push({
          id: recipe.source_use_case_id,
          name: recipe.name,
          description: recipe.description ?? "",
        });
      } else {
        warnings.push(`unresolvable recipe_ref ${uc.recipe_ref.id}`);
      }
    } else if (uc.title || uc.name) {
      resolved.push({
        id: uc.id ?? null,
        name: uc.title ?? uc.name,
        description: uc.description ?? "",
      });
    }
  }
  return { resolved, warnings };
}

/**
 * Compose the full cell matrix. Deterministic given the loaded inputs.
 * `maxTemplates` caps templates per (archetype × domain) — default 2 per the
 * WP7 brief's "pick 1-2 templates from the domain's category folder".
 */
export function composeCells(inputs, { maxTemplates = 2 } = {}) {
  const { archetypes, domains, recipesById, templatesByCategory } = inputs;
  const cells = [];
  for (const archetype of archetypes) {
    for (const domain of domains.focusDomains) {
      const pool = domain.categories.flatMap((c) => templatesByCategory.get(c) ?? []);
      if (pool.length === 0) {
        throw new Error(
          `composeCells: focus domain '${domain.id}' has an EMPTY template pool ` +
            `(categories: ${domain.categories.join(", ")}) — looked at nothing is not success`,
        );
      }
      const picks = pickTemplates(pool, archetype, domain, recipesById, maxTemplates);
      for (const template of picks) {
        const { resolved, warnings } = resolveUseCases(template, recipesById);
        cells.push({
          id: `${archetype.id}.${domain.id}.${template.id}`,
          archetypeId: archetype.id,
          archetypeName: archetype.name,
          domainId: domain.id,
          family: domain.family,
          control: Boolean(domain.control),
          category: template._category,
          templateId: template.id,
          templateName: template.name,
          personaName: `CB ${archetype.name} · ${template.name}`.slice(0, 80),
          responsibilityTitle: `${template.name} — ${domain.family} charter`,
          useCases: resolved,
          compositionWarnings: warnings,
        });
      }
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Payload materialization (still pure — string building only)
// ---------------------------------------------------------------------------

/**
 * Build the PersonaCore JSON (camelCase, per the PersonaCore binding /
 * `#[serde(rename_all = "camelCase")]`) from an archetype: the 7 authored
 * dials plus the living-agent additive identity/voice/principles fields
 * folded in from the archetype's persona prose, so the rendered `## Manifest`
 * section carries the full Character. (The 7 dials still ride along in the
 * seed and no longer reach a prompt — see the README's re-anchor note.)
 */
export function buildArchetypeCore(archetype) {
  const p = archetype.persona;
  const identity = [p.identity?.role, p.identity?.description]
    .filter(Boolean)
    .join(". ")
    .replace(/\.\. /g, ". ");
  return {
    ...p.core, // motivation, stance, northStarCommitment, riskTolerance, speedVsQuality, conflictStyle, deference
    identity,
    voice: p.voice?.style ?? "",
    principles: p.principles ?? [],
    constraints: p.constraints ?? [],
    decisionPrinciples: p.decision_principles ?? [],
  };
}

/**
 * Synthesize the `/adopt-template` design payload for a cell: the TEMPLATE's
 * own `payload` with the ARCHETYPE's core + identity + voice + principles +
 * constraints + decision_principles substituted in. The template keeps its
 * capabilities (goal, use_cases, tools, connectors, operating_instructions,
 * adoption_questions, parameters); the archetype supplies the Character.
 * `instant_adopt_template_inner` stamps `core_profile` from
 * `design.persona.core` (template_adopt.rs:368-372, seed-if-absent at :638).
 */
export function synthesizeDesignPayload(cell, inputs) {
  const archetype = inputs.archetypes.find((a) => a.id === cell.archetypeId);
  const template = (inputs.templatesByCategory.get(cell.category) ?? []).find(
    (t) => t.id === cell.templateId,
  );
  if (!archetype || !template) {
    throw new Error(`synthesizeDesignPayload: cell ${cell.id} lost its archetype or template`);
  }
  const payload = structuredClone(template.payload);
  const p = archetype.persona;
  payload.persona = {
    ...payload.persona,
    core: buildArchetypeCore(archetype),
    identity: structuredClone(p.identity),
    voice: structuredClone(p.voice),
    principles: [...(p.principles ?? [])],
    constraints: [...(p.constraints ?? [])],
    decision_principles: [...(p.decision_principles ?? [])],
  };
  payload.persona_meta = {
    ...(payload.persona_meta ?? {}),
    name: cell.personaName,
  };
  return payload;
}

// Refusal-class libraries — mirror personas-engine responsibility.rs:70-86.
// Non-software families get the general library; the control row gets two of
// kp's software classes. Bare unknown strings are refused at intake, so only
// these (or `custom:`-prefixed) spellings are wire-valid.
const SOFTWARE_REFUSALS = ["credentials_or_permissions", "delivery_configuration"];
const GENERAL_REFUSALS = ["ExternalSend", "CredentialUse"];

/**
 * Synthesize the CreatePersonaResponsibilityInput for a cell (wire camelCase
 * per the binding). Title from the template mission, outcomes from 2-3
 * resolved use-case titles with their descriptions as success criteria,
 * 2 measurable objectives, domain from domains.json, scopeRung 0, attention
 * off, `source` absent (the operator command stamps 'operator' itself).
 */
export function synthesizeResponsibilityInput(cell, personaId) {
  const ucs = cell.useCases.slice(0, 3);
  const outcomes = ucs.map((uc, i) => ({
    id: `out-${cell.id}-${i}`.replace(/[^A-Za-z0-9._-]/g, "-"),
    statement: uc.name,
    successCriteria: [uc.description.slice(0, 300) || `${uc.name} completes to the operator's standard`],
  }));
  if (outcomes.length === 0) {
    outcomes.push({
      id: `out-${cell.id}-goal`.replace(/[^A-Za-z0-9._-]/g, "-"),
      statement: `${cell.templateName} delivers its mission`,
      successCriteria: ["The template's stated goal is met on each run"],
    });
  }
  const objectives = [
    {
      key: "runs_clean",
      label: `${ucs[0]?.name ?? cell.templateName} runs complete without operator rescue`,
      baseline: 0,
      target: 90,
      unit: "%",
      direction: "up",
      source: "core-bench synthetic",
    },
    {
      key: "bar_upheld",
      label: `${cell.archetypeName} quality bar upheld on judge review`,
      baseline: 0,
      target: 4,
      unit: "of 5",
      direction: "up",
      source: "core-bench judge",
    },
  ];
  // The operating procedure, composed from the template's own use cases. The
  // charter shape gained `connectors` / `procedure` / `spec` in the
  // agent-manifest rebase (e19); all three are REQUIRED on the create door.
  //   - `connectors: []` means "whatever the persona holds" per the binding's
  //     own contract — a bench cell declares no connector of its own.
  //   - `spec: {}` is what a hand-authored charter carries; this one is
  //     hand-authored by the composer and has no recipe provenance to claim.
  // Neither is filler standing in for a value we know and withheld.
  const procedure =
    ucs.length > 0
      ? ucs.map((uc) => `- ${uc.name}: ${uc.description || uc.name}`.slice(0, 400)).join("\n")
      : `Carry out ${cell.templateName} to the ${cell.archetypeName} standard.`;
  return {
    personaId,
    title: cell.responsibilityTitle,
    domain: cell.family,
    outcomes,
    objectives,
    scopeRung: 0,
    refusalClasses:
      cell.family === "software_engineering" ? [...SOFTWARE_REFUSALS] : [...GENERAL_REFUSALS],
    approvalGates: ["operator-review"],
    owner: "operator",
    cadence: { attentionEnabled: false },
    budgetMonthlyUsd: 5,
    tenure: { retireCriteria: [`core-bench cell ${cell.id} teardown`] },
    status: "active",
    connectors: [],
    procedure,
    spec: {},
  };
}

/** Materialize both payloads for a cell. */
export function materializeCell(cell, inputs, personaId = "PERSONA_ID_PLACEHOLDER") {
  return {
    designPayload: synthesizeDesignPayload(cell, inputs),
    responsibilityInput: synthesizeResponsibilityInput(cell, personaId),
  };
}

// ---------------------------------------------------------------------------
// L2 scenario selection
// ---------------------------------------------------------------------------

/** Substitute the scenario bank's {{CONNECTOR}}/{{DECOY}} placeholders. */
export function resolveScenarioIntent(scenario) {
  let text = scenario.true_intent ?? "";
  const pick = scenario.connector_choice?.preferred_pick;
  const decoy = scenario.connector_choice?.decoy;
  if (pick) text = text.replaceAll("{{CONNECTOR}}", pick);
  if (decoy) text = text.replaceAll("{{DECOY}}", decoy);
  return text;
}

/**
 * Pick ONE scenario for a cell from the onboarding-bench bank: rows matching
 * the cell's template category (`business_area`), preferring rows sourced
 * from the cell's own template, seeded by cell id. Returns null when the bank
 * has no row for the area (the caller reports incomplete, never a silent 0).
 */
export function pickScenario(cell, scenarios) {
  const area = scenarios.filter((s) => s.business_area === cell.category);
  if (area.length === 0) return null;
  const own = area.filter((s) => s.source_template_id === cell.templateId);
  const pool = own.length > 0 ? own : area;
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1));
  return sorted[fnv1a(cell.id) % sorted.length];
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Resolve an env-carried positive number. UNSET and SET-TO-EMPTY both mean
 * "use the default" — CI renders an unset variable as a set, EMPTY string,
 * and `??` would smuggle that "" through `Number()` as 0 (for the money cap
 * below, a cap that admits nothing). Anything else must parse to a finite
 * positive number; a corrupt value HALTS instead of silently resolving to a
 * number nobody typed (environment-variable-configuration golden path).
 */
export function resolveEnvPositiveNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name}=${JSON.stringify(raw)} must be a finite positive number`);
  }
  return value;
}

/** Serial spend ledger: admit cells only while measured spend is under cap. */
export class BudgetLedger {
  constructor(capUsd) {
    this.capUsd = capUsd;
    this.spentUsd = 0;
  }
  /** May the NEXT cell start? (Strictly: only while spend so far < cap.) */
  admit() {
    return this.spentUsd < this.capUsd;
  }
  record(costUsd) {
    if (Number.isFinite(costUsd) && costUsd > 0) this.spentUsd += costUsd;
  }
}

// The deterministic L1 assert ids — baseline.json's requiredExpectations and
// run.mjs's assert keys both come from here so they cannot drift apart.
export const L1_ASSERTS = [
  "adopted",
  "core_profile_stamped",
  "responsibility_created",
  "core_section_present",
  "responsibilities_section_present",
  "responsibility_title_present",
];

export const L2_ASSERTS = ["execution_terminal", "execution_completed", "cost_recorded"];
