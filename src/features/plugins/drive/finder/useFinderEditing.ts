import { useCallback, useState } from "react";

import type { DriveEntry } from "@/api/drive";

import type { DriveApi } from "./types";

/**
 * Inline rename / inline create (phantom row) and the internal-drag count —
 * the transient editing state every view consumes through FinderViewProps.
 */
export function useFinderEditing(drive: DriveApi) {
  const [inlineRenamingPath, setInlineRenamingPath] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<"folder" | "file" | null>(null);
  const [activeDragCount, setActiveDragCount] = useState<number | null>(null);
  // Mod+L / pencil: the breadcrumb swaps for a path input until Enter/Esc/blur.
  const [pathEditing, setPathEditing] = useState(false);

  const requestRename = useCallback((entry: DriveEntry) => setInlineRenamingPath(entry.path), []);

  const renameSelection = useCallback((): boolean => {
    const first = Array.from(drive.selection)[0];
    const entry = drive.visibleEntries.find((e) => e.path === first);
    if (!entry) return false;
    setInlineRenamingPath(entry.path);
    return true;
  }, [drive.selection, drive.visibleEntries]);

  const commitInlineRename = useCallback(
    (path: string, newName: string) => {
      setInlineRenamingPath(null);
      const trimmed = newName.trim();
      if (!trimmed) return;
      const current = drive.visibleEntries.find((e) => e.path === path);
      if (current && current.name === trimmed) return; // no-op
      void drive.rename(path, trimmed);
    },
    [drive],
  );

  const commitPendingCreate = useCallback(
    (name: string) => {
      const kind = pendingCreate;
      setPendingCreate(null);
      const trimmed = name.trim();
      if (!trimmed || !kind) return;
      void (kind === "folder" ? drive.createFolder(trimmed) : drive.createFile(trimmed));
    },
    [pendingCreate, drive],
  );

  return {
    inlineRenamingPath,
    requestRename,
    renameSelection,
    commitInlineRename,
    cancelInlineRename: useCallback(() => setInlineRenamingPath(null), []),
    pendingCreate,
    requestNewFolder: useCallback(() => setPendingCreate("folder"), []),
    requestNewFile: useCallback(() => setPendingCreate("file"), []),
    commitPendingCreate,
    cancelPendingCreate: useCallback(() => setPendingCreate(null), []),
    pathEditing,
    setPathEditing,
    requestCreate: useCallback((kind: "folder" | "file") => setPendingCreate(kind), []),
    activeDragCount,
    onDragSelectionStart: useCallback((count: number) => setActiveDragCount(count), []),
    onDragSelectionEnd: useCallback(() => setActiveDragCount(null), []),
  };
}

export type FinderEditingApi = ReturnType<typeof useFinderEditing>;
