import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DriveEntry } from "./fs";

// Duplicate / import / export / drag-out. Mirrors
// src-tauri/src/commands/drive/transfer.rs and thumbs.rs. Bytes never cross
// IPC: import and export copy on the Rust side from absolute OS paths.

export interface DriveTransferFailure {
  name: string;
  reason: string;
}

export interface DriveTransferReport {
  added: number;
  tooLarge: string[];
  failed: DriveTransferFailure[];
}

export type DriveThumbEdge = 96 | 256 | 1024;

/** JPEG bytes for an image entry, downsized to `edge` px on the long side. */
export const driveThumbnail = (relPath: string, edge: DriveThumbEdge) =>
  invoke<ArrayBuffer>("drive_thumbnail", { relPath, edge });

export const driveDuplicate = (relPath: string) =>
  invoke<DriveEntry>("drive_duplicate", { relPath });

/** Copy absolute OS paths (from the dialog plugin) into `destRel`. */
export const driveImportPaths = (paths: string[], destRel: string) =>
  invoke<DriveTransferReport>("drive_import_paths", { paths, destRel }, undefined, 300_000);

/** Copy drive entries out to an absolute OS directory. */
export const driveExportTo = (relPaths: string[], destDir: string) =>
  invoke<DriveTransferReport>("drive_export_to", { relPaths, destDir }, undefined, 300_000);

/** Absolute paths for a set of entries (handed to the native drag-out). */
export const driveAbsPaths = (relPaths: string[]) =>
  invoke<string[]>("drive_abs_paths", { relPaths });
