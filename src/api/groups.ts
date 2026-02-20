import { invoke } from "@tauri-apps/api/core";

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
