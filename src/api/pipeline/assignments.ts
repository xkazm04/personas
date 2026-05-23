import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { CreateTeamAssignmentInput } from "@/lib/bindings/CreateTeamAssignmentInput";
import type { DecomposedStep } from "@/lib/bindings/DecomposedStep";
import type { ResolveStepReviewAction } from "@/lib/bindings/ResolveStepReviewAction";
import type { TeamAssignment } from "@/lib/bindings/TeamAssignment";
import type { TeamAssignmentDetail } from "@/lib/bindings/TeamAssignmentDetail";
import type { TeamAssignmentEvent } from "@/lib/bindings/TeamAssignmentEvent";
import type { TeamAssignmentStep } from "@/lib/bindings/TeamAssignmentStep";

// ============================================================================
// Team Assignments (orchestration Phase A)
// ============================================================================

export const createTeamAssignment = (input: CreateTeamAssignmentInput) =>
  invoke<TeamAssignment>("create_team_assignment", { input });

export const listTeamAssignments = (teamId: string) =>
  invoke<TeamAssignment[]>("list_team_assignments", { teamId });

export const getTeamAssignmentDetail = (id: string) =>
  invoke<TeamAssignmentDetail>("get_team_assignment_detail", { id });

export const listTeamAssignmentEvents = (
  assignmentId: string,
  limit?: number,
) =>
  invoke<TeamAssignmentEvent[]>("list_team_assignment_events", {
    assignmentId,
    limit: limit ?? null,
  });

export const listTeamAssignmentSteps = (assignmentId: string) =>
  invoke<TeamAssignmentStep[]>("list_team_assignment_steps", { assignmentId });

export const startTeamAssignment = (id: string) =>
  invoke<void>("start_team_assignment", { id });

export const abortTeamAssignment = (id: string, reason?: string) =>
  invoke<void>("abort_team_assignment", { id, reason: reason ?? null });

export const resolveTeamAssignmentReview = (
  stepId: string,
  action: ResolveStepReviewAction,
) =>
  invoke<void>("resolve_team_assignment_review", { stepId, action });

export const deleteTeamAssignment = (id: string) =>
  invoke<boolean>("delete_team_assignment", { id });

/** Phase B3: ask Sonnet (via subscription) to break a natural-language
 *  goal into ordered steps. Returns proposed `DecomposedStep[]`; the
 *  composer wraps them into editable rows before the user submits. */
export const decomposeTeamAssignmentGoal = (teamId: string, goal: string) =>
  invoke<DecomposedStep[]>("decompose_team_assignment_goal", { teamId, goal });
