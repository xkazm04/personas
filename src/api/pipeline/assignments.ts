import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { CompanionAssignTeamResult } from "@/lib/bindings/CompanionAssignTeamResult";
import type { CreateTeamAssignmentInput } from "@/lib/bindings/CreateTeamAssignmentInput";
import type { CreateTeamAssignmentTemplateInput } from "@/lib/bindings/CreateTeamAssignmentTemplateInput";
import type { DecomposedStep } from "@/lib/bindings/DecomposedStep";
import type { ResolveStepReviewAction } from "@/lib/bindings/ResolveStepReviewAction";
import type { TeamAssignment } from "@/lib/bindings/TeamAssignment";
import type { TeamAssignmentDetail } from "@/lib/bindings/TeamAssignmentDetail";
import type { TeamAssignmentEvent } from "@/lib/bindings/TeamAssignmentEvent";
import type { TeamAssignmentStep } from "@/lib/bindings/TeamAssignmentStep";
import type { TeamAssignmentTemplate } from "@/lib/bindings/TeamAssignmentTemplate";

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

/** Goals hub: link (or unlink with `null`) an assignment to a dev goal. */
export const setTeamAssignmentGoal = (assignmentId: string, goalId: string | null) =>
  invoke<void>("set_team_assignment_goal", { assignmentId, goalId });

/** Goals hub: every assignment linked to a given dev goal. */
export const listTeamAssignmentsForGoal = (goalId: string) =>
  invoke<TeamAssignment[]>("list_team_assignments_for_goal", { goalId });

/** Phase B3: ask Sonnet (via subscription) to break a natural-language
 *  goal into ordered steps. Returns proposed `DecomposedStep[]`; the
 *  composer wraps them into editable rows before the user submits. */
export const decomposeTeamAssignmentGoal = (teamId: string, goal: string) =>
  invoke<DecomposedStep[]>("decompose_team_assignment_goal", { teamId, goal });

/** Phase C1: Athena's "have the X team handle Y" entry point. End-to-end:
 *  decomposes the goal, creates an llm_eval assignment with source='athena',
 *  opens a dispatched companion Operation, and starts the orchestrator.
 *  Returns both ids so the chat layer can attach the assignment cards to
 *  the right operation in episodic memory. */
export const companionAssignTeam = (
  teamId: string,
  goal: string,
  title?: string,
) =>
  invoke<CompanionAssignTeamResult>("companion_assign_team", {
    teamId,
    goal,
    title: title ?? null,
  });

// ============================================================================
// Templates (Phase C4)
// ============================================================================

export const createAssignmentTemplate = (
  input: CreateTeamAssignmentTemplateInput,
) => invoke<TeamAssignmentTemplate>("create_assignment_template", { input });

export const listAssignmentTemplates = (teamId: string) =>
  invoke<TeamAssignmentTemplate[]>("list_assignment_templates", { teamId });

export const deleteAssignmentTemplate = (id: string) =>
  invoke<boolean>("delete_assignment_template", { id });

/** Clone a saved template into a fresh assignment (not auto-started).
 *  Returns the new assignment so the panel can expand it. */
export const instantiateAssignmentTemplate = (templateId: string) =>
  invoke<TeamAssignment>("instantiate_assignment_template", { templateId });
