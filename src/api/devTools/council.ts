// Council - wrappers over the dev_tools_council_* Tauri commands.
//
// A council judges ONE subject (a major feature or an architecture redesign)
// across bounded members and never admits on its own: a clean run is escorted
// to the human gate. The /council skill writes files into the target repo; the
// ingest door is the only path from those files into SQLite, and the decide
// command is the only writer of a human decision.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { CouncilIngestSummary } from "@/lib/bindings/CouncilIngestSummary";
import type { CouncilSubjectState } from "@/lib/bindings/CouncilSubjectState";
import type { DevUseCase } from "@/lib/bindings/DevUseCase";

/** Derived, never stored. `running` is a frontend overlay from fleet sessions. */
export const COUNCIL_STATES = [
  "none",
  "fail",
  "incomplete",
  "stalled",
  "ready",
  "machine_pass",
  "approved",
  "approved_drifted",
  "rejected",
] as const;
export type CouncilState = (typeof COUNCIL_STATES)[number];

export const USE_CASE_TIERS = ["major", "standard"] as const;
export type UseCaseTier = (typeof USE_CASE_TIERS)[number];

/** Every council subject, optionally scoped to one project. */
export async function listCouncilSubjects(projectId?: string): Promise<CouncilSubjectState[]> {
  return invoke<CouncilSubjectState[]>("dev_tools_council_list_subjects", { projectId });
}

/** Sweep `<repo>/.personas/council/runs/` for the project (or one run dir). */
export async function ingestCouncilRuns(
  projectId: string,
  runDir?: string,
): Promise<CouncilIngestSummary> {
  return invoke<CouncilIngestSummary>("dev_tools_council_ingest", { projectId, runDir });
}

/** Only tier 'major' subjects reach the human gate. */
export async function setUseCaseTier(useCaseId: string, tier: UseCaseTier): Promise<DevUseCase> {
  return invoke<DevUseCase>("dev_tools_set_use_case_tier", { useCaseId, tier });
}
