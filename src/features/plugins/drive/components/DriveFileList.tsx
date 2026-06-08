import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronUp,
  ChevronDown,
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen,
  Layers,
  Search,
} from "lucide-react";

import type { DriveEntry, DriveSearchHit } from "@/api/drive";
import { driveFormatBytes, driveList, driveParentPath } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import type { UseDriveResult, SortKey } from "../hooks/useDrive";
import { useScrollShadows } from "../hooks/useScrollShadows";
import { useTranslation } from "@/i18n/useTranslation";
import {
  visualForEntry,
  formatRelativeTime,
  kindLabel,
  kindGroupLabel,
} from "../designTokens";
import { DriveEmptyHint } from "./DriveEmptyHint";
import { DropCountChip } from "./DropCountChip";

interface Props {
  drive: UseDriveResult;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, clientX: number, clientY: number) => void;
  onRenameRequest: (entry: DriveEntry) => void;
  onNewFolder: () => void;
  inlineRenamingPath?: string | null;
  onCommitInlineRename?: (path: string, newName: string) => void;
  onCancelInlineRename?: () => void;
  pendingCreate?: "folder" | "file" | null;
  onCommitPendingCreate?: (name: string) => void;
  onCancelPendingCreate?: () => void;
  activeDragCount?: number | null;
  onDragSelectionStart?: (count: number) => void;
  onDragSelectionEnd?: () => void;
}

export function DriveFileList({
  drive,
  onOpen,
  onContextMenu,
  onRenameRequest,
  onNewFolder,
  inlineRenamingPath = null,
  onCommitInlineRename,
  onCancelInlineRename,
  pendingCreate = null,
  onCommitPendingCreate,
  onCancelPendingCreate,
  activeDragCount = null,
  onDragSelectionStart,
  onDragSelectionEnd,
}: Props) {
  if (drive.viewMode === "icons") {
    return (
      <IconsView
        drive={drive}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
        onRenameRequest={onRenameRequest}
        onNewFolder={onNewFolder}
        inlineRenamingPath={inlineRenamingPath}
        onCommitInlineRename={onCommitInlineRename}
        onCancelInlineRename={onCancelInlineRename}
        pendingCreate={pendingCreate}
        onCommitPendingCreate={onCommitPendingCreate}
        onCancelPendingCreate={onCancelPendingCreate}
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
        inlineRenamingPath={inlineRenamingPath}
        onCommitInlineRename={onCommitInlineRename}
        onCancelInlineRename={onCancelInlineRename}
        pendingCreate={pendingCreate}
        onCommitPendingCreate={onCommitPendingCreate}
        onCancelPendingCreate={onCancelPendingCreate}
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
      inlineRenamingPath={inlineRenamingPath}
      onCommitInlineRename={onCommitInlineRename}
      onCancelInlineRename={onCancelInlineRename}
      pendingCreate={pendingCreate}
      onCommitPendingCreate={onCommitPendingCreate}
      onCancelPendingCreate={onCancelPendingCreate}
      activeDragCount={activeDragCount}
      onDragSelectionStart={onDragSelectionStart}
      onDragSelectionEnd={onDragSelectionEnd}
    />
  );
}

// Inline rename input — replaces the filename span/label while the user
// is renaming. Auto-focuses, pre-selects the base name without extension
// so the user can type a new name without nuking the file extension.
// Enter commits, Esc cancels, blur cancels. The className override lets
// callers swap the layout class (list-view uses flex-1, icons-view uses
// w-full text-center) without forking the input behaviour.
function InlineRenameInput({
  initialName,
  onCommit,
  onCancel,
  className = "flex-1 min-w-0 px-1.5 py-0.5 rounded-input bg-background/80 border border-cyan-500/50 typo-body text-foreground focus-ring",
}: {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initialName);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Pre-select the base name (everything before the last dot) so the
    // extension is preserved unless the user explicitly extends the
    // selection. For names like ".env" with no separate base, just select
    // everything.
    const dot = initialName.lastIndexOf(".");
    if (dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initialName]);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        // Stop bubbling so the global keyboard handler doesn't see Enter
        // or Esc and re-fire its own behavior.
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={onCancel}
      className={className}
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
      className={`flex items-center justify-center flex-shrink-0 rounded-card bg-gradient-to-br ${visual.gradient} ${
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
    return "bg-cyan-500/25 ring-1 ring-cyan-400/60 shadow-[inset_0_0_12px_rgba(34,211,238,0.3)] transition-colors duration-150 ease-out";
  if (isFlash)
    return "bg-emerald-500/15 ring-1 ring-emerald-400/50 shadow-[inset_0_0_16px_rgba(52,211,153,0.2)] transition-all duration-700";
  if (isSelected)
    return "bg-gradient-to-r from-cyan-500/15 via-cyan-500/8 to-transparent text-foreground shadow-[inset_2px_0_0_rgba(34,211,238,0.8)] transition-colors duration-150 ease-out";
  // Hover previews the selected state by sliding toward the same cyan
  // palette rather than landing on neutral secondary/40 — that way the
  // "I'm pointing here → this is chosen" transition reads as a
  // continuum, not a jump from gray to cyan.
  return zebra
    ? "bg-secondary/15 hover:bg-cyan-500/8 hover:shadow-[inset_2px_0_0_rgba(34,211,238,0.25)] transition-colors duration-150 ease-out"
    : "hover:bg-cyan-500/8 hover:shadow-[inset_2px_0_0_rgba(34,211,238,0.25)] transition-colors duration-150 ease-out";
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
  inlineRenamingPath = null,
  onCommitInlineRename,
  onCancelInlineRename,
  pendingCreate = null,
  onCommitPendingCreate,
  onCancelPendingCreate,
  activeDragCount = null,
  onDragSelectionStart,
  onDragSelectionEnd,
}: Props) {
  const { t, tx } = useTranslation();
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const {
    ref: scrollRef,
    topShadow,
    bottomShadow,
  } = useScrollShadows<HTMLDivElement>();

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
    // When sorting by kind, the column header competes with the section
    // dividers below — mute it and swap the sort arrow for a Layers icon
    // so the eye reads "this column is what's grouping the rows," not
    // "this column is itself ascending/descending."
    const isGrouped = column === "kind" && drive.sortKey === "kind";
    const Arrow = drive.sortDir === "asc" ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => drive.setSort(column)}
        title={isGrouped ? drive.sortDir : undefined}
        className={`flex items-center gap-1 py-2 typo-label transition-colors focus-ring ${
          isGrouped
            ? "text-cyan-200 hover:text-cyan-200"
            : active
              ? "text-cyan-200"
              : "text-foreground hover:text-foreground"
        } ${className}`}
      >
        {label}
        {isGrouped ? (
          <Layers className="w-3 h-3" />
        ) : (
          active && <Arrow className="w-3 h-3" />
        )}
      </button>
    );
  };

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, entry: DriveEntry) => {
      if (!drive.isSelected(entry.path)) drive.selectOnly(entry.path);
      const paths =
        drive.selection.size > 0 && drive.selection.has(entry.path)
          ? Array.from(drive.selection)
          : [entry.path];
      e.dataTransfer.setData(
        "application/x-drive-move",
        JSON.stringify({ paths }),
      );
      e.dataTransfer.effectAllowed = "move";
      onDragSelectionStart?.(paths.length);
    },
    [drive, onDragSelectionStart],
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
      } catch (err) {
        silentCatch("drive:drop-payload")(err);
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

  // Recursive-search results take over the list when the user has escalated
  // beyond the local folder filter. Header pill + clear-search CTA.
  if (drive.recursiveResults !== null) {
    return (
      <RecursiveResultsView drive={drive} onOpen={onOpen} />
    );
  }

  if (drive.visibleEntries.length === 0 && !pendingCreate) {
    if (drive.searchQuery.trim().length >= 2) {
      return <SearchEmptyWithCTA drive={drive} />;
    }
    return <DriveEmptyState drive={drive} onNewFolder={onNewFolder} />;
  }

  // When sorting by kind, precompute the bucket per-row + the per-bucket
  // count so we can render sticky group dividers between buckets. Cheap —
  // visibleEntries is already capped at folder-size.
  const buckets =
    drive.sortKey === "kind"
      ? drive.visibleEntries.map((e) => visualForEntry(e).labelKey)
      : null;
  const bucketCounts: Map<string, number> | null = buckets
    ? buckets.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())
    : null;

  return (
    <div
      ref={scrollRef}
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
        {/* Top scroll-shadow — sticky just below the column header so it
            sits exactly at the top of the row area, signalling content
            scrolls up under the header. Hidden when scrollTop === 0. */}
        {topShadow && (
          <div
            aria-hidden
            className="sticky top-[33px] z-[8] -mb-4 h-4 bg-gradient-to-b from-background/95 to-transparent pointer-events-none"
          />
        )}
        {/* Phantom create row — sits above real rows, kind-styled by intent. */}
        {pendingCreate && (
          <div className="grid grid-cols-[1fr_110px_120px_160px] gap-3 px-4 py-2 border-b border-cyan-500/25 bg-cyan-500/5">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-card border ${
                  pendingCreate === "folder"
                    ? "bg-sky-500/20 border-sky-500/30 text-sky-300"
                    : "bg-slate-500/15 border-slate-500/25 text-foreground"
                }`}
              >
                {pendingCreate === "folder" ? (
                  <FolderIcon className="w-4 h-4" />
                ) : (
                  <FileIcon className="w-4 h-4" />
                )}
              </div>
              <InlineRenameInput
                initialName=""
                onCommit={(name) => onCommitPendingCreate?.(name)}
                onCancel={() => onCancelPendingCreate?.()}
              />
            </div>
            <div className="typo-body text-foreground self-center tabular-nums">—</div>
            <div className="typo-body text-foreground self-center">
              {pendingCreate === "folder"
                ? t.plugins.drive.folder_kind
                : t.plugins.drive.kind_generic}
            </div>
            <div className="typo-body text-foreground self-center">—</div>
          </div>
        )}
        {/* Rows */}
        {drive.visibleEntries.map((entry, idx) => {
          const selected = drive.isSelected(entry.path);
          const flash = drive.recentlyWritten.has(entry.path);
          const drop = dragTarget === entry.path;
          const zebra = idx % 2 === 1;
          const bucket = buckets?.[idx] ?? null;
          const showGroupHeader =
            !!bucket && (idx === 0 || buckets?.[idx - 1] !== bucket);
          return (
            <Fragment key={entry.path}>
              {showGroupHeader && bucket && (
                <div className="sticky top-[33px] z-[5] flex items-center justify-between gap-2 px-4 py-1.5 bg-gradient-to-r from-cyan-500/10 via-cyan-500/5 to-transparent border-y border-cyan-500/15 backdrop-blur-sm">
                  <span className="typo-label tracking-wider uppercase text-cyan-200">
                    {kindGroupLabel(t, bucket)}
                  </span>
                  <span className="typo-caption text-cyan-200 tabular-nums">
                    {bucketCounts?.get(bucket) ?? 0}
                  </span>
                </div>
              )}
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, entry)}
                onDragEnd={() => onDragSelectionEnd?.()}
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
                )} ${
                  // Folder rows get a faint cyan halo while a drag is in
                  // flight, signalling "you can drop here" before the
                  // cursor hovers. Hover keeps the existing drop state.
                  activeDragCount && entry.kind === "folder" && !drop && !selected
                    ? "ring-1 ring-cyan-400/20 bg-cyan-500/5"
                    : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileChip entry={entry} size={32} />
                  {inlineRenamingPath === entry.path ? (
                    <InlineRenameInput
                      initialName={entry.name}
                      onCommit={(newName) =>
                        onCommitInlineRename?.(entry.path, newName)
                      }
                      onCancel={() => onCancelInlineRename?.()}
                    />
                  ) : (
                    <>
                      <span className="typo-body typo-card-label truncate flex-1">
                        {entry.name}
                      </span>
                      {drop && activeDragCount && (
                        <DropCountChip count={activeDragCount} />
                      )}
                    </>
                  )}
                </div>
                <div className="typo-body text-foreground self-center tabular-nums">
                  {entry.kind === "folder" ? "—" : driveFormatBytes(entry.size)}
                </div>
                <div className="typo-body text-foreground self-center truncate">
                  {entry.kind === "folder"
                    ? t.plugins.drive.folder_kind
                    : kindLabel(t, visualForEntry(entry))}
                </div>
                <div className="typo-body text-foreground self-center tabular-nums">
                  {formatRelativeTime(entry.modified, t, tx)}
                </div>
              </div>
            </Fragment>
          );
        })}
        {/* Bottom scroll-shadow — sticky at bottom-0 inside the scroll
            container so it tracks the visible viewport edge. Hidden when
            the last row is fully in view. */}
        {bottomShadow && (
          <div
            aria-hidden
            className="sticky bottom-0 z-[8] -mt-4 h-4 bg-gradient-to-t from-background to-transparent pointer-events-none"
          />
        )}
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
  inlineRenamingPath = null,
  onCommitInlineRename,
  onCancelInlineRename,
  pendingCreate = null,
  onCommitPendingCreate,
  onCancelPendingCreate,
}: Props) {
  if (drive.loading && drive.entries.length === 0) {
    return <LoadingState />;
  }
  if (drive.visibleEntries.length === 0 && !pendingCreate) {
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
        {pendingCreate && (
          <div className="flex flex-col items-center gap-2.5 p-3 rounded-modal border bg-cyan-500/10 border-cyan-500/50 ring-2 ring-cyan-400/40">
            <div
              className={`w-16 h-16 rounded-modal border border-primary/10 flex items-center justify-center shadow-inner bg-gradient-to-br ${
                pendingCreate === "folder"
                  ? "from-sky-500/25 via-sky-500/10 to-sky-500/5"
                  : "from-slate-500/20 via-slate-500/10 to-slate-500/5"
              }`}
            >
              {pendingCreate === "folder" ? (
                <FolderIcon className="w-8 h-8 text-sky-300" />
              ) : (
                <FileIcon className="w-8 h-8 text-foreground" />
              )}
            </div>
            <InlineRenameInput
              initialName=""
              onCommit={(name) => onCommitPendingCreate?.(name)}
              onCancel={() => onCancelPendingCreate?.()}
              className="w-full text-center px-1.5 py-0.5 rounded-input bg-background/80 border border-cyan-500/50 typo-body text-foreground focus-ring"
            />
          </div>
        )}
        {drive.visibleEntries.map((entry) => {
          const selected = drive.isSelected(entry.path);
          const flash = drive.recentlyWritten.has(entry.path);
          const visual = visualForEntry(entry);
          const isRenaming = inlineRenamingPath === entry.path;
          // When renaming, render the tile as a div instead of a button
          // — nesting an <input> inside a <button> is invalid HTML and
          // the button's click handlers would fight the input's focus.
          if (isRenaming) {
            return (
              <div
                key={entry.path}
                className="flex flex-col items-center gap-2.5 p-3 rounded-modal border bg-cyan-500/10 border-cyan-500/50 ring-2 ring-cyan-400/40"
              >
                <div
                  className={`w-16 h-16 rounded-modal bg-gradient-to-br ${visual.gradient} border border-primary/10 flex items-center justify-center shadow-inner`}
                >
                  <visual.Icon className={`w-8 h-8 ${visual.text}`} />
                </div>
                <InlineRenameInput
                  initialName={entry.name}
                  onCommit={(newName) =>
                    onCommitInlineRename?.(entry.path, newName)
                  }
                  onCancel={() => onCancelInlineRename?.()}
                  className="w-full text-center px-1.5 py-0.5 rounded-input bg-background/80 border border-cyan-500/50 typo-body text-foreground focus-ring"
                />
              </div>
            );
          }
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
              className={`group flex flex-col items-center gap-2.5 p-3 rounded-modal border transition-all focus-ring ${
                selected
                  ? `bg-cyan-500/10 border-cyan-500/50 ring-2 ${visual.ring} shadow-[0_0_20px_-8px_rgba(34,211,238,0.6)]`
                  : flash
                  ? "bg-emerald-500/10 border-emerald-500/50 ring-2 ring-emerald-400/40"
                  : "border-primary/5 bg-secondary/10 hover:bg-secondary/30 hover:border-primary/15 hover:-translate-y-0.5"
              }`}
            >
              <div
                className={`w-16 h-16 rounded-modal bg-gradient-to-br ${visual.gradient} border border-primary/10 flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform`}
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
  inlineRenamingPath = null,
  onCommitInlineRename,
  onCancelInlineRename,
  pendingCreate = null,
  onCommitPendingCreate,
  onCancelPendingCreate,
}: Omit<Props, "onRenameRequest">) {
  const segments = drive.currentPath
    ? drive.currentPath.split("/").filter(Boolean)
    : [];
  const levels: string[] = [""];
  for (let i = 0; i < segments.length; i++) {
    levels.push(segments.slice(0, i + 1).join("/"));
  }

  if (
    drive.visibleEntries.length === 0 &&
    segments.length === 0 &&
    !pendingCreate
  ) {
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
          inlineRenamingPath={inlineRenamingPath}
          onCommitInlineRename={onCommitInlineRename}
          onCancelInlineRename={onCancelInlineRename}
          pendingCreate={pendingCreate}
          onCommitPendingCreate={onCommitPendingCreate}
          onCancelPendingCreate={onCancelPendingCreate}
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
  inlineRenamingPath?: string | null;
  onCommitInlineRename?: (path: string, newName: string) => void;
  onCancelInlineRename?: () => void;
  pendingCreate?: "folder" | "file" | null;
  onCommitPendingCreate?: (name: string) => void;
  onCancelPendingCreate?: () => void;
}

function ColumnPane({
  drive,
  levelPath,
  activeChild,
  onOpen,
  onContextMenu,
  inlineRenamingPath = null,
  onCommitInlineRename,
  onCancelInlineRename,
  pendingCreate = null,
  onCommitPendingCreate,
  onCancelPendingCreate,
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
          inlineRenamingPath={inlineRenamingPath}
          onCommitInlineRename={onCommitInlineRename}
          onCancelInlineRename={onCancelInlineRename}
          pendingCreate={pendingCreate}
          onCommitPendingCreate={onCommitPendingCreate}
          onCancelPendingCreate={onCancelPendingCreate}
        />
      ) : (
        <AsyncColumnEntries
          path={levelPath}
          activeChild={activeChild}
          drive={drive}
          cachedEntriesFor={drive.cachedEntriesFor}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
          inlineRenamingPath={inlineRenamingPath}
          onCommitInlineRename={onCommitInlineRename}
          onCancelInlineRename={onCancelInlineRename}
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
  inlineRenamingPath = null,
  onCommitInlineRename,
  onCancelInlineRename,
  pendingCreate = null,
  onCommitPendingCreate,
  onCancelPendingCreate,
}: {
  entries: DriveEntry[];
  drive: UseDriveResult;
  activeChild: string | null;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, x: number, y: number) => void;
  inlineRenamingPath?: string | null;
  onCommitInlineRename?: (path: string, newName: string) => void;
  onCancelInlineRename?: () => void;
  pendingCreate?: "folder" | "file" | null;
  onCommitPendingCreate?: (name: string) => void;
  onCancelPendingCreate?: () => void;
}) {
  return (
    <>
      {pendingCreate && (
        <div className="w-full flex items-center gap-2.5 px-3 py-2 typo-body bg-cyan-500/10 border-b border-cyan-500/25">
          <div
            className={`flex items-center justify-center w-[22px] h-[22px] rounded-card border ${
              pendingCreate === "folder"
                ? "bg-sky-500/20 border-sky-500/30 text-sky-300"
                : "bg-slate-500/15 border-slate-500/25 text-foreground"
            }`}
          >
            {pendingCreate === "folder" ? (
              <FolderIcon className="w-3 h-3" />
            ) : (
              <FileIcon className="w-3 h-3" />
            )}
          </div>
          <InlineRenameInput
            initialName=""
            onCommit={(name) => onCommitPendingCreate?.(name)}
            onCancel={() => onCancelPendingCreate?.()}
          />
        </div>
      )}
      {entries.map((entry) => {
        const isActive = entry.path === activeChild;
        const selected = drive.isSelected(entry.path);
        const isRenaming = inlineRenamingPath === entry.path;
        // Same pattern as IconsView — drop the button wrapper while
        // renaming so the input can mount without invalid-HTML nesting
        // and without the button's click handler stealing focus.
        if (isRenaming) {
          return (
            <div
              key={entry.path}
              className="w-full flex items-center gap-2.5 px-3 py-2 typo-body bg-cyan-500/10 shadow-[inset_2px_0_0_rgba(34,211,238,0.9)]"
            >
              <FileChip entry={entry} size={22} />
              <InlineRenameInput
                initialName={entry.name}
                onCommit={(newName) =>
                  onCommitInlineRename?.(entry.path, newName)
                }
                onCancel={() => onCancelInlineRename?.()}
              />
            </div>
          );
        }
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
            className={`w-full flex items-center gap-2.5 px-3 py-2 typo-body text-left transition-colors focus-ring ${
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
              <span className="text-foreground typo-body">›</span>
            )}
          </button>
        );
      })}
      {entries.length === 0 && <ColumnEmptyLabel />}
    </>
  );
}

function AsyncColumnEntries(props: {
  path: string;
  activeChild: string | null;
  drive: UseDriveResult;
  // Passed in separately because it's stable (useCallback'd inside useDrive),
  // whereas `props.drive` itself is a fresh object literal every parent
  // render. Listing the whole `drive` in this effect's deps re-fired the
  // fetch on every render — the new identity here makes it a true cache check.
  cachedEntriesFor: (p: string) => DriveEntry[] | null;
  onOpen: (entry: DriveEntry) => void;
  onContextMenu: (entry: DriveEntry | null, x: number, y: number) => void;
  inlineRenamingPath?: string | null;
  onCommitInlineRename?: (path: string, newName: string) => void;
  onCancelInlineRename?: () => void;
}) {
  // Seed from useDrive's path cache so columns the user has already navigated
  // through render synchronously instead of flashing a Loading state and
  // round-tripping to the backend.
  const cached = props.cachedEntriesFor(props.path);
  const [entries, setEntries] = useState<DriveEntry[]>(cached ?? []);
  const [loaded, setLoaded] = useState(cached !== null);
  useEffect(() => {
    const seed = props.cachedEntriesFor(props.path);
    if (seed) {
      setEntries(seed);
      setLoaded(true);
      return;
    }
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
  }, [props.path, props.cachedEntriesFor, props]);
  if (!loaded) {
    return <ColumnLoadingLabel />;
  }
  return (
    <ColumnEntries
      entries={entries}
      drive={props.drive}
      activeChild={props.activeChild}
      onOpen={props.onOpen}
      onContextMenu={props.onContextMenu}
      inlineRenamingPath={props.inlineRenamingPath}
      onCommitInlineRename={props.onCommitInlineRename}
      onCancelInlineRename={props.onCancelInlineRename}
    />
  );
}

// ============================================================================
// Recursive search — empty CTA + results view
// ============================================================================

function SearchEmptyWithCTA({ drive }: { drive: UseDriveResult }) {
  const { t, tx } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <DriveEmptyHint
        size="lg"
        icon={Search}
        title={tx(t.plugins.drive.search_no_local_hits, {
          query: drive.searchQuery,
        })}
        body={t.plugins.drive.search_escalate_hint}
        cta={{
          icon: Search,
          label: drive.recursiveLoading
            ? t.plugins.drive.search_running
            : t.plugins.drive.search_all_drive_cta,
          onClick: () => drive.runRecursiveSearch(),
          disabled: drive.recursiveLoading,
        }}
        className="max-w-md"
      />
    </div>
  );
}

function RecursiveResultsView({
  drive,
  onOpen,
}: {
  drive: UseDriveResult;
  onOpen: (entry: DriveEntry) => void;
}) {
  const { t, tx } = useTranslation();
  const results = drive.recursiveResults ?? [];
  return (
    <div className="flex-1 overflow-auto">
      {/* Header pill */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-primary/10 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 typo-body text-foreground">
          <Search className="w-3.5 h-3.5 text-cyan-300" />
          <span className="font-medium">
            {tx(t.plugins.drive.search_results_for, {
              query: drive.recursiveQuery ?? "",
            })}
          </span>
          <span className="text-foreground typo-caption tabular-nums">
            {tx(t.plugins.drive.search_n_hits, { count: results.length })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => drive.clearRecursiveSearch()}
          className="px-2 py-1 rounded-input typo-body text-foreground hover:bg-secondary/60 focus-ring"
        >
          {t.plugins.drive.search_back_to_folder}
        </button>
      </div>
      {/* Results */}
      {results.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-10 typo-body text-foreground italic">
          {t.plugins.drive.search_no_drive_hits}
        </div>
      ) : (
        results.map((hit) => (
          <RecursiveResultRow key={hit.entry.path} hit={hit} drive={drive} onOpen={onOpen} />
        ))
      )}
    </div>
  );
}

function RecursiveResultRow({
  hit,
  drive,
  onOpen,
}: {
  hit: DriveSearchHit;
  drive: UseDriveResult;
  onOpen: (entry: DriveEntry) => void;
}) {
  const { t } = useTranslation();
  const { entry, parentPath } = hit;
  return (
    <div
      onDoubleClick={() => {
        if (entry.kind === "folder") {
          drive.navigate(entry.path);
          drive.clearRecursiveSearch();
        } else {
          onOpen(entry);
        }
      }}
      className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2 border-b border-primary/5 hover:bg-secondary/40 transition-colors cursor-default"
    >
      <div className="flex items-center gap-3 min-w-0">
        <FileChip entry={entry} size={28} />
        <div className="min-w-0">
          <div className="typo-body typo-card-label truncate">{entry.name}</div>
          <div className="typo-caption text-foreground truncate font-mono">
            {parentPath || "/"}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          // Reveal: navigate to parent and clear the search.
          const parent = entry.kind === "folder"
            ? driveParentPath(entry.path)
            : parentPath;
          drive.navigate(parent);
          drive.clearRecursiveSearch();
        }}
        className="self-center p-1.5 rounded-input text-foreground hover:text-cyan-200 hover:bg-cyan-500/15 transition-colors focus-ring"
        title={t.plugins.drive.search_reveal_aria}
        aria-label={t.plugins.drive.search_reveal_aria}
      >
        <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ============================================================================
// Empty + loading states
// ============================================================================

function ColumnEmptyLabel() {
  const { t } = useTranslation();
  return (
    <div className="px-2 py-3">
      <DriveEmptyHint
        size="sm"
        icon={FolderIcon}
        title={t.plugins.drive.empty_column}
      />
    </div>
  );
}

function ColumnLoadingLabel() {
  const { t } = useTranslation();
  return (
    <div className="px-3 py-6 typo-body text-foreground italic text-center">
      {t.plugins.drive.loading_column}
    </div>
  );
}

function LoadingState() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-2 typo-body text-foreground">
        <span className="w-3 h-3 rounded-full bg-cyan-400 animate-ping" />
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
    <div className="flex-1 flex items-center justify-center p-10">
      <DriveEmptyHint
        size="lg"
        icon={FolderOpen}
        title={t.plugins.drive.empty_folder}
        body={isRoot ? t.plugins.drive.empty_hint : undefined}
        cta={{
          icon: FolderIcon,
          label: t.plugins.drive.empty_cta,
          onClick: onNewFolder,
        }}
        className="max-w-md"
      />
    </div>
  );
}
