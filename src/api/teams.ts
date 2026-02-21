import { invoke } from "@tauri-apps/api/core";

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
    role: role ?? null,
    positionX: positionX ?? null,
    positionY: positionY ?? null,
    config: config ?? null,
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
    role: role ?? null,
    positionX: positionX ?? null,
    positionY: positionY ?? null,
    config: config ?? null,
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
    connectionType: connectionType ?? null,
    condition: condition ?? null,
    label: label ?? null,
  });

export const updateTeamConnection = (id: string, connectionType: string) =>
  invoke<void>("update_team_connection", { id, connectionType });

export const deleteTeamConnection = (id: string) =>
  invoke<boolean>("delete_team_connection", { id });

// ── Pipeline ─────────────────────────────────────────────────────────────

export interface PipelineRun {
  id: string;
  team_id: string;
  status: string;
  node_statuses: string;
  input_data: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export const executeTeam = (teamId: string, inputData?: string) =>
  invoke<string>("execute_team", { teamId, inputData: inputData ?? null });

export const listPipelineRuns = (teamId: string) =>
  invoke<PipelineRun[]>("list_pipeline_runs", { teamId });

export const getPipelineRun = (id: string) =>
  invoke<PipelineRun>("get_pipeline_run", { id });

// ── Pipeline Analytics & Optimizer ──────────────────────────────────────

export const getPipelineAnalytics = (teamId: string) =>
  invoke<PipelineAnalytics>("get_pipeline_analytics", { teamId });

// ── Canvas Assistant — Topology Suggestions ─────────────────────────────

export const suggestTopology = (query: string, teamId?: string) =>
  invoke<TopologyBlueprint>("suggest_topology", { query, teamId: teamId ?? null });
