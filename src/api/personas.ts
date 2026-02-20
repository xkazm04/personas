import { invoke } from "@tauri-apps/api/core";

import type { Persona } from "@/lib/bindings/Persona";
import type { CreatePersonaInput } from "@/lib/bindings/CreatePersonaInput";
import type { UpdatePersonaInput } from "@/lib/bindings/UpdatePersonaInput";

// ============================================================================
// Personas
// ============================================================================

export const listPersonas = () =>
  invoke<Persona[]>("list_personas");

export const getPersona = (id: string) =>
  invoke<Persona>("get_persona", { id });

export const createPersona = (input: CreatePersonaInput) =>
  invoke<Persona>("create_persona", { input });

export const updatePersona = (id: string, input: UpdatePersonaInput) =>
  invoke<Persona>("update_persona", { id, input });

export const deletePersona = (id: string) =>
  invoke<boolean>("delete_persona", { id });
