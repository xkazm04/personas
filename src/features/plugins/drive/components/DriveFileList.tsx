import { useCallback, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Folder,
  File,
  FileText,
  FileCode,
  Image as ImageIcon,
  Music,
  Video,
  Archive,
  Braces,
  Table,
  FileType,
} from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { driveFormatBytes } from "@/api/drive";
import type { UseDriveResult, SortKey } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";

interface Props {
  drive: UseDriveResult;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, clientX: number, clientY: number) => void;
  onRenameRequest: (entry: DriveEntry) => void;
}

export function DriveFileList({
  drive,
  onOpen,
  onContextMenu,
  onRenameRequest,
}: Props) {
  if (drive.viewMode === "icons") {
    return (
      <IconsView
        drive={drive}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
        onRenameRequest={onRenameRequest}
      />
    );
  }
  if (drive.viewMode === "columns") {
    return (
      <ColumnsView
        drive={drive}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
      />
    );
  }
  return (
    <ListView
      drive={drive}
      onOpen={onOpen}
      onContextMenu={onContextMenu}
      onRenameRequest={onRenameRequest}
    />
  );
}

// ============================================================================
// Shared helpers
// ============================================================================

function pickIcon(entry: DriveEntry): typeof File {
  if (entry.kind === "folder") return Folder;
  const mime = entry.mime ?? "";
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("audio/")) return Music;
  if (mime.startsWith("video/")) return Video;
  if (mime.includes("json") || mime.includes("yaml") || mime.includes("toml"))
    return Braces;
  if (mime.includes("csv") || mime.includes("tab-separated")) return Table;
  if (mime.includes("typescript") || mime.includes("javascript"))
    return FileCode;
  if (mime.startsWith("text/")) return FileText;
  if (mime.includes("pdf")) return FileType;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("gzip"))
    return Archive;
  return File;
}

function iconColorFor(entry: DriveEntry): string {
  if (entry.kind === "folder") return "text-sky-400";
  const mime = entry.mime ?? "";
  if (mime.startsWith("image/")) return "text-emerald-400";
  if (mime.startsWith("audio/")) return "text-pink-400";
  if (mime.startsWith("video/")) return "text-rose-400";
  if (mime.includes("pdf")) return "text-red-400";
  if (mime.includes("json") || mime.includes("yaml") || mime.includes("toml"))
    return "text-amber-400";
  if (mime.includes("typescript") || mime.includes("javascript"))
    return "text-violet-400";
  if (mime.includes("csv")) return "text-teal-400";
  return "text-foreground/60";
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function rowBaseClass(
  isSelected: boolean,
  isFlash: boolean,
  isDropTarget: boolean,
): string {
  const base = "transition-colors cursor-default";
  if (isDropTarget) return `${base} bg-sky-500/20 ring-1 ring-sky-500/40`;
  if (isFlash) return `${base} bg-emerald-500/20 animate-pulse`;
  if (isSelected) return `${base} bg-sky-500/15 text-sky-100`;
  return `${base} hover:bg-secondary/40`;
}

// ============================================================================
// List View (Finder column-style table)
// ============================================================================

function ListView({
  drive,
  onOpen,
  onContextMenu,
  onRenameRequest,
}: Props) {
  const { t } = useTranslation();
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const SortHeader = ({
    column,
    label,
    className = "",
  }: {
    column: SortKey;
    label: string;
    className?: string;
  }) => {
    const active = drive.sortKey === column;
    const Arrow = drive.sortDir === "asc" ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => drive.setSort(column)}
        className={`flex items-center gap-1 py-1.5 typo-caption font-semibold text-foreground/60 hover:text-foreground ${className}`}
      >
        {label}
        {active && <Arrow className="w-3 h-3" />}
      </button>
    );
  };

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, entry: DriveEntry) => {
      if (!drive.isSelected(entry.path)) drive.selectOnly(entry.path);
      const payload = JSON.stringify({
        paths:
          drive.selection.size > 0 && drive.selection.has(entry.path)
            ? Array.from(drive.selection)
            : [entry.path],
      });
      e.dataTransfer.setData("application/x-drive-move", payload);
      e.dataTransfer.effectAllowed = "move";
    },
    [drive],
  );

  const handleDropOn = useCallback(
    async (e: React.DragEvent, target: DriveEntry) => {
      e.preventDefault();
      setDragTarget(null);
      if (target.kind !== "folder") return;
      const raw = e.dataTransfer.getData("application/x-drive-move");
      if (!raw) return;
      try {
        const { paths } = JSON.parse(raw) as { paths: string[] };
        for (const p of paths) {
          if (p === target.path) continue;
          const name = p.split("/").pop() ?? p;
          const dst = target.path ? `${target.path}/${name}` : name;
          await drive.move(p, dst);
        }
      } catch {
        /* ignore bad payload */
      }
    },
    [drive],
  );

  if (drive.loading && drive.entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center typo-caption text-foreground/50">
        {t.plugins.drive.loading}
      </div>
    );
  }

  if (drive.error) {
    return (
      <div className="flex-1 flex items-center justify-center typo-caption text-rose-400">
        {t.plugins.drive.error_prefix} {drive.error}
      </div>
    );
  }

  if (drive.visibleEntries.length === 0) {
    return <DriveEmptyState drive={drive} />;
  }

  return (
    <div
      className="flex-1 overflow-auto"
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(null, e.clientX, e.clientY);
      }}
    >
      <div className="min-w-[720px]">
        {/* Header */}
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_100px_120px_180px] gap-3 px-3 border-b border-primary/10 bg-background/90 backdrop-blur">
          <SortHeader column="name" label={t.plugins.drive.col_name} />
          <SortHeader column="size" label={t.plugins.drive.col_size} />
          <SortHeader column="kind" label={t.plugins.drive.col_kind} />
          <SortHeader column="modified" label={t.plugins.drive.col_modified} />
        </div>
        {/* Rows */}
        {drive.visibleEntries.map((entry) => {
          const Icon = pickIcon(entry);
          const selected = drive.isSelected(entry.path);
          const flash = drive.recentlyWritten.has(entry.path);
          const drop = dragTarget === entry.path;
          return (
            <div
              key={entry.path}
              draggable
              onDragStart={(e) => handleDragStart(e, entry)}
              onDragOver={(e) => {
                if (entry.kind === "folder") {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragTarget(entry.path);
                }
              }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(e) => handleDropOn(e, entry)}
              onClick={(e) => {
                if (e.shiftKey) drive.selectRange(entry.path);
                else if (e.ctrlKey || e.metaKey)
                  drive.toggleSelect(entry.path, true);
                else drive.selectOnly(entry.path);
              }}
              onDoubleClick={() => onOpen(entry)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!selected) drive.selectOnly(entry.path);
                onContextMenu(entry, e.clientX, e.clientY);
              }}
              className={`grid grid-cols-[1fr_100px_120px_180px] gap-3 px-3 py-1.5 border-b border-primary/5 ${rowBaseClass(
                selected,
                flash,
                drop,
              )}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon
                  className={`w-4 h-4 flex-shrink-0 ${iconColorFor(entry)}`}
                />
                <EditableName
                  entry={entry}
                  onCommit={(newName) => drive.rename(entry.path, newName)}
                  onRequestEdit={() => onRenameRequest(entry)}
                />
              </div>
              <div className="typo-caption text-foreground/60 self-center">
                {entry.kind === "folder" ? "—" : driveFormatBytes(entry.size)}
              </div>
              <div className="typo-caption text-foreground/60 self-center truncate">
                {entry.kind === "folder"
                  ? t.plugins.drive.folder_kind
                  : (entry.extension?.toUpperCase() ?? "File")}
              </div>
              <div className="typo-caption text-foreground/60 self-center">
                {formatDate(entry.modified)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Icons View (grid)
// ============================================================================

function IconsView({
  drive,
  onOpen,
  onContextMenu,
  onRenameRequest: _onRename,
}: Props) {
  if (drive.visibleEntries.length === 0) {
    return <DriveEmptyState drive={drive} />;
  }
  return (
    <div
      className="flex-1 overflow-auto p-4"
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(null, e.clientX, e.clientY);
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
        {drive.visibleEntries.map((entry) => {
          const Icon = pickIcon(entry);
          const selected = drive.isSelected(entry.path);
          const flash = drive.recentlyWritten.has(entry.path);
          return (
            <button
              key={entry.path}
              type="button"
              onClick={(e) => {
                if (e.shiftKey) drive.selectRange(entry.path);
                else if (e.ctrlKey || e.metaKey)
                  drive.toggleSelect(entry.path, true);
                else drive.selectOnly(entry.path);
              }}
              onDoubleClick={() => onOpen(entry)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!selected) drive.selectOnly(entry.path);
                onContextMenu(entry, e.clientX, e.clientY);
              }}
              className={`group flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
                selected
                  ? "bg-sky-500/15 border-sky-500/40"
                  : flash
                  ? "bg-emerald-500/15 border-emerald-500/30 animate-pulse"
                  : "border-transparent hover:bg-secondary/40 hover:border-primary/15"
              }`}
            >
              <Icon
                className={`w-10 h-10 ${iconColorFor(entry)} group-hover:scale-110 transition-transform`}
              />
              <div className="w-full typo-caption text-center text-foreground/80 truncate">
                {entry.name}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Columns View (Miller columns, one pane per folder depth)
// ============================================================================

function ColumnsView({
  drive,
  onOpen,
  onContextMenu,
}: Omit<Props, "onRenameRequest">) {
  // Build the chain of folder levels up to the current path.
  const segments = drive.currentPath
    ? drive.currentPath.split("/").filter(Boolean)
    : [];
  const levels: string[] = [""];
  for (let i = 0; i < segments.length; i++) {
    levels.push(segments.slice(0, i + 1).join("/"));
  }

  return (
    <div className="flex-1 flex overflow-x-auto">
      {levels.map((levelPath, idx) => (
        <ColumnPane
          key={levelPath + idx}
          drive={drive}
          levelPath={levelPath}
          activeChild={levels[idx + 1] ?? null}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

interface ColumnPaneProps {
  drive: UseDriveResult;
  levelPath: string;
  activeChild: string | null;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, x: number, y: number) => void;
}

function ColumnPane({
  drive,
  levelPath,
  activeChild,
  onOpen,
  onContextMenu,
}: ColumnPaneProps) {
  // Only the current level has fresh entries — parent levels need their own
  // fetch. To keep things simple we re-use drive.entries when levelPath
  // matches drive.currentPath, otherwise render an on-mount fetched list.
  const isCurrent = levelPath === drive.currentPath;

  return (
    <div className="w-64 flex-shrink-0 border-r border-primary/10 overflow-y-auto">
      {isCurrent ? (
        <ColumnEntries
          entries={drive.visibleEntries}
          drive={drive}
          activeChild={activeChild}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      ) : (
        <AsyncColumnEntries
          path={levelPath}
          activeChild={activeChild}
          drive={drive}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      )}
    </div>
  );
}

function ColumnEntries({
  entries,
  drive,
  activeChild,
  onOpen,
  onContextMenu,
}: {
  entries: DriveEntry[];
  drive: UseDriveResult;
  activeChild: string | null;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, x: number, y: number) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const Icon = pickIcon(entry);
        const isActive = entry.path === activeChild;
        const selected = drive.isSelected(entry.path);
        return (
          <button
            key={entry.path}
            type="button"
            onClick={() => {
              if (entry.kind === "folder") drive.navigate(entry.path);
              else drive.selectOnly(entry.path);
            }}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!selected) drive.selectOnly(entry.path);
              onContextMenu(entry, e.clientX, e.clientY);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-left ${
              isActive
                ? "bg-sky-500/20 text-sky-100"
                : selected
                ? "bg-sky-500/10 text-foreground"
                : "hover:bg-secondary/40 text-foreground/80"
            }`}
          >
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconColorFor(entry)}`} />
            <span className="truncate flex-1">{entry.name}</span>
            {entry.kind === "folder" && (
              <span className="text-foreground/40">›</span>
            )}
          </button>
        );
      })}
      {entries.length === 0 && (
        <div className="px-3 py-4 typo-caption-sm text-foreground/40 italic">
          —
        </div>
      )}
    </>
  );
}

// Lazy fetch for parent levels (not currently in drive state).
function AsyncColumnEntries(props: {
  path: string;
  activeChild: string | null;
  drive: UseDriveResult;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, x: number, y: number) => void;
}) {
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  if (!loaded) {
    import("@/api/drive")
      .then(({ driveList }) => driveList(props.path))
      .then(setEntries)
      .finally(() => setLoaded(true));
  }
  return (
    <ColumnEntries
      entries={entries}
      drive={props.drive}
      activeChild={props.activeChild}
      onOpen={props.onOpen}
      onContextMenu={props.onContextMenu}
    />
  );
}

// ============================================================================
// Empty state
// ============================================================================

function DriveEmptyState({ drive }: { drive: UseDriveResult }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <Folder className="w-14 h-14 text-foreground/20" />
      <div className="typo-body text-foreground/70">
        {t.plugins.drive.empty_folder}
      </div>
      <div className="typo-caption text-foreground/40 max-w-sm">
        {drive.currentPath === "" ? t.plugins.drive.empty_hint : ""}
      </div>
    </div>
  );
}

// ============================================================================
// Inline-editable name (used by ListView)
// ============================================================================

function EditableName({
  entry,
  onCommit,
  onRequestEdit: _onRequestEdit,
}: {
  entry: DriveEntry;
  onCommit: (newName: string) => void;
  onRequestEdit: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(entry.name);

  if (!editing) {
    return (
      <span
        className="typo-body text-foreground/90 truncate"
        onDoubleClick={(e) => {
          // Double-click on the name (not the icon) goes to rename mode,
          // but single double-click still opens the file — so only if we
          // already have the entry selected.
          e.stopPropagation();
        }}
      >
        {entry.name}
      </span>
    );
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value && value !== entry.name) onCommit(value);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setValue(entry.name);
          setEditing(false);
        }
      }}
      className="typo-body bg-background border border-sky-500/40 rounded px-1 py-0 focus:outline-none"
    />
  );
}
