import { useCallback, useEffect, useRef, useState } from "react";

import { driveParentPath, type DriveEntry } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";

import { trashEntryInfo } from "../designTokens";
import type { useSigning } from "../signing/useSigning";
import type { DriveApi } from "./types";

// Only the confirmations use a real modal — create + rename are inline.
export type FinderDialog = { kind: "delete"; paths: string[] } | { kind: "emptyTrash" } | null;

/**
 * Modal / drawer state for the Finder: delete + empty-trash confirmations,
 * the sign / verify / OCR targets, the signatures panel, and the
 * "Reveal in Drive" pending-select that commits once the destination
 * folder's entries have actually loaded (no timer race).
 */
export function useFinderDialogs(drive: DriveApi, signing: ReturnType<typeof useSigning>) {
  const [dialog, setDialog] = useState<FinderDialog>(null);
  const [signEntry, setSignEntry] = useState<DriveEntry | null>(null);
  const [verifyEntry, setVerifyEntry] = useState<DriveEntry | null>(null);
  const [ocrEntry, setOcrEntry] = useState<DriveEntry | null>(null);
  const [signaturesOpen, setSignaturesOpen] = useState(false);
  // "Move to…" popover anchor (toolbar button rect or the context-menu point).
  const [moveToAnchor, setMoveToAnchor] = useState<DOMRect | null>(null);

  // Eager-load the signature history so signed files carry a badge before
  // the panel is ever opened.
  const { refreshSignatures } = signing;
  useEffect(() => {
    refreshSignatures().catch(silentCatch("finder:signatures-eager"));
  }, [refreshSignatures]);

  const pendingSelectRef = useRef<string | null>(null);
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (!pending) return;
    if (drive.visibleEntries.some((e) => e.path === pending)) {
      drive.selectOnly(pending);
      pendingSelectRef.current = null;
    }
  }, [drive]);

  const revealInDrive = useCallback(
    (drivePath: string) => {
      pendingSelectRef.current = drivePath;
      drive.navigate(driveParentPath(drivePath));
    },
    [drive],
  );

  const requestDelete = useCallback((paths: string[]) => {
    if (paths.length > 0) setDialog({ kind: "delete", paths });
  }, []);

  const requestDeleteSelection = useCallback(() => {
    requestDelete(Array.from(drive.selection));
  }, [drive.selection, requestDelete]);

  const confirmDelete = useCallback(async () => {
    if (dialog?.kind !== "delete") return;
    await drive.remove(dialog.paths);
    setDialog(null);
  }, [dialog, drive]);

  // Items already inside .trash hard-delete on a second remove.
  const confirmEmptyTrash = useCallback(async () => {
    await drive.remove(drive.entries.map((e) => e.path));
    setDialog(null);
  }, [drive]);

  // Move each selected trash entry back to the root under its original
  // name (timestamp prefix stripped); one bulk move, one refresh.
  const restoreSelection = useCallback(async () => {
    const pairs = Array.from(drive.selection).map((p) => ({
      src: p,
      dst: trashEntryInfo(p.split("/").pop() ?? p).originalName,
    }));
    if (pairs.length === 0) return;
    await drive.moveMany(pairs);
    drive.clearSelection();
  }, [drive]);

  const signSelection = useCallback(() => {
    if (drive.selection.size !== 1) return;
    const path = Array.from(drive.selection)[0];
    const entry = drive.visibleEntries.find((e) => e.path === path);
    if (entry?.kind === "file") setSignEntry(entry);
  }, [drive.selection, drive.visibleEntries]);

  return {
    dialog,
    closeDialog: () => setDialog(null),
    requestDelete,
    requestDeleteSelection,
    requestEmptyTrash: () => setDialog({ kind: "emptyTrash" }),
    confirmDelete,
    confirmEmptyTrash,
    restoreSelection,
    signEntry,
    setSignEntry: (e: DriveEntry | null) => setSignEntry(e && e.kind === "file" ? e : null),
    signSelection,
    verifyEntry,
    setVerifyEntry,
    ocrEntry,
    setOcrEntry,
    signaturesOpen,
    setSignaturesOpen,
    moveToAnchor,
    // The popover reads `drive.selection` live, so a caller may selectOnly()
    // in the same batch before opening (context menu on an unselected row).
    openMoveTo: (rect: DOMRect) => setMoveToAnchor(rect),
    closeMoveTo: () => setMoveToAnchor(null),
    revealInDrive,
  };
}

export type FinderDialogsApi = ReturnType<typeof useFinderDialogs>;
