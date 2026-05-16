import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, HardDrive, Scissors, Trash2, Upload, X } from "lucide-react";

import { ContentBox, ContentHeader } from "@/features/shared/components/layout/ContentLayout";
import { useTranslation } from "@/i18n/useTranslation";
import {
  driveOpenInOs,
  driveRevealInOs,
  driveParentPath,
  driveWrite,
  type DriveEntry,
} from "@/api/drive";
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useToastStore } from "@/stores/toastStore";

import {
  kindBucketWeight,
  kindGroupLabel,
  visualForEntry,
} from "./designTokens";
import { useDrive } from "./hooks/useDrive";
import { DriveToolbar } from "./components/DriveToolbar";
import { DriveSidebar } from "./components/DriveSidebar";
import { DriveFileList } from "./components/DriveFileList";
import { DriveDetailsPane } from "./components/DriveDetailsPane";
import {
  DriveContextMenu,
  type ContextMenuState,
} from "./components/DriveContextMenu";
import { DriveImageLightbox } from "./components/DriveImageLightbox";
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

// Hard limit on a single drag-drop file. Mirrors MAX_WRITE_BYTES on the
// Rust side — files larger than this are rejected with a toast rather
// than failing on IPC after a long FileReader round-trip.
const EXTERNAL_DROP_MAX_BYTES = 50 * 1024 * 1024;

export default function DrivePage() {
  const { t, tx } = useTranslation();
  const drive = useDrive();
  const signing = useSigning();
  const ocr = useOcr();
  const addToast = useToastStore((s) => s.addToast);

  // OS→Drive drag-drop state. dragCounter handles dragenter/leave on nested
  // children — the events fire per-element, so a naive boolean would flicker
  // when the cursor crosses a child boundary.
  const [externalDragActive, setExternalDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pathEditing, setPathEditing] = useState(false);
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  // Path currently being inline-renamed inside the list view. Null when no
  // rename in flight. Icons / columns views fall back to the modal prompt.
  const [inlineRenamingPath, setInlineRenamingPath] = useState<string | null>(null);
  // Inline create — when set, the list view renders a phantom row at the
  // top with an empty inline input. Icons / columns fall back to modal.
  const [pendingCreate, setPendingCreate] = useState<"folder" | "file" | null>(null);

  const requestRename = useCallback(
    (entry: DriveEntry) => {
      if (drive.viewMode === "list") {
        setInlineRenamingPath(entry.path);
      } else {
        setDialog({ kind: "rename", entry });
      }
    },
    [drive.viewMode],
  );

  const requestNewFolder = useCallback(() => {
    if (drive.viewMode === "list") setPendingCreate("folder");
    else setDialog({ kind: "new_folder" });
  }, [drive.viewMode]);

  const requestNewFile = useCallback(() => {
    if (drive.viewMode === "list") setPendingCreate("file");
    else setDialog({ kind: "new_file" });
  }, [drive.viewMode]);

  const commitPendingCreate = useCallback(
    async (name: string) => {
      const kind = pendingCreate;
      setPendingCreate(null);
      const trimmed = name.trim();
      if (!trimmed || !kind) return;
      if (kind === "folder") await drive.createFolder(trimmed);
      else await drive.createFile(trimmed);
    },
    [pendingCreate, drive],
  );

  const cancelPendingCreate = useCallback(() => {
    setPendingCreate(null);
  }, []);

  const commitInlineRename = useCallback(
    async (path: string, newName: string) => {
      setInlineRenamingPath(null);
      const trimmed = newName.trim();
      if (!trimmed) return;
      const current = drive.visibleEntries.find((e) => e.path === path);
      if (current && current.name === trimmed) return; // no-op
      await drive.rename(path, trimmed);
    },
    [drive],
  );

  const cancelInlineRename = useCallback(() => {
    setInlineRenamingPath(null);
  }, []);
  const [signEntry, setSignEntry] = useState<DriveEntry | null>(null);
  const [verifyEntry, setVerifyEntry] = useState<DriveEntry | null>(null);
  const [ocrEntry, setOcrEntry] = useState<DriveEntry | null>(null);
  const [signaturesOpen, setSignaturesOpen] = useState(false);

  // Path queued by "Reveal in Drive" — selected once the destination folder's
  // entries have actually loaded. Replaces the previous `setTimeout(..., 100)`
  // race that broke on slow disks / large folders.
  const pendingSelectRef = useRef<string | null>(null);

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
  //
  // `drive` is a fresh object literal every render (it's the return of
  // useDrive()) and `handleOpen` is recreated whenever drive changes — so
  // listing them in the effect's dep array would re-attach the document
  // listener on every render. Instead, route both through refs that we
  // update each render, and attach the listener once on mount.
  // ---------------------------------------------------------------------
  const driveRef = useRef(drive);
  driveRef.current = drive;
  const handleOpenRef = useRef(handleOpen);
  handleOpenRef.current = handleOpen;

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

      const drv = driveRef.current;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        drv.selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setPathEditing(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        drv.copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        drv.cutSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        drv.pasteHere();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (drv.selection.size > 0) {
          e.preventDefault();
          setDialog({ kind: "delete", paths: Array.from(drv.selection) });
        }
        return;
      }
      if (e.key === "F2") {
        const first = Array.from(drv.selection)[0];
        const entry = drv.visibleEntries.find((ent) => ent.path === first);
        if (entry) {
          e.preventDefault();
          // Inline in list view, modal fallback elsewhere.
          if (drv.viewMode === "list") setInlineRenamingPath(entry.path);
          else setDialog({ kind: "rename", entry });
        }
        return;
      }
      if (e.key === "Enter") {
        const first = Array.from(drv.selection)[0];
        const entry = drv.visibleEntries.find((ent) => ent.path === first);
        if (entry) {
          e.preventDefault();
          handleOpenRef.current(entry);
        }
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (drv.visibleEntries.length === 0) return;
        e.preventDefault();
        const current = Array.from(drv.selection)[0];
        const idx = drv.visibleEntries.findIndex((ent) => ent.path === current);
        const next =
          e.key === "ArrowDown"
            ? Math.min(drv.visibleEntries.length - 1, idx + 1)
            : Math.max(0, idx - 1);
        const target = drv.visibleEntries[next >= 0 ? next : 0];
        if (target) drv.selectOnly(target.path);
      }
      if (e.key === "ArrowLeft" && !mod) {
        drv.goUp();
      }
      if (e.key === "Escape") {
        drv.clearSelection();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // ---------------------------------------------------------------------
  // Drain pendingSelectRef once the target file actually appears in
  // visibleEntries. This runs after refresh(currentPath) resolves AND after
  // the navigation effect that clears selection — so the selectOnly call
  // here always wins, regardless of IPC latency.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (!pending) return;
    if (drive.visibleEntries.some((e) => e.path === pending)) {
      drive.selectOnly(pending);
      pendingSelectRef.current = null;
    }
  }, [drive]);

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
      } catch (err) {
        silentCatch("drive:copy-path")(err);
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
  // OS → Drive drag-drop
  // ---------------------------------------------------------------------
  const hasFilesPayload = (e: React.DragEvent) =>
    e.dataTransfer?.types?.includes("Files") ?? false;

  const handleExternalDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFilesPayload(e)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setExternalDragActive(true);
  }, []);

  const handleExternalDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFilesPayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleExternalDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFilesPayload(e)) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setExternalDragActive(false);
  }, []);

  const handleExternalDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!hasFilesPayload(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setExternalDragActive(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      let success = 0;
      const tooLarge: string[] = [];
      const failed: string[] = [];
      for (const file of files) {
        if (file.size > EXTERNAL_DROP_MAX_BYTES) {
          tooLarge.push(file.name);
          continue;
        }
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          const rel = drive.currentPath
            ? `${drive.currentPath}/${file.name}`
            : file.name;
          await driveWrite(rel, buf);
          success += 1;
        } catch (err) {
          failed.push(file.name);
          silentCatch("drive:external-drop")(err);
        }
      }
      drive.refresh();
      drive.refreshStorage();

      if (success > 0) {
        addToast(tx(t.plugins.drive.drop_added_n, { count: success }), "success");
      }
      if (tooLarge.length > 0) {
        addToast(
          tx(t.plugins.drive.drop_too_large_n, { count: tooLarge.length }),
          "error",
        );
      }
      if (failed.length > 0) {
        addToast(
          tx(t.plugins.drive.drop_failed_n, { count: failed.length }),
          "error",
        );
      }
    },
    [drive, addToast, t, tx],
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  const selectionCount = drive.selection.size;
  const hasSelection = selectionCount > 0;
  const requestDeleteSelection = useCallback(() => {
    if (drive.selection.size === 0) return;
    setDialog({ kind: "delete", paths: Array.from(drive.selection) });
  }, [drive.selection]);

  const handleMoveSelection = useCallback(
    async (dst: string) => {
      const paths = Array.from(drive.selection);
      for (const p of paths) {
        if (p === dst) continue;
        // Refuse moving an ancestor folder into its own descendant — would
        // orphan the subtree. Same guard the sidebar drop applies.
        if (dst !== "" && dst.startsWith(`${p}/`)) continue;
        const name = p.split("/").pop() ?? p;
        const finalDst = dst ? `${dst}/${name}` : name;
        await drive.move(p, finalDst);
      }
    },
    [drive],
  );

  const handleSignSelection = useCallback(() => {
    if (drive.selection.size !== 1) return;
    const path = Array.from(drive.selection)[0];
    const entry = drive.visibleEntries.find((e) => e.path === path);
    if (entry && entry.kind === "file") setSignEntry(entry);
  }, [drive.selection, drive.visibleEntries]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<HardDrive className="w-5 h-5 text-cyan-300" />}
        iconColor="cyan"
        title={t.plugins.drive.title}
        subtitle={t.plugins.drive.subtitle}
        actions={
          hasSelection ? (
            <div className="flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-cyan-500/15 border border-cyan-500/35 shadow-[0_0_14px_-6px_rgba(34,211,238,0.55)]">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
              <span className="typo-body text-cyan-100 font-medium tabular-nums">
                {tx(t.plugins.drive.items_selected, { count: selectionCount })}
              </span>
              <span aria-hidden className="mx-1 w-px h-3.5 bg-cyan-400/30" />
              <BulkChip
                icon={Copy}
                label={t.plugins.drive.bulk_copy}
                onClick={drive.copySelection}
              />
              <BulkChip
                icon={Scissors}
                label={t.plugins.drive.bulk_cut}
                onClick={drive.cutSelection}
              />
              <BulkChip
                icon={Trash2}
                label={t.plugins.drive.bulk_delete}
                onClick={requestDeleteSelection}
                tone="danger"
              />
              <BulkChip
                icon={X}
                label={t.plugins.drive.bulk_clear_selection}
                onClick={drive.clearSelection}
                tone="ghost"
                iconOnly
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
              <span className="typo-body text-cyan-100 font-medium tabular-nums">
                {tx(t.plugins.drive.items_total, {
                  count: drive.visibleEntries.length,
                })}
              </span>
            </div>
          )
        }
      />
      <div
        className="relative flex-1 min-h-0 flex flex-col bg-gradient-to-b from-background via-background to-background/95"
        onDragEnter={handleExternalDragEnter}
        onDragOver={handleExternalDragOver}
        onDragLeave={handleExternalDragLeave}
        onDrop={handleExternalDrop}
      >
        <DriveToolbar
          drive={drive}
          onNewFolder={requestNewFolder}
          onNewFile={requestNewFile}
          onOpenSignatures={() => setSignaturesOpen(true)}
          onMoveSelection={handleMoveSelection}
          onSignSelection={handleSignSelection}
          pathEditing={pathEditing}
          onPathEditingChange={setPathEditing}
        />
        <div className="flex-1 min-h-0 flex">
          <DriveSidebar drive={drive} />
          <div className="flex-1 min-w-0 flex flex-col">
            <DriveFileList
              drive={drive}
              onOpen={handleOpen}
              onContextMenu={openContextMenu}
              onRenameRequest={requestRename}
              onNewFolder={requestNewFolder}
              inlineRenamingPath={inlineRenamingPath}
              onCommitInlineRename={commitInlineRename}
              onCancelInlineRename={cancelInlineRename}
              pendingCreate={pendingCreate}
              onCommitPendingCreate={commitPendingCreate}
              onCancelPendingCreate={cancelPendingCreate}
            />
          </div>
          <DriveDetailsPane
            entries={selectedEntries}
            currentPath={drive.currentPath}
            onPreviewClick={(entry) => setLightboxPath(entry.path)}
          />
        </div>

        {externalDragActive && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-cyan-500/15 backdrop-blur-sm border-4 border-dashed border-cyan-400/60 rounded-card"
          >
            <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-modal bg-background/85 border border-cyan-500/40 shadow-elevation-3">
              <Upload className="w-8 h-8 text-cyan-200" />
              <div className="typo-section-title text-cyan-100">
                {t.plugins.drive.drop_overlay_title}
              </div>
              <div className="typo-body text-foreground">
                {tx(t.plugins.drive.drop_overlay_subtitle, {
                  path: drive.currentPath || "/",
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {contextMenu && (
        <DriveContextMenu
          state={contextMenu}
          drive={drive}
          onClose={() => setContextMenu(null)}
          onOpen={handleOpen}
          onNewFolder={requestNewFolder}
          onNewFile={requestNewFile}
          onRename={requestRename}
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
            // Queue the select; the useEffect above commits it once the
            // entry actually appears in visibleEntries.
            pendingSelectRef.current = drivePath;
            drive.navigate(driveParentPath(drivePath));
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
      {lightboxPath && (() => {
        // Navigable list of previewable entries in the current folder —
        // images, videos, and PDFs all share the lightbox now. Sorted by
        // name so prev/next is a stable visual sequence regardless of the
        // live sort key.
        const previewableEntries = drive.visibleEntries
          .filter(
            (e) =>
              e.kind === "file" &&
              (e.mime?.startsWith("image/") ||
                e.mime?.startsWith("video/") ||
                e.mime === "application/pdf"),
          )
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
        if (previewableEntries.length === 0) return null;
        return (
          <DriveImageLightbox
            entries={previewableEntries}
            initialPath={lightboxPath}
            onClose={() => setLightboxPath(null)}
          />
        );
      })()}

      {dialog?.kind === "delete" && (
        <DriveConfirm
          title={tx(t.plugins.drive.delete_confirm_title, {
            count: dialog.paths.length,
          })}
          body={
            <div className="space-y-3">
              <DeleteBreakdown paths={dialog.paths} entries={drive.entries} t={t} />
              <div>{t.plugins.drive.delete_confirm_body}</div>
            </div>
          }
          danger
          onConfirm={() => confirmDialog()}
          onCancel={() => setDialog(null)}
        />
      )}
    </ContentBox>
  );
}

function DeleteBreakdown({
  paths,
  entries,
  t,
}: {
  paths: string[];
  entries: DriveEntry[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  // Build a per-bucket count from the entries the user actually selected.
  // Paths the user picked are by definition in the current folder's entry
  // list, so this is a straight lookup.
  const byPath = new Map(entries.map((e) => [e.path, e] as const));
  const counts = new Map<string, number>();
  for (const p of paths) {
    const entry = byPath.get(p);
    if (!entry) continue;
    const key = visualForEntry(entry).labelKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets = Array.from(counts.entries()).sort(
    ([a], [b]) =>
      kindBucketWeight(a as Parameters<typeof kindBucketWeight>[0]) -
      kindBucketWeight(b as Parameters<typeof kindBucketWeight>[0]),
  );
  if (buckets.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {buckets.map(([key, count]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 typo-caption text-rose-100"
        >
          <span className="font-semibold tabular-nums">{count}</span>
          <span className="text-rose-100/80">
            {kindGroupLabel(t, key as Parameters<typeof kindGroupLabel>[1])}
          </span>
        </span>
      ))}
    </div>
  );
}

function BulkChip({
  icon: Icon,
  label,
  onClick,
  tone = "default",
  iconOnly = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger" | "ghost";
  iconOnly?: boolean;
}) {
  const styles =
    tone === "danger"
      ? "text-rose-100 hover:bg-rose-500/25 hover:text-rose-50"
      : tone === "ghost"
        ? "text-cyan-200/70 hover:bg-cyan-500/15 hover:text-cyan-50"
        : "text-cyan-100 hover:bg-cyan-500/25 hover:text-cyan-50";
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full typo-body font-medium transition-colors ${styles}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}
