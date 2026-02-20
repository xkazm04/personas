import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { DbPersonaMemory } from "@/lib/types/types";
import * as api from "@/api/tauriApi";

export interface MemorySlice {
  // State
  memories: DbPersonaMemory[];
  memoriesTotal: number;

  // Actions
  fetchMemories: (filters?: { persona_id?: string; category?: string }) => Promise<void>;
  createMemory: (input: { persona_id: string; title: string; content: string; category: string; importance: number; tags: string[] }) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
}

export const createMemorySlice: StateCreator<PersonaStore, [], [], MemorySlice> = (set) => ({
  memories: [],
  memoriesTotal: 0,

  fetchMemories: async (filters?) => {
    try {
      const memories = await api.listMemories(
        filters?.persona_id,
        filters?.category,
        100,
        0,
      );
      set({ memories, memoriesTotal: memories.length });
    } catch {
      // Silent fail
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
    } catch (err) {
      set({ error: errMsg(err, "Failed to create memory") });
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
});
