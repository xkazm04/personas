import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";
import { errMsg } from "../../storeTypes";
import { useAgentStore } from "../../agentStore";
import type { PersonaGroup } from "@/lib/types/types";
import type { UpdatePersonaGroupInput } from "@/lib/bindings/UpdatePersonaGroupInput";
import { createGroup, deleteGroup, listGroups, reorderGroups, updateGroup } from "@/api/pipeline/groups";


export interface GroupSlice {
  // State
  groups: PersonaGroup[];

  // Actions
  fetchGroups: () => Promise<void>;
  createGroup: (input: { name: string; color?: string; description?: string }) => Promise<PersonaGroup | null>;
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

export const createGroupSlice: StateCreator<PipelineStore, [], [], GroupSlice> = (set) => ({
  groups: [],

  fetchGroups: async () => {
    try {
      const groups = await listGroups();
      set({ groups });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch groups") });
    }
  },

  createGroup: async (input) => {
    try {
      const group = await createGroup({
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
      const group = await updateGroup(id, input);
      set((state) => ({
        groups: state.groups.map((g) => (g.id === id ? group : g)),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to update group") });
    }
  },

  deleteGroup: async (id) => {
    try {
      await deleteGroup(id);
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id),
      }));
      useAgentStore.setState((state) => ({
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
      await reorderGroups(orderedIds);
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
      await useAgentStore.getState().applyPersonaOp(personaId, { kind: 'MoveToGroup', group_id: groupId });
    } catch (err) {
      set({ error: errMsg(err, "Failed to move persona") });
    }
  },
});
