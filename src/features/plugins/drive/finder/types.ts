import type { DriveEntry, DriveMeta, DriveTag } from "@/api/drive";
import type { useDrive } from "../hooks/useDrive";

// ---------------------------------------------------------------------------
// Finder contract — the ONE file the shell (FinderPage), the views, the
// Quick Look and the Inspector all build against. Wire-level names here are
// final; packages that build in parallel must not widen them without the
// Director (drive-finder spark, 2026-09-17).
// ---------------------------------------------------------------------------

export type DriveApi = ReturnType<typeof useDrive>;

export type FinderViewMode = "list" | "icons" | "columns" | "gallery";

/** Persisted as `drive.finder.prefs` (safeLocalStorage), restored by identity. */
export interface FinderPrefs {
  sidebarW: number;
  inspectorW: number;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  viewMode: FinderViewMode;
}

export const FINDER_PREFS_KEY = "drive.finder.prefs";
export const FINDER_PREFS_DEFAULT: FinderPrefs = {
  sidebarW: 232,
  inspectorW: 300,
  sidebarOpen: true,
  inspectorOpen: false,
  viewMode: "list",
};

/** Internal move payload MIME — unchanged from the classic renderer. */
export const DRIVE_MOVE_MIME = "application/x-drive-move";

/** Tag index as the UI consumes it (owned by `useDriveMeta`). */
export interface DriveMetaApi {
  meta: DriveMeta | null;
  loading: boolean;
  /** Resolved tags for an entry path, vocab order. */
  tagsFor: (relPath: string) => DriveTag[];
  setTags: (relPath: string, tagIds: string[]) => Promise<void>;
  toggleTag: (relPath: string, tagId: string) => Promise<void>;
  upsertTag: (tag: DriveTag) => Promise<void>;
  deleteTag: (tagId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** What a view receives from the shell. Every view renders `drive.visibleEntries`. */
export interface FinderViewProps {
  drive: DriveApi;
  meta: DriveMetaApi;
  signedPaths: Set<string>;
  /** Folder → navigate; file → open in the OS. */
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, x: number, y: number) => void;
  /** Space / preview affordance. */
  onQuickLook: () => void;
  inlineRenamingPath: string | null;
  onCommitInlineRename: (path: string, newName: string) => void;
  onCancelInlineRename: () => void;
  pendingCreate: "folder" | "file" | null;
  onCommitPendingCreate: (name: string) => void;
  onCancelPendingCreate: () => void;
  /** Internal drag in flight (count of dragged entries), null when idle. */
  activeDragCount: number | null;
  onDragSelectionStart: (count: number) => void;
  onDragSelectionEnd: () => void;
  /** Folder currently hovered during an OS-file drag, null = open folder. */
  externalDropPath: string | null;
  onExternalFolderDragOver: (path: string | null) => void;
  /** Alt-drag: hand the selection to the native OS drag. */
  onNativeDragOut: (paths: string[]) => void;
}

export interface QuickLookProps {
  /** Previewable entries in the current folder, in visual order. */
  entries: DriveEntry[];
  initialPath: string;
  onClose: () => void;
  /** Keep the list selection in step while the user steps with arrows. */
  onStep?: (path: string) => void;
  onOpenInOs: (entry: DriveEntry) => void;
}

export interface InspectorProps {
  entries: DriveEntry[];
  currentPath: string;
  meta: DriveMetaApi;
  signedPaths: Set<string>;
  onQuickLook: (entry: DriveEntry) => void;
  onOpen: (entry: DriveEntry) => void;
  onReveal: (entry: DriveEntry) => void;
  onSign: (entry: DriveEntry) => void;
  onVerify: (entry: DriveEntry) => void;
  onExtractText: (entry: DriveEntry) => void;
  hasGemini: boolean;
  onKnowledge: (entry: DriveEntry) => void;
  knowledgeAvailable: boolean;
}

/** Kinds Quick Look and the Gallery can render above the kind icon. */
export function previewKind(
  entry: DriveEntry,
): "image" | "video" | "audio" | "pdf" | "text" | null {
  if (entry.kind !== "file") return null;
  const mime = entry.mime ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  return null;
}
