import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaMemory } from "@/lib/bindings/PersonaMemory";
import type { CreatePersonaMemoryInput } from "@/lib/bindings/CreatePersonaMemoryInput";

// ============================================================================
// Memories
// ============================================================================

export const listMemories = (
  personaId?: string,
  category?: string,
  search?: string,
  limit?: number,
  offset?: number,
) =>
  invoke<PersonaMemory[]>("list_memories", {
    personaId: personaId,
    category: category,
    search: search,
    limit: limit,
    offset: offset,
  });

export const createMemory = (input: CreatePersonaMemoryInput) =>
  invoke<PersonaMemory>("create_memory", { input });

export const getMemoryCount = (personaId?: string, category?: string, search?: string) =>
  invoke<number>("get_memory_count", {
    personaId: personaId,
    category: category,
    search: search,
  });

export interface MemoryStats {
  total: number;
  avg_importance: number;
  category_counts: Array<[string, number]>;
  agent_counts: Array<[string, number]>;
}

export const getMemoryStats = (personaId?: string, category?: string, search?: string) =>
  invoke<MemoryStats>("get_memory_stats", {
    personaId: personaId,
    category: category,
    search: search,
  });

export interface MemoriesWithStats {
  memories: PersonaMemory[];
  total: number;
  stats: MemoryStats;
}

export const listMemoriesWithStats = (
  personaId?: string,
  category?: string,
  search?: string,
  limit?: number,
  offset?: number,
  sortColumn?: string,
  sortDirection?: string,
) =>
  invoke<MemoriesWithStats>("list_memories_with_stats", {
    personaId: personaId,
    category: category,
    search: search,
    limit: limit,
    offset: offset,
    sortColumn: sortColumn,
    sortDirection: sortDirection,
  });

export const listMemoriesByExecution = (executionId: string) =>
  invoke<PersonaMemory[]>("list_memories_by_execution", { executionId });

export const deleteMemory = (id: string) =>
  invoke<boolean>("delete_memory", { id });

export const updateMemoryImportance = (id: string, importance: number) =>
  invoke<boolean>("update_memory_importance", { id, importance });

export const batchDeleteMemories = (ids: string[]) =>
  invoke<number>("batch_delete_memories", { ids });

export interface MemoryReviewDetail {
  id: string;
  title: string;
  score: number;
  reason: string;
  action: 'kept' | 'deleted';
}

export interface MemoryReviewResult {
  reviewed: number;
  deleted: number;
  updated: number;
  details: MemoryReviewDetail[];
}

export const reviewMemoriesWithCli = (personaId?: string, threshold?: number) =>
  invoke<MemoryReviewResult>("review_memories_with_cli", {
    personaId: personaId,
    threshold: threshold,
  });

export const seedMockMemory = () =>
  invoke<PersonaMemory>("seed_mock_memory", {});

// -- Tier management --------------------------------------------------------

export type MemoryTier = 'core' | 'active' | 'archive';

export const updateMemoryTier = (id: string, tier: MemoryTier) =>
  invoke<boolean>("update_memory_tier", { id, tier });

export interface MemoryLifecycleResult {
  promoted: number;
  archived: number;
}

export const runMemoryLifecycle = (personaId: string) =>
  invoke<MemoryLifecycleResult>("run_memory_lifecycle", { personaId });
