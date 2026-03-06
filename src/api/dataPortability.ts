import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Types (mirrors Rust data_portability.rs)
// ============================================================================

export interface ExportStats {
  persona_count: number;
  group_count: number;
  tool_count: number;
  team_count: number;
  connector_count: number;
  memory_count: number;
  test_suite_count: number;
}

export interface PortabilityImportResult {
  personas_created: number;
  teams_created: number;
  tools_created: number;
  groups_created: number;
  connectors_created: number;
  warnings: string[];
  id_mapping: Record<string, string>;
}

export interface CompetitiveImportPreview {
  source_platform: string;
  workflow_name: string;
  description: string;
  suggested_tools: string[];
  suggested_triggers: string[];
}

// ============================================================================
// Commands
// ============================================================================

export const getExportStats = () =>
  invoke<ExportStats>("get_export_stats");

export const exportFull = () =>
  invoke<boolean>("export_full");

export const exportSelective = (personaIds: string[], teamIds: string[]) =>
  invoke<boolean>("export_selective", { personaIds, teamIds });

export const importPortabilityBundle = () =>
  invoke<PortabilityImportResult | null>("import_portability_bundle");

export const previewCompetitiveImport = () =>
  invoke<CompetitiveImportPreview[] | null>("preview_competitive_import");
