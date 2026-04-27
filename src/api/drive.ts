import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// Frontend trust boundary: every drive_* IPC takes a relative path that the
// Rust backend resolves against a managed root. Without client-side validation,
// a prompt-injected persona tool call (e.g. `driveRead("../../../.ssh/id_rsa")`)
// is forwarded straight to the backend; the backend has its own checks but
// surfacing failures here means the bad call never crosses the IPC boundary,
// the error message stays in the calling component, and we don't depend on
// the backend's exact policy for first-line defence.
const MAX_REL_PATH_LEN = 1024;
function validateRelPath(relPath: string): string {
  if (typeof relPath !== 'string') {
    throw new Error(`drive: invalid path (must be string, got ${typeof relPath})`);
  }
  if (relPath.length === 0) return relPath; // empty == managed root
  if (relPath.length > MAX_REL_PATH_LEN) {
    throw new Error(`drive: path exceeds ${MAX_REL_PATH_LEN} characters`);
  }
  if (relPath.includes('\0')) {
    throw new Error('drive: path contains NUL byte');
  }
  if (relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new Error('drive: absolute paths are not allowed');
  }
  if (/^[a-zA-Z]:/.test(relPath)) {
    throw new Error('drive: drive letters are not allowed');
  }
  const normalized = relPath.replace(/\\/g, '/');
  for (const seg of normalized.split('/')) {
    if (seg === '..') {
      throw new Error('drive: parent-directory traversal (".." segment) is not allowed');
    }
  }
  return relPath;
}
function validateRenameTarget(newName: string): string {
  if (typeof newName !== 'string' || newName.length === 0) {
    throw new Error('drive: rename target must be a non-empty file name');
  }
  if (newName.includes('/') || newName.includes('\\') || newName.includes('\0')) {
    throw new Error('drive: rename target must be a simple file name (no path separators or NUL)');
  }
  return newName;
}

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
  invoke<DriveEntry[]>("drive_list", { relPath: validateRelPath(relPath) });

export const driveListTree = (relPath: string, maxDepth?: number) =>
  invoke<DriveTreeNode>("drive_list_tree", {
    relPath: validateRelPath(relPath),
    maxDepth: maxDepth ?? null,
  });

export const driveStat = (relPath: string) =>
  invoke<DriveEntry>("drive_stat", { relPath: validateRelPath(relPath) });

export const driveRead = (relPath: string) =>
  invoke<number[]>("drive_read", { relPath: validateRelPath(relPath) });

export const driveReadText = (relPath: string) =>
  invoke<string>("drive_read_text", { relPath: validateRelPath(relPath) });

export const driveWrite = (relPath: string, content: Uint8Array) =>
  invoke<DriveEntry>("drive_write", {
    relPath: validateRelPath(relPath),
    content: Array.from(content),
  });

export const driveWriteText = (relPath: string, content: string) =>
  invoke<DriveEntry>("drive_write_text", {
    relPath: validateRelPath(relPath),
    content,
  });

export const driveMkdir = (relPath: string) =>
  invoke<DriveEntry>("drive_mkdir", { relPath: validateRelPath(relPath) });

export const driveDelete = (relPath: string) =>
  invoke<void>("drive_delete", { relPath: validateRelPath(relPath) });

export const driveRename = (relPath: string, newName: string) =>
  invoke<DriveEntry>("drive_rename", {
    relPath: validateRelPath(relPath),
    newName: validateRenameTarget(newName),
  });

export const driveMove = (srcRel: string, dstRel: string) =>
  invoke<DriveEntry>("drive_move", {
    srcRel: validateRelPath(srcRel),
    dstRel: validateRelPath(dstRel),
  });

export const driveCopy = (srcRel: string, dstRel: string) =>
  invoke<DriveEntry>("drive_copy", {
    srcRel: validateRelPath(srcRel),
    dstRel: validateRelPath(dstRel),
  });

export const driveOpenInOs = (relPath: string) =>
  invoke<void>("drive_open_in_os", { relPath: validateRelPath(relPath) });

export const driveRevealInOs = (relPath: string) =>
  invoke<void>("drive_reveal_in_os", { relPath: validateRelPath(relPath) });

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
      relPath: validateRelPath(relPath),
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
    { relPath: validateRelPath(relPath), prompt: prompt ?? null },
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
