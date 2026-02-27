import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { DbPersonaGroup } from "@/lib/types/types";
import type { UpdatePersonaGroupInput } from "@/lib/bindings/UpdatePersonaGroupInput";
import * as api from "@/api/tauriApi";

export interface GroupSlice {
  // State
  groups: DbPersonaGroup[];

  // Actions
  fetchGroups: () => Promise<void>;
  createGroup: (input: { name: string; color?: string; description?: string }) => Promise<DbPersonaGroup | null>;
  updateGroup: (id: string, updates: Partial<{
    name: string;
    color: string;
    collapsed: boolean;
    description: string;
    defaultModelProfile: string;
    defaultMaxBudgetUsd: number;
    defaultMaxTurns: number;
    sharedInstructions: string;
  }>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  reorderGroups: (orderedIds: string[]) => Promise<void>;
  movePersonaToGroup: (personaId: string, groupId: string | null) => Promise<void>;
}

export const createGroupSlice: StateCreator<PersonaStore, [], [], GroupSlice> = (set, get) => ({
  groups: [],

  fetchGroups: async () => {
    try {
      const groups = await api.listGroups();
      set({ groups });
    } catch {
      // Silent fail
    }
  },

  createGroup: async (input) => {
    try {
      const group = await api.createGroup({
        name: input.name,
        color: input.color ?? "#6B7280",
        sortOrder: null,
        description: input.description ?? null,
      });
      set((state) => ({ groups: [...state.groups, group] }));
      return group;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create group") });
      return null;
    }
  },

  updateGroup: async (id, updates) => {
    try {
      const input: UpdatePersonaGroupInput = {
        name: updates.name ?? null,
        color: updates.color ?? null,
        sortOrder: null,
        collapsed: updates.collapsed !== undefined ? updates.collapsed : null,
        description: updates.description !== undefined ? updates.description : null,
        defaultModelProfile: updates.defaultModelProfile !== undefined ? updates.defaultModelProfile : null,
        defaultMaxBudgetUsd: updates.defaultMaxBudgetUsd !== undefined ? updates.defaultMaxBudgetUsd : null,
        defaultMaxTurns: updates.defaultMaxTurns !== undefined ? updates.defaultMaxTurns : null,
        sharedInstructions: updates.sharedInstructions !== undefined ? updates.sharedInstructions : null,
      };
      const group = await api.updateGroup(id, input);
      set((state) => ({
        groups: state.groups.map((g) => (g.id === id ? group : g)),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to update group") });
    }
  },

  deleteGroup: async (id) => {
    try {
      await api.deleteGroup(id);
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id),
        personas: state.personas.map((p) =>
          p.group_id === id ? { ...p, group_id: null } : p,
        ),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete group") });
    }
  },

  reorderGroups: async (orderedIds) => {
    try {
      await api.reorderGroups(orderedIds);
      set((state) => ({
        groups: state.groups
          .map((g) => ({ ...g, sortOrder: orderedIds.indexOf(g.id) }))
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to reorder groups") });
    }
  },

  movePersonaToGroup: async (personaId, groupId) => {
    try {
      await get().applyPersonaOp(personaId, { kind: 'MoveToGroup', group_id: groupId });
    } catch (err) {
      set({ error: errMsg(err, "Failed to move persona") });
    }
  },
});
