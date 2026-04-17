import { useCallback, useEffect, useState } from "react";
import { ChevronUp, ChevronDown, FolderOpen, Sparkles } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { driveFormatBytes, driveList } from "@/api/drive";
import type { UseDriveResult, SortKey } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";
import { visualForEntry, formatRelativeTime } from "../designTokens";

interface Props {
  drive: UseDriveResult;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, clientX: number, clientY: number) => void;
  onRenameRequest: (entry: DriveEntry) => void;
  onNewFolder: () => void;
}

export function DriveFileList({
  drive,
  onOpen,
  onContextMenu,
  onRenameRequest,
  onNewFolder,
}: Props) {
  if (drive.viewMode === "icons") {
    return (
      <IconsView
        drive={drive}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
        onRenameRequest={onRenameRequest}
        onNewFolder={onNewFolder}
      />
    );
  }
  if (drive.viewMode === "columns") {
    return (
      <ColumnsView
        drive={drive}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
        onNewFolder={onNewFolder}
      />
    );
  }
  return (
    <ListView
      drive={drive}
      onOpen={onOpen}
      onContextMenu={onContextMenu}
      onRenameRequest={onRenameRequest}
      onNewFolder={onNewFolder}
    />
  );
}

// ============================================================================
// Shared file chip
// ============================================================================

function FileChip({
  entry,
  size = 28,
  flat = false,
}: {
  entry: DriveEntry;
  size?: number;
  flat?: boolean;
}) {
  const visual = visualForEntry(entry);
  const Icon = visual.Icon;
  const iconSize = Math.round(size * 0.55);
  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 rounded-lg bg-gradient-to-br ${visual.gradient} ${
        flat ? "border-0" : "border border-primary/10"
      }`}
      style={{ width: size, height: size }}
    >
      <Icon className={visual.text} style={{ width: iconSize, height: iconSize }} />
    </div>
  );
}

function rowStateClass(
  isSelected: boolean,
  isFlash: boolean,
  isDropTarget: boolean,
  zebra: boolean,
): string {
  if (isDropTarget)
    return "bg-cyan-500/25 ring-1 ring-cyan-400/60 shadow-[inset_0_0_12px_rgba(34,211,238,0.3)]";
  if (isFlash)
    return "bg-emerald-500/15 ring-1 ring-emerald-400/50 shadow-[inset_0_0_16px_rgba(52,211,153,0.2)] transition-all duration-700";
  if (isSelected)
    return "bg-gradient-to-r from-cyan-500/15 via-cyan-500/8 to-transparent text-foreground shadow-[inset_2px_0_0_rgba(34,211,238,0.8)]";
  return zebra
    ? "bg-secondary/15 hover:bg-secondary/40 transition-colors"
    : "hover:bg-secondary/40 transition-colors";
}

// ============================================================================
// List view
// ============================================================================

function ListView({
  drive,
  onOpen,
  onContextMenu,
  onRenameRequest: _onRenameRequest,
  onNewFolder,
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
        className={`flex items-center gap-1 py-2 typo-label transition-colors ${
          active
            ? "text-cyan-300"
            : "text-foreground/90 hover:text-foreground"
        } ${className}`}
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
    return <LoadingState />;
  }
  if (drive.error) {
    return (
      <div className="flex-1 flex items-center justify-center typo-body text-rose-300">
        {t.plugins.drive.error_prefix} {drive.error}
      </div>
    );
  }
  if (drive.visibleEntries.length === 0) {
    return <DriveEmptyState drive={drive} onNewFolder={onNewFolder} />;
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
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_110px_120px_160px] gap-3 px-4 border-b border-primary/10 bg-background/95 backdrop-blur">
          <SortHeader column="name" label={t.plugins.drive.col_name} />
          <SortHeader column="size" label={t.plugins.drive.col_size} />
          <SortHeader column="kind" label={t.plugins.drive.col_kind} />
          <SortHeader column="modified" label={t.plugins.drive.col_modified} />
        </div>
        {/* Rows */}
        {drive.visibleEntries.map((entry, idx) => {
          const selected = drive.isSelected(entry.path);
          const flash = drive.recentlyWritten.has(entry.path);
          const drop = dragTarget === entry.path;
          const zebra = idx % 2 === 1;
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
              className={`grid grid-cols-[1fr_110px_120px_160px] gap-3 px-4 py-2 border-b border-primary/5 cursor-default ${rowStateClass(
                selected,
                flash,
                drop,
                zebra,
              )}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileChip entry={entry} size={32} />
                <span className="typo-body typo-card-label truncate">
                  {entry.name}
                </span>
              </div>
              <div className="typo-body text-foreground/90 self-center tabular-nums">
                {entry.kind === "folder" ? "—" : driveFormatBytes(entry.size)}
              </div>
              <div className="typo-body text-foreground/90 self-center truncate">
                {entry.kind === "folder"
                  ? t.plugins.drive.folder_kind
                  : visualForEntry(entry).label}
              </div>
              <div className="typo-body text-foreground/90 self-center tabular-nums">
                {formatRelativeTime(entry.modified)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Icons view
// ============================================================================

function IconsView({
  drive,
  onOpen,
  onContextMenu,
  onNewFolder,
}: Props) {
  if (drive.loading && drive.entries.length === 0) {
    return <LoadingState />;
  }
  if (drive.visibleEntries.length === 0) {
    return <DriveEmptyState drive={drive} onNewFolder={onNewFolder} />;
  }
  return (
    <div
      className="flex-1 overflow-auto p-5"
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(null, e.clientX, e.clientY);
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
        {drive.visibleEntries.map((entry) => {
          const selected = drive.isSelected(entry.path);
          const flash = drive.recentlyWritten.has(entry.path);
          const visual = visualForEntry(entry);
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
              className={`group flex flex-col items-center gap-2.5 p-3 rounded-xl border transition-all ${
                selected
                  ? `bg-cyan-500/10 border-cyan-500/50 ring-2 ${visual.ring} shadow-[0_0_20px_-8px_rgba(34,211,238,0.6)]`
                  : flash
                  ? "bg-emerald-500/10 border-emerald-500/50 ring-2 ring-emerald-400/40"
                  : "border-primary/5 bg-secondary/10 hover:bg-secondary/30 hover:border-primary/15 hover:-translate-y-0.5"
              }`}
            >
              <div
                className={`w-16 h-16 rounded-xl bg-gradient-to-br ${visual.gradient} border border-primary/10 flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform`}
              >
                <visual.Icon className={`w-8 h-8 ${visual.text}`} />
              </div>
              <div className="w-full typo-body typo-card-label text-center truncate">
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
// Columns view (Miller columns)
// ============================================================================

function ColumnsView({
  drive,
  onOpen,
  onContextMenu,
  onNewFolder,
}: Omit<Props, "onRenameRequest">) {
  const segments = drive.currentPath
    ? drive.currentPath.split("/").filter(Boolean)
    : [];
  const levels: string[] = [""];
  for (let i = 0; i < segments.length; i++) {
    levels.push(segments.slice(0, i + 1).join("/"));
  }

  if (drive.visibleEntries.length === 0 && segments.length === 0) {
    return <DriveEmptyState drive={drive} onNewFolder={onNewFolder} />;
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
  const isCurrent = levelPath === drive.currentPath;
  return (
    <div className="w-64 flex-shrink-0 border-r border-primary/10 overflow-y-auto bg-gradient-to-b from-background to-background/80">
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
            className={`w-full flex items-center gap-2.5 px-3 py-2 typo-body text-left transition-colors ${
              isActive
                ? "bg-gradient-to-r from-cyan-500/25 via-cyan-500/10 to-transparent text-cyan-100 shadow-[inset_2px_0_0_rgba(34,211,238,0.9)]"
                : selected
                ? "bg-cyan-500/10 text-foreground"
                : "hover:bg-secondary/40 text-foreground"
            }`}
          >
            <FileChip entry={entry} size={22} />
            <span className="truncate flex-1">{entry.name}</span>
            {entry.kind === "folder" && (
              <span className="text-foreground/90 typo-body">›</span>
            )}
          </button>
        );
      })}
      {entries.length === 0 && (
        <div className="px-3 py-6 typo-body text-foreground/90 italic text-center">
          Empty
        </div>
      )}
    </>
  );
}

function AsyncColumnEntries(props: {
  path: string;
  activeChild: string | null;
  drive: UseDriveResult;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, x: number, y: number) => void;
}) {
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    driveList(props.path)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [props.path]);
  if (!loaded) {
    return (
      <div className="px-3 py-6 typo-body text-foreground/90 italic text-center">
        Loading...
      </div>
    );
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
// Empty + loading states
// ============================================================================

function LoadingState() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-2 typo-body text-foreground/90">
        <span className="w-3 h-3 rounded-full bg-cyan-500/60 animate-ping" />
        {t.plugins.drive.loading}
      </div>
    </div>
  );
}

function DriveEmptyState({
  drive,
  onNewFolder,
}: {
  drive: UseDriveResult;
  onNewFolder: () => void;
}) {
  const { t } = useTranslation();
  const isRoot = drive.currentPath === "";
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-10 text-center">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-0 blur-2xl opacity-60 bg-gradient-to-br from-cyan-500/30 via-sky-500/20 to-transparent rounded-full"
        />
        <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-sky-500/10 to-transparent border border-cyan-500/30 flex items-center justify-center shadow-[0_0_40px_-10px_rgba(34,211,238,0.6)]">
          <FolderOpen className="w-12 h-12 text-cyan-300" />
        </div>
        <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-cyan-300 animate-pulse" />
      </div>
      <div className="space-y-1.5 max-w-sm">
        <div className="typo-heading-sm typo-section-title">
          {t.plugins.drive.empty_folder}
        </div>
        {isRoot && (
          <p className="typo-body text-foreground/90">
            {t.plugins.drive.empty_hint}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onNewFolder}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-cyan-500/25 to-cyan-500/10 text-cyan-100 border border-cyan-500/40 typo-body font-semibold hover:from-cyan-500/35 hover:to-cyan-500/15 shadow-[0_0_16px_-4px_rgba(34,211,238,0.5)] transition-all"
      >
        {t.plugins.drive.empty_cta}
      </button>
    </div>
  );
}
