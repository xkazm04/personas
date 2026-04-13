import { useCallback, useEffect, useState } from "react";
import { HardDrive } from "lucide-react";

import { ContentBox, ContentHeader } from "@/features/shared/components/layout/ContentLayout";
import { useTranslation } from "@/i18n/useTranslation";
import {
  driveOpenInOs,
  driveRevealInOs,
  driveParentPath,
  type DriveEntry,
} from "@/api/drive";
import { toastCatch } from "@/lib/silentCatch";

import { useDrive } from "./hooks/useDrive";
import { DriveToolbar } from "./components/DriveToolbar";
import { DriveSidebar } from "./components/DriveSidebar";
import { DriveFileList } from "./components/DriveFileList";
import { DriveDetailsPane } from "./components/DriveDetailsPane";
import {
  DriveContextMenu,
  type ContextMenuState,
} from "./components/DriveContextMenu";
import { DriveTextPrompt, DriveConfirm } from "./components/DrivePrompt";
import { useSigning } from "./signing/useSigning";
import { DriveSignDialog } from "./signing/DriveSignDialog";
import { DriveVerifyDialog } from "./signing/DriveVerifyDialog";
import { DriveSignaturesPanel } from "./signing/DriveSignaturesPanel";
import { useOcr } from "./ocr/useOcr";
import { DriveOcrDrawer } from "./ocr/DriveOcrDrawer";

type Dialog =
  | { kind: "new_folder" }
  | { kind: "new_file" }
  | { kind: "rename"; entry: DriveEntry }
  | { kind: "delete"; paths: string[] }
  | null;

export default function DrivePage() {
  const { t, tx } = useTranslation();
  const drive = useDrive();
  const signing = useSigning();
  const ocr = useOcr();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [signEntry, setSignEntry] = useState<DriveEntry | null>(null);
  const [verifyEntry, setVerifyEntry] = useState<DriveEntry | null>(null);
  const [ocrEntry, setOcrEntry] = useState<DriveEntry | null>(null);
  const [signaturesOpen, setSignaturesOpen] = useState(false);

  // Selected entries are the subset of visibleEntries whose path is in the
  // selection set. We pass these into the details pane.
  const selectedEntries = drive.visibleEntries.filter((e) =>
    drive.selection.has(e.path),
  );

  // ---------------------------------------------------------------------
  // Entry open handler — folders navigate, files open in OS.
  // ---------------------------------------------------------------------
  const handleOpen = useCallback(
    (entry: DriveEntry) => {
      if (entry.kind === "folder") {
        drive.navigate(entry.path);
      } else {
        driveOpenInOs(entry.path).catch(toastCatch("drive:open"));
      }
    },
    [drive],
  );

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing inside an input/textarea.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        drive.selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        drive.copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        drive.cutSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        drive.pasteHere();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (drive.selection.size > 0) {
          e.preventDefault();
          setDialog({ kind: "delete", paths: Array.from(drive.selection) });
        }
        return;
      }
      if (e.key === "F2") {
        const first = Array.from(drive.selection)[0];
        const entry = drive.visibleEntries.find((ent) => ent.path === first);
        if (entry) {
          e.preventDefault();
          setDialog({ kind: "rename", entry });
        }
        return;
      }
      if (e.key === "Enter") {
        const first = Array.from(drive.selection)[0];
        const entry = drive.visibleEntries.find((ent) => ent.path === first);
        if (entry) {
          e.preventDefault();
          handleOpen(entry);
        }
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (drive.visibleEntries.length === 0) return;
        e.preventDefault();
        const current = Array.from(drive.selection)[0];
        const idx = drive.visibleEntries.findIndex((ent) => ent.path === current);
        const next =
          e.key === "ArrowDown"
            ? Math.min(drive.visibleEntries.length - 1, idx + 1)
            : Math.max(0, idx - 1);
        const target = drive.visibleEntries[next >= 0 ? next : 0];
        if (target) drive.selectOnly(target.path);
      }
      if (e.key === "ArrowLeft" && !mod) {
        drive.goUp();
      }
      if (e.key === "Escape") {
        drive.clearSelection();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [drive, handleOpen]);

  // ---------------------------------------------------------------------
  // Context menu + dialog actions
  // ---------------------------------------------------------------------
  const openContextMenu = useCallback(
    (entry: DriveEntry | null, x: number, y: number) => {
      setContextMenu({ entry, x, y });
    },
    [],
  );

  const handleCopyPath = useCallback(
    async (entry: DriveEntry) => {
      try {
        await navigator.clipboard.writeText(entry.path);
      } catch {
        /* clipboard blocked */
      }
    },
    [],
  );

  const handleReveal = useCallback((entry: DriveEntry) => {
    driveRevealInOs(entry.path).catch(toastCatch("drive:reveal"));
  }, []);

  const confirmDialog = useCallback(
    async (value?: string) => {
      if (!dialog) return;
      if (dialog.kind === "new_folder" && value) {
        await drive.createFolder(value);
      } else if (dialog.kind === "new_file" && value) {
        await drive.createFile(value);
      } else if (dialog.kind === "rename" && value) {
        await drive.rename(dialog.entry.path, value);
      } else if (dialog.kind === "delete") {
        await drive.remove(dialog.paths);
      }
      setDialog(null);
    },
    [dialog, drive],
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  const statusLine = drive.selection.size > 0
    ? tx(t.plugins.drive.items_selected, { count: drive.selection.size })
    : tx(t.plugins.drive.items_total, { count: drive.visibleEntries.length });

  return (
    <ContentBox>
      <ContentHeader
        icon={<HardDrive className="w-5 h-5 text-cyan-300" />}
        iconColor="cyan"
        title={t.plugins.drive.title}
        subtitle={t.plugins.drive.subtitle}
        actions={
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
            <span className="typo-caption text-cyan-100 font-medium tabular-nums">
              {statusLine}
            </span>
          </div>
        }
      />
      <div className="flex-1 min-h-0 flex flex-col bg-gradient-to-b from-background via-background to-background/95">
        <DriveToolbar
          drive={drive}
          onNewFolder={() => setDialog({ kind: "new_folder" })}
          onNewFile={() => setDialog({ kind: "new_file" })}
          onOpenSignatures={() => setSignaturesOpen(true)}
        />
        <div className="flex-1 min-h-0 flex">
          <DriveSidebar drive={drive} />
          <div className="flex-1 min-w-0 flex flex-col">
            <DriveFileList
              drive={drive}
              onOpen={handleOpen}
              onContextMenu={openContextMenu}
              onRenameRequest={(entry) => setDialog({ kind: "rename", entry })}
              onNewFolder={() => setDialog({ kind: "new_folder" })}
            />
          </div>
          <DriveDetailsPane
            entries={selectedEntries}
            currentPath={drive.currentPath}
          />
        </div>
      </div>

      {contextMenu && (
        <DriveContextMenu
          state={contextMenu}
          drive={drive}
          onClose={() => setContextMenu(null)}
          onOpen={handleOpen}
          onNewFolder={() => setDialog({ kind: "new_folder" })}
          onNewFile={() => setDialog({ kind: "new_file" })}
          onRename={(entry) => setDialog({ kind: "rename", entry })}
          onRequestDelete={(paths) => setDialog({ kind: "delete", paths })}
          onReveal={handleReveal}
          onCopyPath={handleCopyPath}
          onSignFile={(entry) => setSignEntry(entry)}
          onVerifyFile={(entry) => setVerifyEntry(entry)}
          onExtractText={(entry) => setOcrEntry(entry)}
          hasGemini={ocr.hasGemini}
        />
      )}

      {ocrEntry && (
        <DriveOcrDrawer
          entry={ocrEntry}
          ocr={ocr}
          onClose={() => setOcrEntry(null)}
          onFileWritten={() => {
            drive.refresh();
          }}
        />
      )}

      {signEntry && (
        <DriveSignDialog
          entry={signEntry}
          signing={signing}
          onClose={() => setSignEntry(null)}
          onSidecarWritten={() => {
            drive.refresh();
          }}
        />
      )}

      {verifyEntry && (
        <DriveVerifyDialog
          entry={verifyEntry}
          signing={signing}
          onClose={() => setVerifyEntry(null)}
        />
      )}

      {signaturesOpen && (
        <DriveSignaturesPanel
          signing={signing}
          onClose={() => setSignaturesOpen(false)}
          onRevealInDrive={(drivePath) => {
            // Navigate into the parent folder and select the file.
            const parent = driveParentPath(drivePath);
            drive.navigate(parent);
            // Defer selection until after the list refreshes.
            setTimeout(() => drive.selectOnly(drivePath), 100);
          }}
        />
      )}

      {dialog?.kind === "new_folder" && (
        <DriveTextPrompt
          title={t.plugins.drive.new_folder_title}
          placeholder={t.plugins.drive.new_folder_placeholder}
          onConfirm={(v) => confirmDialog(v)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "new_file" && (
        <DriveTextPrompt
          title={t.plugins.drive.new_file_title}
          placeholder={t.plugins.drive.new_file_placeholder}
          onConfirm={(v) => confirmDialog(v)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <DriveTextPrompt
          title={t.plugins.drive.rename_title}
          placeholder={t.plugins.drive.rename_placeholder}
          initialValue={dialog.entry.name}
          onConfirm={(v) => confirmDialog(v)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <DriveConfirm
          title={tx(t.plugins.drive.delete_confirm_title, {
            count: dialog.paths.length,
          })}
          body={t.plugins.drive.delete_confirm_body}
          danger
          onConfirm={() => confirmDialog()}
          onCancel={() => setDialog(null)}
        />
      )}
    </ContentBox>
  );
}
