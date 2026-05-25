import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";

import {
  abortTeamAssignment,
  createAssignmentTemplate,
  createTeamAssignment,
  deleteAssignmentTemplate,
  deleteTeamAssignment,
  getTeamAssignmentDetail,
  instantiateAssignmentTemplate,
  listAssignmentTemplates,
  listTeamAssignments,
  resolveTeamAssignmentReview,
  startTeamAssignment,
} from "@/api/pipeline/assignments";
import type { CreateTeamAssignmentInput } from "@/lib/bindings/CreateTeamAssignmentInput";
import type { CreateTeamAssignmentTemplateInput } from "@/lib/bindings/CreateTeamAssignmentTemplateInput";
import type { ResolveStepReviewAction } from "@/lib/bindings/ResolveStepReviewAction";
import type { TeamAssignment } from "@/lib/bindings/TeamAssignment";
import type { TeamAssignmentDetail } from "@/lib/bindings/TeamAssignmentDetail";
import type { TeamAssignmentTemplate } from "@/lib/bindings/TeamAssignmentTemplate";

// ----------------------------------------------------------------------------
// Live-update payload (mirrors the Rust orchestrator's emit_progress json)
// ----------------------------------------------------------------------------

/** Wire-format of TEAM_ASSIGNMENT_PROGRESS events emitted by the orchestrator.
 *  The frontend hook that owns the listener calls `applyAssignmentProgress`
 *  with this payload to merge into the slice's caches. */
export interface TeamAssignmentProgressPayload {
  assignment_id: string;
  status: string;
  step_id: string | null;
}

// ----------------------------------------------------------------------------
// Slice
// ----------------------------------------------------------------------------

export interface AssignmentSlice {
  // State
  /** Per-team list cache. Keyed by team_id. */
  assignmentsByTeam: Record<string, TeamAssignment[]>;
  /** Detail cache (assignment + steps + recent events). Keyed by assignment id. */
  assignmentDetails: Record<string, TeamAssignmentDetail>;
  /** Per-team saved-template cache (Phase C4). Keyed by team_id. */
  assignmentTemplatesByTeam: Record<string, TeamAssignmentTemplate[]>;

  // Actions
  fetchTeamAssignments: (teamId: string) => Promise<void>;
  fetchAssignmentTemplates: (teamId: string) => Promise<void>;
  saveAssignmentTemplate: (
    input: CreateTeamAssignmentTemplateInput,
  ) => Promise<TeamAssignmentTemplate | null>;
  deleteAssignmentTemplate: (teamId: string, id: string) => Promise<void>;
  /** Clone a template into a fresh assignment, refresh the team list,
   *  and return the new assignment so the caller can expand it. */
  instantiateTemplate: (
    teamId: string,
    templateId: string,
  ) => Promise<TeamAssignment | null>;
  fetchAssignmentDetail: (id: string) => Promise<TeamAssignmentDetail | null>;
  createTeamAssignment: (
    input: CreateTeamAssignmentInput,
  ) => Promise<TeamAssignment | null>;
  startAssignment: (id: string) => Promise<void>;
  abortAssignment: (id: string, reason?: string) => Promise<void>;
  resolveAssignmentReview: (
    stepId: string,
    action: ResolveStepReviewAction,
  ) => Promise<void>;
  deleteAssignment: (id: string) => Promise<void>;
  /** Called by the TEAM_ASSIGNMENT_PROGRESS Tauri-listener hook. Marks the
   *  cached detail stale + re-fetches it; the caches stay consistent without
   *  the slice owning the listener itself. */
  applyAssignmentProgress: (payload: TeamAssignmentProgressPayload) => void;
}

export const createAssignmentSlice: StateCreator<
  PipelineStore,
  [],
  [],
  AssignmentSlice
> = (set, get) => ({
  assignmentsByTeam: {},
  assignmentDetails: {},
  assignmentTemplatesByTeam: {},

  fetchTeamAssignments: async (teamId) => {
    try {
      const list = await listTeamAssignments(teamId);
      set((state) => ({
        assignmentsByTeam: { ...state.assignmentsByTeam, [teamId]: list },
      }));
    } catch (err) {
      reportError(err, "Failed to fetch team assignments", set);
    }
  },

  fetchAssignmentTemplates: async (teamId) => {
    try {
      const list = await listAssignmentTemplates(teamId);
      set((state) => ({
        assignmentTemplatesByTeam: {
          ...state.assignmentTemplatesByTeam,
          [teamId]: list,
        },
      }));
    } catch (err) {
      reportError(err, "Failed to fetch assignment templates", set);
    }
  },

  saveAssignmentTemplate: async (input) => {
    try {
      const tpl = await createAssignmentTemplate(input);
      set((state) => {
        const existing = state.assignmentTemplatesByTeam[input.teamId] ?? [];
        return {
          assignmentTemplatesByTeam: {
            ...state.assignmentTemplatesByTeam,
            [input.teamId]: [tpl, ...existing],
          },
        };
      });
      return tpl;
    } catch (err) {
      reportError(err, "Failed to save assignment template", set);
      return null;
    }
  },

  deleteAssignmentTemplate: async (teamId, id) => {
    try {
      await deleteAssignmentTemplate(id);
      set((state) => ({
        assignmentTemplatesByTeam: {
          ...state.assignmentTemplatesByTeam,
          [teamId]: (state.assignmentTemplatesByTeam[teamId] ?? []).filter(
            (t) => t.id !== id,
          ),
        },
      }));
    } catch (err) {
      reportError(err, "Failed to delete assignment template", set);
    }
  },

  instantiateTemplate: async (teamId, templateId) => {
    try {
      const assignment = await instantiateAssignmentTemplate(templateId);
      set((state) => {
        const existing = state.assignmentsByTeam[teamId] ?? [];
        return {
          assignmentsByTeam: {
            ...state.assignmentsByTeam,
            [teamId]: [assignment, ...existing],
          },
        };
      });
      return assignment;
    } catch (err) {
      reportError(err, "Failed to instantiate template", set);
      return null;
    }
  },

  fetchAssignmentDetail: async (id) => {
    try {
      const detail = await getTeamAssignmentDetail(id);
      set((state) => ({
        assignmentDetails: { ...state.assignmentDetails, [id]: detail },
      }));
      return detail;
    } catch (err) {
      reportError(err, "Failed to fetch assignment detail", set);
      return null;
    }
  },

  createTeamAssignment: async (input) => {
    try {
      const assignment = await createTeamAssignment(input);
      set((state) => {
        const existing = state.assignmentsByTeam[input.teamId] ?? [];
        return {
          assignmentsByTeam: {
            ...state.assignmentsByTeam,
            [input.teamId]: [assignment, ...existing],
          },
        };
      });
      return assignment;
    } catch (err) {
      reportError(err, "Failed to create team assignment", set);
      return null;
    }
  },

  startAssignment: async (id) => {
    try {
      await startTeamAssignment(id);
      // Re-fetch detail so the UI reflects the queued→running transition.
      await get().fetchAssignmentDetail(id);
    } catch (err) {
      reportError(err, "Failed to start team assignment", set);
    }
  },

  abortAssignment: async (id, reason) => {
    try {
      await abortTeamAssignment(id, reason);
      await get().fetchAssignmentDetail(id);
    } catch (err) {
      reportError(err, "Failed to abort team assignment", set);
    }
  },

  resolveAssignmentReview: async (stepId, action) => {
    try {
      await resolveTeamAssignmentReview(stepId, action);
      // Find the assignment_id from any cached detail that contains this step
      // and re-fetch. Cheap; the slice has at most a handful of details cached.
      const detail = Object.values(get().assignmentDetails).find((d) =>
        d.steps.some((s) => s.id === stepId),
      );
      if (detail) {
        await get().fetchAssignmentDetail(detail.assignment.id);
      }
    } catch (err) {
      reportError(err, "Failed to resolve assignment review", set);
    }
  },

  deleteAssignment: async (id) => {
    try {
      await deleteTeamAssignment(id);
      set((state) => {
        // Drop from per-team list (we don't know the team id without a lookup;
        // walk the map and filter).
        const nextByTeam: Record<string, TeamAssignment[]> = {};
        for (const [teamId, list] of Object.entries(state.assignmentsByTeam)) {
          nextByTeam[teamId] = list.filter((a) => a.id !== id);
        }
        // Drop from detail cache.
        const nextDetails = { ...state.assignmentDetails };
        delete nextDetails[id];
        return {
          assignmentsByTeam: nextByTeam,
          assignmentDetails: nextDetails,
        };
      });
    } catch (err) {
      reportError(err, "Failed to delete team assignment", set);
    }
  },

  applyAssignmentProgress: (payload) => {
    // The progress event carries assignment_id + status; the full step state
    // lives in the DB and is the source of truth.
    const id = payload.assignment_id;
    // Assignment-level transitions (step_id === null) flip the lifecycle
    // status — patch it directly into the per-team lists so the board/list
    // auto-flow between columns without a round-trip. Idempotent: only writes
    // when the status actually changed.
    if (payload.step_id === null) {
      set((state) => {
        let changed = false;
        const next: Record<string, TeamAssignment[]> = {};
        for (const [teamId, list] of Object.entries(state.assignmentsByTeam)) {
          next[teamId] = list.map((a) => {
            if (a.id === id && a.status !== payload.status) {
              changed = true;
              return { ...a, status: payload.status };
            }
            return a;
          });
        }
        return changed ? { assignmentsByTeam: next } : {};
      });
    }
    // Re-fetch the detail (steps + events) when it's being viewed/tracked, so
    // the live checklist stays accurate without a local step state machine.
    if (get().assignmentDetails[id]) {
      void get().fetchAssignmentDetail(id);
    }
  },
});
