import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ExportStats } from "@/lib/bindings/ExportStats";
import type { PortabilityImportResult } from "@/lib/bindings/PortabilityImportResult";
import type { CompetitiveImportPreview } from "@/lib/bindings/CompetitiveImportPreview";
import type { CredentialImportResult } from "@/lib/bindings/CredentialImportResult";
export type { ExportStats, PortabilityImportResult, CompetitiveImportPreview, CredentialImportResult };

// ============================================================================
// Commands
// ============================================================================

export const getExportStats = () =>
  invoke<ExportStats>("get_export_stats");

export const exportFull = (includeMemories: boolean, passphrase?: string) =>
  invoke<boolean>("export_full", { includeMemories, passphrase: passphrase ?? null });

export const exportSelective = (personaIds: string[], teamIds: string[], credentialIds: string[], projectIds: string[], workspaceIds: string[], includeMemories: boolean, includeKpis: boolean, passphrase?: string) =>
  invoke<boolean>("export_selective", { personaIds, teamIds, credentialIds, projectIds, workspaceIds, includeMemories, includeKpis, passphrase: passphrase ?? null });

export const importPortabilityBundle = (passphrase?: string, projectResolutionsJson?: string, filePathOverride?: string) =>
  invoke<PortabilityImportResult | null>("import_portability_bundle", {
    passphrase: passphrase ?? null,
    projectResolutionsJson: projectResolutionsJson ?? null,
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
