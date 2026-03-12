import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Types
// ============================================================================

export interface BundleExportResult {
  bundle_hash: string;
  resource_count: number;
  byte_size: number;
}

export interface BundleResourcePreview {
  resource_type: string;
  resource_id: string;
  display_name: string;
  access_level: string;
  tags: string[];
  conflict: boolean;
  conflict_name: string | null;
}

export interface BundleImportPreview {
  preview_id: string;
  signer_peer_id: string;
  signer_display_name: string;
  signature_valid: boolean;
  signer_trusted: boolean;
  resources: BundleResourcePreview[];
  bundle_hash: string;
  created_at: string;
}

export interface BundleImportOptions {
  skip_conflicts: boolean;
  rename_prefix?: string | null;
  /** When set, apply uses cached preview bytes instead of re-reading the file. */
  preview_id?: string | null;
}

export interface BundleImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface BundleVerification {
  signature_valid: boolean;
  signer_peer_id: string;
  signer_display_name: string;
  signer_trusted: boolean;
  resource_count: number;
  bundle_hash: string;
  created_at: string;
}

// ============================================================================
// Export
// ============================================================================

export const exportPersonaBundle = (resourceIds: string[], savePath: string) =>
  invoke<BundleExportResult>("export_persona_bundle", { resourceIds, savePath });

// ============================================================================
// Import
// ============================================================================

export const previewBundleImport = (filePath: string) =>
  invoke<BundleImportPreview>("preview_bundle_import", { filePath });

export const applyBundleImport = (filePath: string, options: BundleImportOptions) =>
  invoke<BundleImportResult>("apply_bundle_import", { filePath, options });

// ============================================================================
// Verify
// ============================================================================

export const verifyBundle = (filePath: string) =>
  invoke<BundleVerification>("verify_bundle", { filePath });
