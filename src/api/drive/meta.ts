import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DriveEntry } from "./fs";

import type { DriveMeta } from "@/lib/bindings/DriveMeta";
import type { DriveTag } from "@/lib/bindings/DriveTag";
import type { DriveTagColor } from "@/lib/bindings/DriveTagColor";

// Tag index (Finder-style colour labels + named tags). The wire types are the
// generated ts-rs bindings, so there is no second copy to keep in step.
export type { DriveMeta, DriveTag, DriveTagColor };

export const DRIVE_TAG_COLORS: readonly DriveTagColor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
] as const;

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
