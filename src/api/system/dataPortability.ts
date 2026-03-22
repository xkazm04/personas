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

export const exportFull = () =>
  invoke<boolean>("export_full");

export const exportSelective = (personaIds: string[], teamIds: string[]) =>
  invoke<boolean>("export_selective", { personaIds, teamIds });

export const importPortabilityBundle = () =>
  invoke<PortabilityImportResult | null>("import_portability_bundle");

export const previewCompetitiveImport = () =>
  invoke<CompetitiveImportPreview[] | null>("preview_competitive_import");

// ============================================================================
// Encrypted credential export / import
// ============================================================================

export const exportCredentials = (passphrase: string) =>
  invoke<boolean>("export_credentials", { passphrase });

export const importCredentials = (passphrase: string, resolutionsJson?: string) =>
  invoke<CredentialImportResult | null>("import_credentials", { passphrase, resolutionsJson: resolutionsJson ?? null });
