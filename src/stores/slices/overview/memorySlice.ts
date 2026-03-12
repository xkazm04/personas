import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";
import { errMsg } from "../../storeTypes";
import type { DbPersonaMemory } from "@/lib/types/types";
import type { MemoryStats, MemoryReviewResult } from "@/api/overview/memories";
import type { MemoryAction } from "@/features/overview/sub_memories/libs/memoryActions";
import { extractActionsFromReview, loadActions, saveActions } from "@/features/overview/sub_memories/libs/memoryActions";
import * as api from "@/api/tauriApi";

export interface MemorySlice {
  // State
  memories: DbPersonaMemory[];
  memoriesTotal: number;
  memoryStats: MemoryStats | null;
  memoryActions: MemoryAction[];

  // Actions
  fetchMemories: (filters?: { persona_id?: string; category?: string; search?: string }) => Promise<void>;
  createMemory: (input: { persona_id: string; title: string; content: string; category: string; importance: number; tags: string[] }) => Promise<boolean>;
  deleteMemory: (id: string) => Promise<void>;
  reviewMemories: (personaId?: string) => Promise<MemoryReviewResult>;
  dismissMemoryAction: (actionId: string) => void;
  loadMemoryActions: () => void;
}

export const createMemorySlice: StateCreator<PersonaStore, [], [], MemorySlice> = (set, get) => ({
  memories: [],
  memoriesTotal: 0,
  memoryStats: null,
  memoryActions: loadActions(),

  fetchMemories: async (filters?) => {
    try {
      const hasSearch = !!filters?.search?.trim();
      const limit = hasSearch ? 500 : 100;
      const result = await api.listMemoriesWithStats(
        filters?.persona_id,
        filters?.category,
        filters?.search,
        limit,
        0,
      );
      set({ memories: result.memories, memoriesTotal: result.total, memoryStats: result.stats });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch memories") });
    }
  },

  createMemory: async (input) => {
    try {
      const created = await api.createMemory({
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
      set({ error: errMsg(err, "Failed to create memory") });
      return false;
    }
  },

  deleteMemory: async (id) => {
    try {
      await api.deleteMemory(id);
      set((state) => ({
        memories: state.memories.filter((m) => m.id !== id),
        memoriesTotal: Math.max(0, state.memoriesTotal - 1),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete memory") });
    }
  },

  reviewMemories: async (personaId?) => {
    try {
      const memoriesBefore = get().memories;
      const result = await api.reviewMemoriesWithCli(personaId);
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
      set({ error: errMsg(err, "Failed to review memories") });
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
