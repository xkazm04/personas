import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// -- Types ------------------------------------------------------------------

export interface ArtistAsset {
  id: string;
  fileName: string;
  filePath: string;
  assetType: "2d" | "3d";
  mimeType: string | null;
  fileSize: number;
  width: number | null;
  height: number | null;
  thumbnailPath: string | null;
  tags: string | null;
  source: string | null;
  createdAt: string;
}

export interface BlenderMcpStatus {
  installed: boolean;
  blenderPath: string | null;
  blenderVersion: string | null;
  mcpInstalled: boolean;
  mcpRunning: boolean;
  sessionId: string | null;
}

// -- Blender MCP ------------------------------------------------------------

export const artistCheckBlender = () =>
  invoke<BlenderMcpStatus>("artist_check_blender");

export const artistInstallBlenderMcp = () =>
  invoke<string>("artist_install_blender_mcp", undefined, undefined, 120_000);

// -- Asset Management -------------------------------------------------------

export const artistScanFolder = (folder: string) =>
  invoke<ArtistAsset[]>("artist_scan_folder", { folder });

export const artistListAssets = (assetType?: string | null) =>
  invoke<ArtistAsset[]>("artist_list_assets", { assetType: assetType ?? null });

/** Import asset. Returns null if file_path already exists in DB. */
export const artistImportAsset = (asset: ArtistAsset) =>
  invoke<ArtistAsset | null>("artist_import_asset", { asset });

export const artistDeleteAsset = (id: string) =>
  invoke<boolean>("artist_delete_asset", { id });

export const artistUpdateTags = (id: string, tags: string) =>
  invoke<ArtistAsset>("artist_update_tags", { id, tags });

// -- Folder Management ------------------------------------------------------

export const artistGetDefaultFolder = () =>
  invoke<string>("artist_get_default_folder");

export const artistEnsureFolders = (folder: string) =>
  invoke<void>("artist_ensure_folders", { folder });

/** Read a local image file and return a base64 data URL for rendering. */
export const artistReadImageBase64 = (filePath: string) =>
  invoke<string>("artist_read_image_base64", { filePath });

// -- Creative Session -------------------------------------------------------

export const artistRunCreativeSession = (
  sessionId: string,
  userPrompt: string,
  tools: string[],
  outputFolder?: string | null,
) =>
  invoke<{ session_id: string }>("artist_run_creative_session", {
    sessionId,
    userPrompt,
    tools,
    outputFolder: outputFolder ?? null,
  });

export const artistCancelCreativeSession = (sessionId: string) =>
  invoke<boolean>("artist_cancel_creative_session", { sessionId });
