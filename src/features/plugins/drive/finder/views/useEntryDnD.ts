import { useCallback, useState } from "react";
import type { DragEvent } from "react";

import type { DriveEntry } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import { parseDriveMovePayload } from "../../hooks/useDrive";
import { DRIVE_MOVE_MIME, type FinderViewProps } from "../types";
import { dragPathsFor } from "./selection";

export interface EntryDragHandlers {
  draggable: true;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

export interface EntryDnD {
  /** Spread onto a row/tile: drag source + (for folders) drop target. */
  handlers: (entry: DriveEntry) => EntryDragHandlers;
  /** Internal or OS-file drag currently hovering this folder. */
  isDropTarget: (path: string) => boolean;
  /** Drop affordance: hot ring when hovered, soft ring on every folder while a drag is in flight. */
  dropClass: (entry: DriveEntry) => string;
}

/**
 * Drag & drop grammar shared by every Finder view. Internal drags carry the
 * classic `DRIVE_MOVE_MIME` JSON payload; Alt-drag hands the paths to the
 * native OS drag instead; OS-file drags over a folder are reported upward so
 * the shell can write into it.
 */
export function useEntryDnD(view: FinderViewProps): EntryDnD {
  const {
    drive,
    activeDragCount,
    externalDropPath,
    onDragSelectionStart,
    onDragSelectionEnd,
    onExternalFolderDragOver,
    onNativeDragOut,
  } = view;
  const [hover, setHover] = useState<string | null>(null);

  const isDropTarget = useCallback(
    (path: string) => hover === path || externalDropPath === path,
    [hover, externalDropPath],
  );

  const dropClass = useCallback(
    (entry: DriveEntry) => {
      if (entry.kind !== "folder") return "";
      if (isDropTarget(entry.path)) return "bg-accent/20 ring-1 ring-accent/60";
      return activeDragCount !== null ? "ring-1 ring-accent/30" : "";
    },
    [activeDragCount, isDropTarget],
  );

  const handlers = useCallback(
    (entry: DriveEntry): EntryDragHandlers => ({
      draggable: true,
      onDragStart: (e) => {
        if (!drive.isSelected(entry.path)) drive.selectOnly(entry.path);
        const paths = dragPathsFor(drive, entry);
        if (e.altKey) {
          e.preventDefault();
          onNativeDragOut(paths);
          return;
        }
        e.dataTransfer.setData(DRIVE_MOVE_MIME, JSON.stringify({ paths }));
        e.dataTransfer.effectAllowed = "move";
        onDragSelectionStart(paths.length);
      },
      onDragEnd: () => onDragSelectionEnd(),
      onDragOver: (e) => {
        if (entry.kind !== "folder") return;
        e.preventDefault();
        if (e.dataTransfer?.types?.includes("Files")) {
          e.dataTransfer.dropEffect = "copy";
          onExternalFolderDragOver(entry.path);
          return;
        }
        e.dataTransfer.dropEffect = "move";
        setHover(entry.path);
      },
      onDragLeave: () => {
        setHover((h) => (h === entry.path ? null : h));
        if (externalDropPath === entry.path) onExternalFolderDragOver(null);
      },
      onDrop: (e) => {
        e.preventDefault();
        setHover(null);
        if (entry.kind !== "folder") return;
        const paths = parseDriveMovePayload(e);
        if (!paths) return;
        drive.moveManyInto(paths, entry.path).catch(silentCatch("drive:finder-drop"));
      },
    }),
    [
      drive,
      externalDropPath,
      onDragSelectionStart,
      onDragSelectionEnd,
      onExternalFolderDragOver,
      onNativeDragOut,
    ],
  );

  return { handlers, isDropTarget, dropClass };
}
