import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DriveEntry } from "./fs";

// Tag index (Finder-style colour labels + named tags). Mirrors
// src-tauri/src/commands/drive/meta.rs — hand-written so the frontend
// packages compile before `export_bindings` regenerates src/lib/bindings/.

export type DriveTagColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "gray";

export const DRIVE_TAG_COLORS: readonly DriveTagColor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
] as const;

export interface DriveTag {
  /** `label:<color>` for the seven builtins, `tag:<uuid>` for user tags. */
  id: string;
  name: string;
  color: DriveTagColor;
  builtin: boolean;
}

export interface DriveMeta {
  version: number;
  vocab: DriveTag[];
  /** rel_path -> tag ids applied to that entry. */
  labels: Record<string, string[]>;
  /** Set when the index file was unreadable and moved aside. */
  warning: string | null;
}

/** Builtin label id for a colour. */
export const driveLabelId = (color: DriveTagColor) => `label:${color}`;

export const driveMetaGet = () => invoke<DriveMeta>("drive_meta_get");

export const driveTagsSet = (relPath: string, tagIds: string[]) =>
  invoke<DriveMeta>("drive_tags_set", { relPath, tagIds });

export const driveTagUpsert = (tag: DriveTag) =>
  invoke<DriveMeta>("drive_tag_upsert", { tag });

export const driveTagDelete = (tagId: string) =>
  invoke<DriveMeta>("drive_tag_delete", { tagId });

export const driveTagged = (tagId: string) =>
  invoke<DriveEntry[]>("drive_tagged", { tagId });
