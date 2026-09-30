/**
 * Read `design_context.kpLink.requirements` (kp.agent-requirements.v1) off a
 * persona row for the "Requirements from kp" panel.
 *
 * The Rust side stores the object kp sent, normalized at intake
 * (`personas_engine::kp_requirements::normalize`), and types it as `JsonValue`
 * on the `KpLink` binding because kp owns the schema. So this is a tolerant
 * parse at the boundary rather than a cast: every field is checked for its
 * shape, a wrong-shaped one reads as absent, and anything that is not this
 * kind reads as "no requirements" rather than as a half-rendered panel.
 *
 * It parses the raw `design_context` string itself instead of going through
 * `parseDesignContext` (`sub_lab/use-cases/UseCasesList.tsx`), whose
 * structured-envelope check only recognises `designFiles` / `credentialLinks`
 * / `useCases` and would rebuild a kpLink-only envelope without the link.
 */

import { silentCatchNull } from '@/lib/silentCatch';

export const KP_REQUIREMENTS_KIND = 'kp.agent-requirements.v1';

export interface KpRequirementCraft {
  recipe: string;
  title: string;
  need: string;
  coreAction: string;
  successCriteria: string[];
  lessons: string[];
}

export interface KpRequirementResearch {
  gigsResearched: number | null;
  categories: string[];
  commonAsks: string[];
  commonChallenges: string[];
  effortMin: number | null;
  effortMax: number | null;
  asOf: string;
}

export interface KpRequirementOutputs {
  contract: string;
  handoffFile: string;
  clientFilesDir: string;
  processLog: string;
  reviewChecklist: string[];
}

export interface KpRequirementTool {
  connector: string;
  why: string;
}

export interface KpRequirementsView {
  role: string;
  arena: string;
  niche: string;
  purpose: string;
  responsibilities: string[];
  craft: KpRequirementCraft[];
  research: KpRequirementResearch | null;
  inputs: { assignment: string; fields: string[] } | null;
  outputs: KpRequirementOutputs | null;
  constraints: string[];
  tools: KpRequirementTool[];
  budgetUsdPerAttempt: number | null;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter((s) => s.length > 0);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseCraft(v: unknown): KpRequirementCraft[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((c) => ({
    recipe: str(c.recipe),
    title: str(c.title),
    need: str(c.need),
    coreAction: str(c.coreAction),
    successCriteria: strList(c.successCriteria),
    lessons: strList(c.lessons),
  })).filter((c) => c.recipe || c.title);
}

function parseResearch(v: unknown): KpRequirementResearch | null {
  if (!isObj(v)) return null;
  const effort = isObj(v.typicalEffortHours) ? v.typicalEffortHours : null;
  return {
    gigsResearched: num(v.gigsResearched),
    categories: strList(v.categories),
    commonAsks: strList(v.commonAsks),
    commonChallenges: strList(v.commonChallenges),
    effortMin: effort ? num(effort.min) : null,
    effortMax: effort ? num(effort.max) : null,
    asOf: str(v.asOf),
  };
}

function parseOutputs(v: unknown): KpRequirementOutputs | null {
  if (!isObj(v)) return null;
  return {
    contract: str(v.contract),
    handoffFile: str(v.handoffFile),
    clientFilesDir: str(v.clientFilesDir),
    processLog: str(v.processLog),
    reviewChecklist: strList(v.reviewChecklist),
  };
}

function parseTools(v: unknown): KpRequirementTool[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((t) => ({ connector: str(t.connector), why: str(t.why) }))
    .filter((t) => t.connector.length > 0);
}

/** Parse the requirements object itself. `null` when it is not this kind. */
export function parseKpRequirements(value: unknown): KpRequirementsView | null {
  if (!isObj(value) || str(value.kind) !== KP_REQUIREMENTS_KIND) return null;
  const inputs = isObj(value.inputs)
    ? { assignment: str(value.inputs.assignment), fields: strList(value.inputs.fields) }
    : null;
  return {
    role: str(value.role),
    arena: str(value.arena),
    niche: str(value.niche),
    purpose: str(value.purpose),
    responsibilities: strList(value.responsibilities),
    craft: parseCraft(value.craft),
    research: parseResearch(value.research),
    inputs,
    outputs: parseOutputs(value.outputs),
    constraints: strList(value.constraints),
    tools: parseTools(value.tools),
    budgetUsdPerAttempt: num(value.budgetUsdPerAttempt),
  };
}

/**
 * The requirements of a persona, from its raw `design_context` column.
 * `null` for every persona that was not hired from kp requirements, and for a
 * column that does not parse — this panel is provenance, never a blocker.
 */
export function kpRequirementsFromDesignContext(
  designContext: string | null | undefined,
): KpRequirementsView | null {
  if (!designContext || !designContext.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(designContext);
  } catch (err) {
    // A corrupt design_context column means "no provenance to show" — the
    // panel is never a blocker — but it leaves a breadcrumb.
    return silentCatchNull('kpRequirements:parseDesignContext')(err);
  }
  if (!isObj(parsed) || !isObj(parsed.kpLink)) return null;
  return parseKpRequirements(parsed.kpLink.requirements);
}
