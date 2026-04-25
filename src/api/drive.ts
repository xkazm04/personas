import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export type DriveEntryKind = "file" | "folder";

export interface DriveEntry {
  name: string;
  path: string;
  kind: DriveEntryKind;
  size: number;
  modified: string;
  mime: string | null;
  extension: string | null;
}

export interface DriveTreeNode {
  name: string;
  path: string;
  children: DriveTreeNode[];
  hasMoreChildren: boolean;
}

export interface DriveStorageInfo {
  root: string;
  usedBytes: number;
  entryCount: number;
  isDev: boolean;
}

export const driveGetRoot = () => invoke<string>("drive_get_root");

export const driveStorageInfo = () =>
  invoke<DriveStorageInfo>("drive_storage_info");

export const driveList = (relPath: string) =>
  invoke<DriveEntry[]>("drive_list", { relPath });

export const driveListTree = (relPath: string, maxDepth?: number) =>
  invoke<DriveTreeNode>("drive_list_tree", { relPath, maxDepth: maxDepth ?? null });

export const driveStat = (relPath: string) =>
  invoke<DriveEntry>("drive_stat", { relPath });

export const driveRead = (relPath: string) =>
  invoke<number[]>("drive_read", { relPath });

export const driveReadText = (relPath: string) =>
  invoke<string>("drive_read_text", { relPath });

export const driveWrite = (relPath: string, content: Uint8Array) =>
  invoke<DriveEntry>("drive_write", { relPath, content: Array.from(content) });

export const driveWriteText = (relPath: string, content: string) =>
  invoke<DriveEntry>("drive_write_text", { relPath, content });

export const driveMkdir = (relPath: string) =>
  invoke<DriveEntry>("drive_mkdir", { relPath });

export const driveDelete = (relPath: string) =>
  invoke<void>("drive_delete", { relPath });

export const driveRename = (relPath: string, newName: string) =>
  invoke<DriveEntry>("drive_rename", { relPath, newName });

export const driveMove = (srcRel: string, dstRel: string) =>
  invoke<DriveEntry>("drive_move", { srcRel, dstRel });

export const driveCopy = (srcRel: string, dstRel: string) =>
  invoke<DriveEntry>("drive_copy", { srcRel, dstRel });

export const driveOpenInOs = (relPath: string) =>
  invoke<void>("drive_open_in_os", { relPath });

export const driveRevealInOs = (relPath: string) =>
  invoke<void>("drive_reveal_in_os", { relPath });

// ---------------------------------------------------------------------------
// OCR (consolidated from the retired OCR plugin)
// ---------------------------------------------------------------------------

export interface OcrDocumentLite {
  id: string;
  file_name: string;
  file_path: string | null;
  provider: string;
  model: string | null;
  extracted_text: string;
  duration_ms: number;
  token_count: number | null;
  created_at: string;
}

export interface OcrDriveResult {
  document: OcrDocumentLite;
  raw_response: string | null;
}

/**
 * Run Gemini OCR on a drive file. Uses the managed-root sandbox + fetches
 * the Gemini API key from the vault credential server-side (key never
 * touches the frontend). Pinned to gemini-3-flash-preview in the backend.
 */
export const ocrDriveFileGemini = (
  relPath: string,
  credentialId: string,
  prompt?: string,
  operationId?: string,
) =>
  invoke<OcrDriveResult>(
    "ocr_drive_file_gemini",
    {
      relPath,
      credentialId,
      prompt: prompt ?? null,
      operationId: operationId ?? null,
    },
    undefined,
    180_000,
  );

/**
 * Run Claude CLI OCR on a drive file. Uses the user's local Claude
 * subscription (no vault credential lookup) — succeeds when the
 * `claude` binary is on PATH; otherwise the backend returns a
 * "Claude Code CLI not found in PATH" error. Generous 5-minute
 * timeout because the CLI is slower than the Gemini HTTP path.
 */
export const ocrDriveFileClaude = (relPath: string, prompt?: string) =>
  invoke<OcrDriveResult>(
    "ocr_drive_file_claude",
    { relPath, prompt: prompt ?? null },
    undefined,
    300_000,
  );

export const DRIVE_MIME_ICONS: Record<string, string> = {
  "text/plain": "FileText",
  "application/json": "Braces",
  "application/yaml": "Braces",
  "application/toml": "Braces",
  "text/csv": "Table",
  "text/html": "Globe",
  "text/css": "Palette",
  "application/javascript": "FileCode",
  "application/typescript": "FileCode",
  "application/pdf": "FileText",
  "image/png": "Image",
  "image/jpeg": "Image",
  "image/gif": "Image",
  "image/webp": "Image",
  "image/svg+xml": "Image",
  "image/bmp": "Image",
  "audio/mpeg": "Music",
  "audio/wav": "Music",
  "video/mp4": "Video",
  "video/webm": "Video",
  "application/zip": "Archive",
  "application/x-tar": "Archive",
  "application/gzip": "Archive",
};

export function driveFormatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function driveJoinPath(parent: string, name: string): string {
  const base = parent.replace(/^\/+|\/+$/g, "");
  if (!base) return name;
  return `${base}/${name}`;
}

export function driveParentPath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? "" : trimmed.slice(0, idx);
}

export function driveBasename(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}
