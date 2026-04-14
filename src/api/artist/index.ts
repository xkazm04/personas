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

// -- FFmpeg Detection & Probing ---------------------------------------------

export interface FfmpegStatus {
  found: boolean;
  path: string | null;
  version: string | null;
}

export interface MediaProbeResult {
  duration: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  codec: string | null;
  filePath: string;
}

/** Check whether ffmpeg is installed and return its version + path. */
export const artistCheckFfmpeg = () =>
  invoke<FfmpegStatus>("artist_check_ffmpeg");

/** Probe a media file with ffprobe for duration, dimensions, and codec info. */
export const artistProbeMedia = (filePath: string) =>
  invoke<MediaProbeResult>("artist_probe_media", { filePath });

// -- Media Export (ffmpeg) --------------------------------------------------

/**
 * Start an FFmpeg export of a composition to MP4.
 * Runs in a background task; listen for `media_export_progress`,
 * `media_export_status`, and `media_export_complete` events to track progress.
 */
export const artistExportComposition = (
  jobId: string,
  compositionJson: string,
  outputPath: string,
) =>
  invoke<{ job_id: string }>("artist_export_composition", {
    jobId,
    compositionJson,
    outputPath,
  });

export const artistCancelExport = (jobId: string) =>
  invoke<boolean>("artist_cancel_export", { jobId });

// -- Quick-win one-shot operations -----------------------------------------

/** Extract audio track from a media file to a standalone file. */
export const artistExtractAudio = (inputPath: string, outputPath: string) =>
  invoke<string>("artist_extract_audio", { inputPath, outputPath }, undefined, 120_000);

/** Save a single frame from a video as an image file. */
export const artistSaveThumbnail = (
  inputPath: string,
  timeSeconds: number,
  outputPath: string,
) =>
  invoke<string>(
    "artist_save_thumbnail",
    { inputPath, timeSeconds, outputPath },
    undefined,
    60_000,
  );

export interface LoudnessStats {
  /** Integrated program loudness (LUFS) — main value used for gain. */
  integrated: number;
  /** Loudness range (LU). */
  lra: number;
  /** True peak (dBTP). */
  truePeak: number;
  /** loudnorm's internal threshold. */
  threshold: number;
}

/**
 * Measure integrated loudness of a media file. Drives true linear gain in
 * the preview so it matches the export's loudnorm pass.
 */
export const artistMeasureLoudness = (filePath: string) =>
  invoke<LoudnessStats>("artist_measure_loudness", { filePath }, undefined, 120_000);

/** Trim a media file between start/end seconds into a new file. */
export const artistTrimFile = (
  inputPath: string,
  startSeconds: number,
  endSeconds: number,
  outputPath: string,
) =>
  invoke<string>(
    "artist_trim_file",
    { inputPath, startSeconds, endSeconds, outputPath },
    undefined,
    300_000,
  );
