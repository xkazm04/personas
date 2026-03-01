import { invoke } from "@tauri-apps/api/core";
import type { PlatformDefinition } from "@/lib/personas/platformDefinitions";

// ============================================================================
// Platform Definition Summary (from list command)
// ============================================================================

export interface PlatformDefinitionSummary {
  id: string;
  label: string;
  format: string;
  isBuiltin: boolean;
  nodeTypeCount: number;
  credentialRuleCount: number;
}

// ============================================================================
// API Functions
// ============================================================================

export const listPlatformDefinitions = () =>
  invoke<PlatformDefinitionSummary[]>("list_platform_definitions");

export const getPlatformDefinition = (id: string) =>
  invoke<PlatformDefinition>("get_platform_definition", { id });
