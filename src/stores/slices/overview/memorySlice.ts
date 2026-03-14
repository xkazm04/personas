import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { PersonaMemory } from "@/lib/types/types";
import type { MemoryStats, MemoryReviewResult } from "@/api/overview/memories";
import type { MemoryAction } from "@/features/overview/sub_memories/libs/memoryActions";
import { extractActionsFromReview, loadActions, saveActions } from "@/features/overview/sub_memories/libs/memoryActions";
import { createMemory, deleteMemory, listMemoriesWithStats, reviewMemoriesWithCli } from "@/api/overview/memories";


export interface MemorySlice {
  // State
  memories: PersonaMemory[];
  memoriesTotal: number;
  memoryStats: MemoryStats | null;
  memoryActions: MemoryAction[];

  // Actions
  fetchMemories: (filters?: { persona_id?: string; category?: string; search?: string; sort_column?: string; sort_direction?: string }) => Promise<void>;
  createMemory: (input: { persona_id: string; title: string; content: string; category: string; importance: number; tags: string[] }) => Promise<boolean>;
  deleteMemory: (id: string) => Promise<void>;
  reviewMemories: (personaId?: string) => Promise<MemoryReviewResult>;
  dismissMemoryAction: (actionId: string) => void;
  loadMemoryActions: () => void;
}

export const createMemorySlice: StateCreator<OverviewStore, [], [], MemorySlice> = (set, get) => ({
  memories: [],
  memoriesTotal: 0,
  memoryStats: null,
  memoryActions: loadActions(),

  fetchMemories: async (filters?) => {
    try {
      const hasSearch = !!filters?.search?.trim();
      const limit = hasSearch ? 500 : 100;
      const result = await listMemoriesWithStats(
        filters?.persona_id,
        filters?.category,
        filters?.search,
        limit,
        0,
        filters?.sort_column,
        filters?.sort_direction,
      );
      set({ memories: result.memories, memoriesTotal: result.total, memoryStats: result.stats });
    } catch (err) {
      reportError(err, "Failed to fetch memories", set);
    }
  },

  createMemory: async (input) => {
    try {
      const created = await createMemory({
        persona_id: input.persona_id,
        title: input.title,
        content: input.content,
        category: input.category,
        importance: input.importance,
        tags: JSON.stringify(input.tags),
        source_execution_id: null,
      });
      set((state) => ({
        memories: [created, ...state.memories],
        memoriesTotal: state.memoriesTotal + 1,
      }));
      return true;
    } catch (err) {
      reportError(err, "Failed to create memory", set);
      return false;
    }
  },

  deleteMemory: async (id) => {
    try {
      await deleteMemory(id);
      set((state) => ({
        memories: state.memories.filter((m) => m.id !== id),
        memoriesTotal: Math.max(0, state.memoriesTotal - 1),
      }));
    } catch (err) {
      reportError(err, "Failed to delete memory", set);
    }
  },

  reviewMemories: async (personaId?) => {
    try {
      const memoriesBefore = get().memories;
      const result = await reviewMemoriesWithCli(personaId);
      // Refresh memories list after review
      await get().fetchMemories();

      // Extract actionable rules from high-scoring memories (8+)
      if (result.details.length > 0) {
        const newActions = extractActionsFromReview(result.details, memoriesBefore);
        if (newActions.length > 0) {
          const all = [...get().memoryActions, ...newActions];
          saveActions(all);
          set({ memoryActions: all });
        }
      }

      return result;
    } catch (err) {
      reportError(err, "Failed to review memories", set);
      throw err;
    }
  },

  dismissMemoryAction: (actionId) => {
    const updated = get().memoryActions.map((a) =>
      a.id === actionId ? { ...a, dismissed: true } : a,
    );
    saveActions(updated);
    set({ memoryActions: updated });
  },

  loadMemoryActions: () => {
    set({ memoryActions: loadActions() });
  },
});
