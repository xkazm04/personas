import type { RefObject } from "react";

import { driveParentPath } from "@/api/drive";

import { useFinderKeymap, type FinderKeyHandlers } from "./FinderKeymap";
import type { DriveApi } from "./types";
import type { FinderDialogsApi } from "./useFinderDialogs";
import type { FinderEditingApi } from "./useFinderEditing";
import type { FinderPrefsApi } from "./useFinderPrefs";
import type { useFinderTransfers } from "./useFinderTransfers";

interface Deps {
  drive: DriveApi;
  prefs: FinderPrefsApi;
  editing: FinderEditingApi;
  dialogs: FinderDialogsApi;
  transfers: ReturnType<typeof useFinderTransfers>;
  searchRef: RefObject<HTMLInputElement | null>;
  quickLookOpen: boolean;
  toggleQuickLook: () => void;
  closeQuickLook: () => void;
}

function firstSelected(drive: DriveApi) {
  const first = Array.from(drive.selection)[0];
  return drive.visibleEntries.find((e) => e.path === first) ?? null;
}

/** Binds every FinderAction to the engine — one document listener, attached once. */
export function useFinderKeyBindings(d: Deps): void {
  const { drive } = d;
  const recent = (idx: number) => () => {
    const entry = drive.recent[idx];
    if (!entry) return false;
    drive.navigate(driveParentPath(entry.path));
    queueMicrotask(() => drive.selectOnly(entry.path));
  };
  const move = (dir: 1 | -1) => () => {
    const list = drive.visibleEntries;
    if (list.length === 0) return false;
    const idx = list.findIndex((e) => drive.selection.has(e.path));
    const next = dir === 1 ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1);
    drive.selectOnly(list[next >= 0 ? next : 0]!.path);
  };

  const handlers: FinderKeyHandlers = {
    selectAll: drive.selectAll,
    focusSearch: () => {
      d.searchRef.current?.focus();
      d.searchRef.current?.select();
    },
    editPath: () => d.editing.setPathEditing(true),
    recent1: recent(0),
    recent2: recent(1),
    recent3: recent(2),
    recent4: recent(3),
    recent5: recent(4),
    copy: drive.copySelection,
    cut: drive.cutSelection,
    paste: () => void drive.pasteHere(),
    delete: () => {
      if (drive.selection.size === 0) return false;
      d.dialogs.requestDeleteSelection();
    },
    rename: d.editing.renameSelection,
    open: () => {
      const entry = firstSelected(drive);
      if (!entry) return false;
      d.transfers.handleOpen(entry);
    },
    moveUp: move(-1),
    moveDown: move(1),
    goUp: drive.goUp,
    escape: () => {
      if (d.quickLookOpen) d.closeQuickLook();
      else drive.clearSelection();
      return false;
    },
    quickLook: d.toggleQuickLook,
    inspector: () => d.prefs.setInspectorOpen(!d.prefs.prefs.inspectorOpen),
    duplicate: () => void d.transfers.handleDuplicate(),
    newFolder: d.editing.requestNewFolder,
    export: () => void d.transfers.handleExport(),
    import: () => void d.transfers.handleImport(),
  };
  useFinderKeymap(handlers);
}
