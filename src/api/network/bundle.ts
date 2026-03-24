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

export interface NetworkAccessScope {
  level: 'none' | 'restricted' | 'unrestricted';
  domains: string[];
  tool_integrations: string[];
  api_endpoints: string[];
}

export interface BundleImportPreview {
  preview_id: string;
  signer_peer_id: string;
  signer_display_name: string;
  signature_valid: boolean;
  signer_trusted: boolean;
  resources: BundleResourcePreview[];
  network_scope: NetworkAccessScope;
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
// Types (clipboard)
// ============================================================================

export interface ClipboardExportResult {
  base64: string;
  bundle_hash: string;
  resource_count: number;
  byte_size: number;
}

// ============================================================================
// Export
// ============================================================================

export const exportPersonaBundle = (resourceIds: string[], savePath: string) =>
  invoke<BundleExportResult>("export_persona_bundle", { resourceIds, savePath });

export const exportBundleToClipboard = (resourceIds: string[]) =>
  invoke<ClipboardExportResult>("export_bundle_to_clipboard", { resourceIds });

// ============================================================================
// Import
// ============================================================================

export const previewBundleImport = (filePath: string) =>
  invoke<BundleImportPreview>("preview_bundle_import", { filePath });

export const previewBundleFromClipboard = (base64Data: string) =>
  invoke<BundleImportPreview>("preview_bundle_from_clipboard", { base64Data });

export const applyBundleImport = (filePath: string, options: BundleImportOptions) =>
  invoke<BundleImportResult>("apply_bundle_import", { filePath, options });

export const applyBundleFromClipboard = (base64Data: string, options: BundleImportOptions) =>
  invoke<BundleImportResult>("apply_bundle_from_clipboard", { base64Data, options });

// ============================================================================
// Verify
// ============================================================================

export const verifyBundle = (filePath: string) =>
  invoke<BundleVerification>("verify_bundle", { filePath });

// ============================================================================
// Share Link
// ============================================================================

export interface ShareLinkResult {
  url: string;
  deep_link: string;
  token: string;
  resource_count: number;
  byte_size: number;
  expires_at: string;
}

export interface ResolvedShareLink {
  http_url: string;
  token: string;
  peer_id: string;
  bundle_hash: string;
  resource_count: number;
  host: string;
}

export const createShareLink = (resourceIds: string[]) =>
  invoke<ShareLinkResult>("create_share_link", { resourceIds });

export const previewShareLink = (url: string) =>
  invoke<BundleImportPreview>("preview_share_link", { url });

export const importFromShareLink = (url: string, options: BundleImportOptions) =>
  invoke<BundleImportResult>("import_from_share_link", { url, options });

export const resolveShareDeepLink = (url: string) =>
  invoke<ResolvedShareLink>("resolve_share_deep_link", { url });
