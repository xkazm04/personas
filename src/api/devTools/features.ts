// Features - wrappers over the dev_tools_feature_board and scenario commands.
//
// A feature is a slice through contexts, so every context has a ROLE relative
// to the features that exist: core, tests, platform, or unclaimed. A feature is
// also not uniform, so it has SCENARIOS - the feature applied to one condition
// ("marketing candidates") - and a council judges each in-scope one separately,
// turning an approval into an ENVELOPE rather than a stamp.
//
// The board is ONE read for the whole page. A project carries 50-100 features
// over 200+ contexts; a per-feature round trip would be a hundred IPC calls to
// paint one screen.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { FeatureBoard } from "@/lib/bindings/FeatureBoard";
import type { FeatureScenario } from "@/lib/bindings/FeatureScenario";
import type { UpsertScenarioInput } from "@/lib/bindings/UpsertScenarioInput";

/**
 * What a scenario is to the product. `proposed` is the only one that is not a
 * decision: a council named this branch and nobody has ruled on it yet, and it
 * moves no number until a person adopts it.
 */
export const SCENARIO_SCOPES = ["proposed", "must_hold", "tracked", "out_of_scope"] as const;
export type ScenarioScope = (typeof SCENARIO_SCOPES)[number];

/** Who put a scenario on the board. */
export const SCENARIO_SOURCES = ["operator", "council", "telemetry", "incident"] as const;
export type ScenarioSource = (typeof SCENARIO_SOURCES)[number];

/**
 * The proof ladder, strongest first. RECORDED and never gated: a model playing
 * a marketing candidate is not a marketing candidate, so `simulated` evidence
 * can flag a weakness and cannot, alone, certify a `must_hold` branch - but
 * that judgement belongs to the member and the person, not to a rule.
 */
export const SCENARIO_PROOFS = ["observed", "replayed", "simulated", "claimed"] as const;
export type ScenarioProof = (typeof SCENARIO_PROOFS)[number];

/** The role a context holds relative to the features that exist. */
export const CONTEXT_ROLES = ["core", "tests", "platform", "unclaimed"] as const;
export type ContextRole = (typeof CONTEXT_ROLES)[number];

/** The floor a scenario is held to when it declares none of its own. */
export const SCENARIO_DEFAULT_FLOOR = 0.5;

/** The whole Features page for one project, in one read. */
export async function getFeatureBoard(projectId: string): Promise<FeatureBoard> {
  return invoke<FeatureBoard>("dev_tools_feature_board", { projectId });
}

/** One feature's declared branches, in declaration order. */
export async function listScenarios(useCaseId: string): Promise<FeatureScenario[]> {
  return invoke<FeatureScenario[]>("dev_tools_list_scenarios", { useCaseId });
}

/**
 * Create or update one scenario. Omit `id` to create; omit `slug` to derive it
 * from the title. Anything written here is source `operator` - the council's
 * own discoveries arrive through the ingest door as `proposed`.
 */
export async function upsertScenario(input: UpsertScenarioInput): Promise<FeatureScenario> {
  return invoke<FeatureScenario>("dev_tools_upsert_scenario", { input });
}

/** Delete one scenario and the results that judged it. */
export async function deleteScenario(id: string): Promise<void> {
  return invoke<void>("dev_tools_delete_scenario", { id });
}
