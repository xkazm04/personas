import type { MouseEvent } from "react";

import type { DriveEntry } from "@/api/drive";
import type { DriveApi } from "../types";

/** Classic selection grammar: click = only, Ctrl/⌘ = toggle, Shift = range. */
export function selectByClick(drive: DriveApi, entry: DriveEntry, e: MouseEvent): void {
  if (e.shiftKey) drive.selectRange(entry.path);
  else if (e.ctrlKey || e.metaKey) drive.toggleSelect(entry.path, true);
  else drive.selectOnly(entry.path);
}

/** Right-click selects the target first unless it is already part of the selection. */
export function selectForContextMenu(drive: DriveApi, entry: DriveEntry): void {
  if (!drive.isSelected(entry.path)) drive.selectOnly(entry.path);
}

/** Paths a drag carries: the whole selection when the source is in it, else the source alone. */
export function dragPathsFor(drive: DriveApi, entry: DriveEntry): string[] {
  return drive.selection.size > 0 && drive.selection.has(entry.path)
    ? Array.from(drive.selection)
    : [entry.path];
}

/** First selected entry in visual order, or null. */
export function firstSelected(drive: DriveApi, entries: DriveEntry[]): DriveEntry | null {
  return entries.find((e) => drive.selection.has(e.path)) ?? null;
}

/** State classes shared by rows and tiles. Selection wins over the write-flash. */
export function entryStateClass(selected: boolean, flash: boolean): string {
  if (selected) return "bg-primary/15 ring-1 ring-primary/40";
  if (flash) return "bg-status-success/15";
  return "hover:bg-secondary/30";
}
