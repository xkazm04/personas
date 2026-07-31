import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AssignmentOutcome } from "@/lib/bindings/AssignmentOutcome";
import type { TeamMemberTrust } from "@/lib/bindings/TeamMemberTrust";
import type { TeamMemory } from "@/lib/bindings/TeamMemory";

// ============================================================================
// Self-Evolving Team v1 — the learning ledger (read-only surface).
// The write path is engine-side: the orchestrator's terminal hook records
// outcomes, updates Brier trust, and convenes retrospectives.
// ============================================================================

/** Learning record for one assignment; null for pre-feature assignments. */
export const getAssignmentOutcome = (assignmentId: string) =>
  invoke<AssignmentOutcome | null>("get_assignment_outcome", { assignmentId });

export const listAssignmentOutcomes = (teamId: string, limit?: number) =>
  invoke<AssignmentOutcome[]>("list_assignment_outcomes", {
    teamId,
    limit: limit ?? null,
  });

/** Outcome-learned (Brier-updated, floored) trust per roster member. */
export const listTeamMemberTrust = (teamId: string) =>
  invoke<TeamMemberTrust[]>("list_team_member_trust", { teamId });

/** Lessons distilled by past retrospectives (tags include `lesson`). */
export const listTeamLessons = (teamId: string, limit?: number) =>
  invoke<TeamMemory[]>("list_team_lessons", { teamId, limit: limit ?? null });

/** Typed shape of AssignmentOutcome.outcomeJson (parsed client-side). */
export interface OutcomeStepEvidence {
  stepId: string;
  title: string;
  personaId: string | null;
  strategy: string;
  confidence: number | null;
  durationSecs: number | null;
  result: string;
  retryCount: number;
  trustBefore?: number;
  trustAfter?: number;
}

export function parseOutcomeSteps(outcomeJson: string): OutcomeStepEvidence[] {
  try {
    const parsed: unknown = JSON.parse(outcomeJson);
    const steps = (parsed as { steps?: unknown })?.steps;
    return Array.isArray(steps) ? (steps as OutcomeStepEvidence[]) : [];
  } catch {
    return [];
  }
}
