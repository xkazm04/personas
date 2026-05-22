import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaGroup } from "@/lib/bindings/PersonaGroup";
import type { CreatePersonaGroupInput } from "@/lib/bindings/CreatePersonaGroupInput";
import type { UpdatePersonaGroupInput } from "@/lib/bindings/UpdatePersonaGroupInput";

// ============================================================================
// Groups
// ============================================================================

export const listGroups = () =>
  invoke<PersonaGroup[]>("list_groups");

export const createGroup = (input: CreatePersonaGroupInput) =>
  invoke<PersonaGroup>("create_group", { input });

export const updateGroup = (id: string, input: UpdatePersonaGroupInput) =>
  invoke<PersonaGroup>("update_group", { id, input });

export const deleteGroup = (id: string) =>
  invoke<boolean>("delete_group", { id });

export const reorderGroups = (orderedIds: string[]) =>
  invoke<void>("reorder_groups", { orderedIds });

/**
 * Explicitly clear the four "default" caps on a group: `defaultModelProfile`,
 * `defaultMaxBudgetUsd`, `defaultMaxTurns`, `sharedInstructions`. Necessary
 * because the regular `update_group` IPC uses single-Option semantics where
 * `null` means "preserve, don't change" — there's no way to actively NULL
 * a field through it. Surfaces as a "Clear all defaults" affordance on
 * the group editor.
 */
export const clearGroupDefaults = (id: string) =>
  invoke<PersonaGroup>("clear_group_defaults", { id });
