import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ExportStats } from "@/lib/bindings/ExportStats";
import type { PortabilityImportResult } from "@/lib/bindings/PortabilityImportResult";
import type { ImportConflict } from "@/lib/bindings/ImportConflict";
import type { CompetitiveImportPreview } from "@/lib/bindings/CompetitiveImportPreview";
import type { CredentialImportResult } from "@/lib/bindings/CredentialImportResult";

export type {
  ExportStats,
  PortabilityImportResult,
  ImportConflict,
  CompetitiveImportPreview,
  CredentialImportResult,
};

/** Athena's memory is a singleton, not a list — it is picked by tier. */
export type AthenaTier = "core" | "learned";

/**
 * Every scope of a selective export, as ONE named object.
 *
 * This used to be an 8-argument positional signature repeated at five call
 * sites, all `string[]` — a transposition was invisible to `tsc`. Adding a
 * scope must never be able to reintroduce that, so the whole chain
 * (`exportSelective` → `OnExport` → `picker.commit` → `handleExportSelective`)
 * passes this object through unchanged. The Rust command keeps named args;
 * only the TypeScript wrapper shape changed.
 */
export type ExportSelectionArgs = {
  personaIds: string[];
  teamIds: string[];
  credentialIds: string[];
  projectIds: string[];
  workspaceIds: string[];
  twinIds: string[];
  athenaTiers: AthenaTier[];
  includeMemories: boolean;
  includeKpis: boolean;
  passphrase?: string;
};

// ============================================================================
// Commands
// ============================================================================

export const getExportStats = () =>
  invoke<ExportStats>("get_export_stats");

export const exportFull = (includeMemories: boolean, passphrase?: string) =>
  invoke<boolean>("export_full", { includeMemories, passphrase: passphrase ?? null });

export const exportSelective = (args: ExportSelectionArgs) =>
  invoke<boolean>("export_selective", {
    personaIds: args.personaIds,
    teamIds: args.teamIds,
    credentialIds: args.credentialIds,
    projectIds: args.projectIds,
    workspaceIds: args.workspaceIds,
    twinIds: args.twinIds,
    athenaTiers: args.athenaTiers,
    includeMemories: args.includeMemories,
    includeKpis: args.includeKpis,
    passphrase: args.passphrase ?? null,
  });

export const importPortabilityBundle = (passphrase?: string, resolutionsJson?: string, filePathOverride?: string) =>
  invoke<PortabilityImportResult | null>("import_portability_bundle", {
    passphrase: passphrase ?? null,
    // The pass-2 resolution map is keyed `"<kind>:<id>"` and covers twins as
    // well as dev projects.
    resolutionsJson: resolutionsJson ?? null,
    filePathOverride: filePathOverride ?? null,
  });

export const previewCompetitiveImport = () =>
  invoke<CompetitiveImportPreview[] | null>("preview_competitive_import");

// ============================================================================
// Encrypted credential export / import
// ============================================================================

export const exportCredentials = (passphrase: string) =>
  invoke<boolean>("export_credentials", { passphrase });

export const importCredentials = (passphrase: string, resolutionsJson?: string, filePathOverride?: string) =>
  invoke<CredentialImportResult | null>("import_credentials", {
    passphrase,
    resolutionsJson: resolutionsJson ?? null,
    filePathOverride: filePathOverride ?? null,
  });
