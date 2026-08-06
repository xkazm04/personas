import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ExportStats as ExportStatsBinding } from "@/lib/bindings/ExportStats";
import type { PortabilityImportResult as PortabilityImportResultBinding } from "@/lib/bindings/PortabilityImportResult";
import type { ImportConflict } from "@/lib/bindings/ImportConflict";
import type { CompetitiveImportPreview } from "@/lib/bindings/CompetitiveImportPreview";
import type { CredentialImportResult } from "@/lib/bindings/CredentialImportResult";

// ============================================================================
// Contract shim — twins + Athena memory scopes
// ----------------------------------------------------------------------------
// The Rust side of this feature grows `ExportStats` and `PortabilityImportResult`
// (and swaps `project_conflicts` for the entity-agnostic `import_conflicts`).
// Until that regen lands in `src/lib/bindings/`, the extra fields are declared
// here so the frontend compiles against the agreed contract. Once the generated
// files carry the fields, these intersections become no-ops and can be collapsed
// back to a plain re-export.
// ============================================================================

export type ExportStats = ExportStatsBinding & {
  twin_count: number;
  athena_core_count: number;
  athena_learned_count: number;
  /** Export-side truncation warnings (e.g. a capped memory window). */
  warnings: string[];
};

export type PortabilityImportResult = Omit<PortabilityImportResultBinding, "project_conflicts"> & {
  /** Replaces `project_conflicts` — now covers dev projects AND twins. */
  import_conflicts: ImportConflict[];
  twins_imported: number;
  twins_skipped: number;
  twin_kb_chunks_imported: number;
  athena_memory_imported: number;
  athena_identity_replaced: boolean;
  reembed_queued: number;
};

export type { ImportConflict, CompetitiveImportPreview, CredentialImportResult };

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
    // The pass-2 resolution map is now keyed `"<kind>:<id>"` and covers twins
    // as well as projects. Both the legacy and the generalised argument name
    // are sent so this wrapper works against either Rust signature; Tauri
    // ignores payload keys a command does not declare. Collapse to the single
    // surviving name once the Rust side has landed.
    projectResolutionsJson: resolutionsJson ?? null,
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
