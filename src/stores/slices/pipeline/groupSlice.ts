import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { storeBus } from "@/lib/storeBus";
import type { PersonaGroup } from "@/lib/types/types";
import type { UpdatePersonaGroupInput } from "@/lib/bindings/UpdatePersonaGroupInput";
import { createGroup, deleteGroup, listGroups, reorderGroups, updateGroup } from "@/api/pipeline/groups";


export interface GroupSlice {
  // State
  groups: PersonaGroup[];

  // Actions
  fetchGroups: () => Promise<void>;
  createGroup: (input: { name: string; color?: string; description?: string }) => Promise<PersonaGroup | null>;
  /**
   * Partial update to a group. Three-state nullable semantics for the
   * nullable fields (description, defaultModelProfile, defaultMaxBudgetUsd,
   * defaultMaxTurns, sharedInstructions):
   *
   *   - field omitted              → preserve (no change)
   *   - field set to `null`        → clear the column to NULL
   *   - field set to a value       → set the column to that value
   *
   * Cycle 24 enabled this end-to-end via Option<Option<T>> + a custom
   * double_option serde deserializer on the Rust struct.
   */
  updateGroup: (id: string, updates: Partial<{
    name: string;
    color: string;
    collapsed: boolean;
    description: string | null;
    defaultModelProfile: string | null;
    defaultMaxBudgetUsd: number | null;
    defaultMaxTurns: number | null;
    sharedInstructions: string | null;
  }>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  reorderGroups: (orderedIds: string[]) => Promise<void>;
  /**
   * Convenience wrapper for the common "clear all defaults" pattern from
   * the editor. Equivalent to calling `updateGroup(id, { sharedInstructions:
   * null, defaultModelProfile: null, defaultMaxBudgetUsd: null,
   * defaultMaxTurns: null })`. Kept as a separate method so the UI's
   * intent is explicit and a future single-click action like "reset" can
   * extend it without rewriting every caller.
   */
  clearGroupDefaults: (id: string) => Promise<void>;
  movePersonaToGroup: (personaId: string, groupId: string | null) => Promise<void>;
}

export const createGroupSlice: StateCreator<PipelineStore, [], [], GroupSlice> = (set) => ({
  groups: [],

  fetchGroups: async () => {
    try {
      const groups = await listGroups();
      set({ groups });
    } catch (err) {
      reportError(err, "Failed to fetch groups", set);
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
      reportError(err, "Failed to create group", set);
      return null;
    }
  },

  updateGroup: async (id, updates) => {
    try {
      // Pass the user's intent through unchanged so the Rust side sees
      // the three states correctly (undefined = preserve, null = clear,
      // value = set). Building a full struct here would collapse undefined
      // and null into the same "null" on the wire — exactly the bug cycle
      // 24 fixed. The `UpdatePersonaGroupInput` binding now has all
      // nullable fields as `string | null | undefined`, matching the
      // double_option Rust deserializer.
      const input: UpdatePersonaGroupInput = updates as UpdatePersonaGroupInput;
      const group = await updateGroup(id, input);
      set((state) => ({
        groups: state.groups.map((g) => (g.id === id ? group : g)),
      }));
    } catch (err) {
      reportError(err, "Failed to update group", set);
    }
  },

  deleteGroup: async (id) => {
    try {
      await deleteGroup(id);
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id),
      }));
      // Notify agent store to clear group_id on affected personas
      storeBus.emit('trigger:changed', { personaId: '' }); // refresh detail view
      // The backend already clears group_id on delete; a fetchPersonas will pick it up
      storeBus.emit('network:personas-changed');
    } catch (err) {
      reportError(err, "Failed to delete group", set);
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
      reportError(err, "Failed to reorder groups", set);
    }
  },

  clearGroupDefaults: async (id) => {
    // After cycle 24's Option<Option<T>> refactor, "clear to NULL" is
    // expressible through the normal updateGroup path. Keep the dedicated
    // IPC as a backup path for direct callers, but the slice routes
    // through updateGroup so the editor's optimistic UI flow shares the
    // same store-update path as every other field change.
    try {
      const refreshed = await updateGroup(id, {
        sharedInstructions: null,
        defaultModelProfile: null,
        defaultMaxBudgetUsd: null,
        defaultMaxTurns: null,
      });
      set((state) => ({
        groups: state.groups.map((g) => (g.id === id ? refreshed : g)),
      }));
    } catch (err) {
      reportError(err, "Failed to clear group defaults", set);
    }
  },

  movePersonaToGroup: async (personaId, groupId) => {
    try {
      storeBus.emit('persona:move-to-group', { personaId, groupId });
    } catch (err) {
      reportError(err, "Failed to move persona", set);
    }
  },
});
