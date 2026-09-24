// Council - wrappers over the dev_tools_council_* Tauri commands.
//
// A council judges ONE subject (a major feature or an architecture redesign)
// across bounded members and never admits on its own: a clean run is escorted
// to the human gate. The /council skill writes files into the target repo; the
// ingest door is the only path from those files into SQLite, and the decide
// command is the only writer of a human decision.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { CouncilDecision } from "@/lib/bindings/CouncilDecision";
import type { CouncilIngestSummary } from "@/lib/bindings/CouncilIngestSummary";
import type { CouncilMedia } from "@/lib/bindings/CouncilMedia";
import type { CouncilOverlay } from "@/lib/bindings/CouncilOverlay";
import type { CouncilRunDetail } from "@/lib/bindings/CouncilRunDetail";
import type { CouncilSubjectState } from "@/lib/bindings/CouncilSubjectState";
import type { DevUseCase } from "@/lib/bindings/DevUseCase";
import type { RegistryGalaxy } from "@/lib/bindings/RegistryGalaxy";
import type { SkillEntry } from "@/lib/bindings/SkillEntry";

/** The shared skill a council dispatch invokes. Linked from the ai-registry. */
export const COUNCIL_SKILL = "council";

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

/**
 * Is the shared `/council` skill present in the target repo's `.claude/skills`?
 *
 * Deliberately NOT routed through `listSkills`, whose `safeInvoke` resolves a
 * failed read to `[]` — that would turn "the app could not look" into "the
 * skill is missing" and hand the operator a remedy for a problem they do not
 * have. A read failure throws here, and the dispatch's `prepare()` aborts with
 * the real error instead.
 */
export async function councilSkillInstalled(projectId: string): Promise<boolean> {
  const skills = await invoke<SkillEntry[]>("skill_files_list", { projectId });
  return skills.some((s) => s.name === COUNCIL_SKILL);
}

/** Only tier 'major' subjects reach the human gate. */
export async function setUseCaseTier(useCaseId: string, tier: UseCaseTier): Promise<DevUseCase> {
  return invoke<DevUseCase>("dev_tools_set_use_case_tier", { useCaseId, tier });
}

/** One run with its verdicts and the `sawDigest` the gate must hand back. */
export async function getCouncilRun(runId: string): Promise<CouncilRunDetail> {
  return invoke<CouncilRunDetail>("dev_tools_council_get_run", { runId });
}

export type CouncilDecisionKind = "approved" | "rejected";

/**
 * The ONLY writer of a human decision. `sawDigest` is compare-and-swap: the
 * door refuses when the council moved since the person looked.
 */
export async function decideCouncil(
  subjectId: string,
  runId: string,
  decision: CouncilDecisionKind,
  sawDigest: string,
  reason?: string,
): Promise<CouncilDecision> {
  return invoke<CouncilDecision>("dev_tools_council_decide", {
    subjectId,
    runId,
    decision,
    reason,
    sawDigest,
  });
}

/** Council signal per registry subject, across every project in the store. */
export async function getCouncilOverlay(): Promise<CouncilOverlay> {
  return invoke<CouncilOverlay>("dev_tools_council_overlay", {});
}

/** The registry topology, derived from the paired checkout on every read. */
export async function getRegistryGalaxy(registryRoot: string): Promise<RegistryGalaxy> {
  return invoke<RegistryGalaxy>("dev_tools_registry_galaxy", { registryRoot });
}

/** One evidence file from inside a run directory (path-confined by the door). */
export async function readCouncilMedia(runId: string, relPath: string): Promise<CouncilMedia> {
  return invoke<CouncilMedia>("dev_tools_council_read_media", { runId, relPath });
}
