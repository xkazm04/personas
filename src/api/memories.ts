import { invoke } from "@tauri-apps/api/core";

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
    personaId: personaId ?? null,
    category: category ?? null,
    search: search ?? null,
    limit: limit ?? null,
    offset: offset ?? null,
  });

export const createMemory = (input: CreatePersonaMemoryInput) =>
  invoke<PersonaMemory>("create_memory", { input });

export const getMemoryCount = (personaId?: string, category?: string, search?: string) =>
  invoke<number>("get_memory_count", {
    personaId: personaId ?? null,
    category: category ?? null,
    search: search ?? null,
  });

export interface MemoryStats {
  total: number;
  avg_importance: number;
  category_counts: Array<[string, number]>;
  agent_counts: Array<[string, number]>;
}

export const getMemoryStats = (personaId?: string, category?: string, search?: string) =>
  invoke<MemoryStats>("get_memory_stats", {
    personaId: personaId ?? null,
    category: category ?? null,
    search: search ?? null,
  });

export const listMemoriesByExecution = (executionId: string) =>
  invoke<PersonaMemory[]>("list_memories_by_execution", { executionId });

export const deleteMemory = (id: string) =>
  invoke<boolean>("delete_memory", { id });
