import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { TeamMemory } from "@/lib/bindings/TeamMemory";
import type { CreateTeamMemoryInput } from "@/lib/bindings/CreateTeamMemoryInput";
import type { TeamMemoryStats } from "@/lib/bindings/TeamMemoryStats";

// ============================================================================
// Team Memories
// ============================================================================

export const listTeamMemories = (
  teamId: string,
  runId?: string,
  category?: string,
  search?: string,
  limit?: number,
  offset?: number,
) =>
  invoke<TeamMemory[]>("list_team_memories", {
    teamId,
    runId: runId ?? null,
    category: category ?? null,
    search: search ?? null,
    limit: limit ?? null,
    offset: offset ?? null,
  });

export const createTeamMemory = (input: CreateTeamMemoryInput) =>
  invoke<TeamMemory>("create_team_memory", { input });

export const deleteTeamMemory = (id: string) =>
  invoke<boolean>("delete_team_memory", { id });

export const updateTeamMemory = (
  id: string,
  title?: string,
  content?: string,
  category?: string,
  importance?: number,
) =>
  invoke<TeamMemory>("update_team_memory", {
    id,
    title: title ?? null,
    content: content ?? null,
    category: category ?? null,
    importance: importance ?? null,
  });

export const updateTeamMemoryImportance = (id: string, importance: number) =>
  invoke<boolean>("update_team_memory_importance", { id, importance });

export const batchDeleteTeamMemories = (ids: string[]) =>
  invoke<number>("batch_delete_team_memories", { ids });

export const getTeamMemoryCount = (teamId: string, runId?: string, category?: string) =>
  invoke<number>("get_team_memory_count", {
    teamId,
    runId: runId ?? null,
    category: category ?? null,
  });

export const getTeamMemoryStats = (teamId: string, category?: string, search?: string) =>
  invoke<TeamMemoryStats>("get_team_memory_stats", {
    teamId,
    category: category ?? null,
    search: search ?? null,
  });

export const listTeamMemoriesByRun = (runId: string) =>
  invoke<TeamMemory[]>("list_team_memories_by_run", { runId });
