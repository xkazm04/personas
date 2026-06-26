import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaTeam } from "@/lib/bindings/PersonaTeam";
import type { CreateTeamInput } from "@/lib/bindings/CreateTeamInput";
import type { UpdateTeamInput } from "@/lib/bindings/UpdateTeamInput";
import type { PersonaTeamMember } from "@/lib/bindings/PersonaTeamMember";
import type { PersonaTeamConnection } from "@/lib/bindings/PersonaTeamConnection";
import type { PipelineAnalytics } from "@/lib/bindings/PipelineAnalytics";
import type { TopologyBlueprint } from "@/lib/bindings/TopologyBlueprint";
import type { TeamCounts } from "@/lib/bindings/TeamCounts";

// ============================================================================
// Teams
// ============================================================================

export const listTeams = () =>
  invoke<PersonaTeam[]>("list_teams");

export const getTeamCounts = () =>
  invoke<TeamCounts[]>("get_team_counts");

export const getTeam = (id: string) =>
  invoke<PersonaTeam>("get_team", { id });

export const createTeam = (input: CreateTeamInput) =>
  invoke<PersonaTeam>("create_team", { input });

export const updateTeam = (id: string, input: UpdateTeamInput) =>
  invoke<PersonaTeam>("update_team", { id, input });

export const deleteTeam = (id: string) =>
  invoke<boolean>("delete_team", { id });

export const cloneTeam = (sourceTeamId: string) =>
  invoke<PersonaTeam>("clone_team", { sourceTeamId });

/**
 * Summary of a handoff-wiring pass — mirrors the Rust `HandoffWireResult`
 * (not ts-rs-exported, so typed inline here). Returned by
 * `repair_team_handoff`.
 */
export interface HandoffWireResult {
  team_id: string;
  edges_total: number;
  edges_wired: number;
  chain_triggers_created: number;
  listeners_created: number;
  skipped_existing: number;
}

/**
 * Wire (or repair) a team's intra-team handoff from its connection graph —
 * creates the `chain`/`event_listener` triggers that make S→T edges fire so
 * downstream members cascade. Idempotent (only missing triggers are created).
 * Surfaced by the preset-adoption flow when `handoff_wired === false`.
 */
export const repairTeamHandoff = (teamId: string) =>
  invoke<HandoffWireResult>("repair_team_handoff", { teamId });

export const listTeamMembers = (teamId: string) =>
  invoke<PersonaTeamMember[]>("list_team_members", { teamId });

export const addTeamMember = (
  teamId: string,
  personaId: string,
  role?: string,
  positionX?: number,
  positionY?: number,
  config?: string,
) =>
  invoke<PersonaTeamMember>("add_team_member", {
    teamId,
    personaId,
    role,
    positionX,
    positionY,
    config,
  });

export const updateTeamMember = (
  id: string,
  role?: string,
  positionX?: number,
  positionY?: number,
  config?: string,
) =>
  invoke<void>("update_team_member", {
    id,
    role,
    positionX,
    positionY,
    config,
  });

export const removeTeamMember = (id: string) =>
  invoke<boolean>("remove_team_member", { id });

export const listTeamConnections = (teamId: string) =>
  invoke<PersonaTeamConnection[]>("list_team_connections", { teamId });

export const createTeamConnection = (
  teamId: string,
  sourceMemberId: string,
  targetMemberId: string,
  connectionType?: string,
  condition?: string,
  label?: string,
) =>
  invoke<PersonaTeamConnection>("create_team_connection", {
    teamId,
    sourceMemberId,
    targetMemberId,
    connectionType,
    condition,
    label,
  });

export const updateTeamConnection = (id: string, connectionType: string) =>
  invoke<void>("update_team_connection", { id, connectionType });

export const deleteTeamConnection = (id: string) =>
  invoke<boolean>("delete_team_connection", { id });

// -- Pipeline -------------------------------------------------------------

import type { PipelineRun } from "@/lib/bindings/PipelineRun";
export type { PipelineRun } from "@/lib/bindings/PipelineRun";

export const executeTeam = (teamId: string, inputData?: string) =>
  invoke<string>("execute_team", { teamId, inputData });

export const listPipelineRuns = (teamId: string) =>
  invoke<PipelineRun[]>("list_pipeline_runs", { teamId });

export const getPipelineRun = (id: string) =>
  invoke<PipelineRun>("get_pipeline_run", { id });

export const cancelPipeline = (runId: string) =>
  invoke<boolean>("cancel_pipeline", { runId });

export const approvePipelineNode = (runId: string, memberId: string) =>
  invoke<boolean>("approve_pipeline_node", { runId, memberId });

export const rejectPipelineNode = (runId: string) =>
  invoke<boolean>("reject_pipeline_node", { runId });

// -- Pipeline Analytics & Optimizer --------------------------------------

export const getPipelineAnalytics = (teamId: string) =>
  invoke<PipelineAnalytics>("get_pipeline_analytics", { teamId });

// -- Canvas Assistant -- Topology Suggestions -----------------------------

export const suggestTopology = (query: string, teamId?: string) =>
  invoke<TopologyBlueprint>("suggest_topology", { query, teamId });

export const suggestTopologyLlm = (query: string, teamId?: string) =>
  invoke<TopologyBlueprint>("suggest_topology_llm", { query, teamId });
