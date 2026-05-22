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
    runId,
    category,
    search,
    limit,
    offset,
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
    title,
    content,
    category,
    importance,
  });

export const updateTeamMemoryImportance = (id: string, importance: number) =>
  invoke<boolean>("update_team_memory_importance", { id, importance });

export const batchDeleteTeamMemories = (ids: string[]) =>
  invoke<number>("batch_delete_team_memories", { ids });

export const getTeamMemoryCount = (teamId: string, runId?: string, category?: string, search?: string) =>
  invoke<number>("get_team_memory_count", {
    teamId,
    runId,
    category,
    search,
  });

export const getTeamMemoryStats = (teamId: string, category?: string, search?: string) =>
  invoke<TeamMemoryStats>("get_team_memory_stats", {
    teamId,
    category,
    search,
  });

export const listTeamMemoriesByRun = (runId: string) =>
  invoke<TeamMemory[]>("list_team_memories_by_run", { runId });

export const evictTeamMemories = (teamId: string, maxMemories?: number) =>
  invoke<number>("evict_team_memories", { teamId, maxMemories });
