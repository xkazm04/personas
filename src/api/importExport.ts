import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Import/Export
// ============================================================================

export const exportPersona = (personaId: string) =>
  invoke<boolean>("export_persona", { personaId });

export const importPersona = () =>
  invoke<string | null>("import_persona");
