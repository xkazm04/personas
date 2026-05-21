import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  FolderPlus,
  FilePlus,
  FileSignature,
  Folder,
  Grid3x3,
  List,
  Columns3,
  Move,
  Pencil,
  PenSquare,
  RefreshCw,
  Search,
  X,
  Home,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DriveTreeNode } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import type { UseDriveResult, ViewMode } from "../hooks/useDrive";
import { useScrollShadows } from "../hooks/useScrollShadows";
import { useTranslation } from "@/i18n/useTranslation";
import { DropCountChip } from "./DropCountChip";

interface Props {
  drive: UseDriveResult;
  onNewFolder: () => void;
  onNewFile: () => void;
  onOpenSignatures: () => void;
  onMoveSelection?: (dst: string) => void;
  onSignSelection?: () => void;
  pathEditing?: boolean;
  onPathEditingChange?: (v: boolean) => void;
  activeDragCount?: number | null;
}

function normalizePathInput(raw: string): string {
  // Strip leading/trailing whitespace and slashes; collapse internal `//`.
  // Drive paths are always relative — empty string is the root.
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  return trimmed.replace(/\/{2,}/g, "/");
}

export function DriveToolbar({
  drive,
  onNewFolder,
  onNewFile,
  onOpenSignatures,
  onMoveSelection,
  onSignSelection,
  pathEditing = false,
  onPathEditingChange,
  activeDragCount = null,
}: Props) {
  const { t, tx } = useTranslation();
  const selectionCount = drive.selection.size;
  const hasSelection = selectionCount > 0;

  // Single-file selection unlocks the [Sign] action. Selecting a folder
  // is treated as no-op for signing.
  const singleSelectedEntry = useMemo(() => {
    if (selectionCount !== 1) return null;
    const path = Array.from(drive.selection)[0];
    return drive.visibleEntries.find((e) => e.path === path) ?? null;
  }, [drive.selection, drive.visibleEntries, selectionCount]);
  const canSign =
    !!singleSelectedEntry && singleSelectedEntry.kind === "file" && !!onSignSelection;

  // Move-to popover anchored under its trigger. Closed by click-outside.
  const [moveOpen, setMoveOpen] = useState(false);
  const moveAnchorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moveOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!moveAnchorRef.current?.contains(e.target as Node)) setMoveOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [moveOpen]);
  // Auto-close when the selection drops to 0 (e.g. user clears or deletes mid-popover).
  useEffect(() => {
    if (!hasSelection) setMoveOpen(false);
  }, [hasSelection]);

  // Which breadcrumb pill (if any) the cursor is currently over during a
  // drag. Path string OR "__root__" sentinel for the Root pill (empty
  // string is a valid path so we can't use null/"" interchangeably).
  const [breadcrumbDropOver, setBreadcrumbDropOver] = useState<string | null>(null);
  const acceptsBreadcrumbDrop = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("application/x-drive-move");
  const handleSegmentDragOver = useCallback(
    (e: React.DragEvent, targetPath: string) => {
      if (!acceptsBreadcrumbDrop(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setBreadcrumbDropOver(targetPath);
    },
    [],
  );
  const handleSegmentDragLeave = useCallback(() => {
    setBreadcrumbDropOver(null);
  }, []);
  const handleSegmentDrop = useCallback(
    async (e: React.DragEvent, targetPath: string) => {
      if (!acceptsBreadcrumbDrop(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setBreadcrumbDropOver(null);
      const raw = e.dataTransfer.getData("application/x-drive-move");
      if (!raw) return;
      try {
        const { paths } = JSON.parse(raw) as { paths: string[] };
        for (const p of paths) {
          if (p === targetPath) continue;
          // Refuse ancestor → descendant moves (would orphan the subtree).
          if (targetPath !== "" && targetPath.startsWith(`${p}/`)) continue;
          const name = p.split("/").pop() ?? p;
          const dst = targetPath ? `${targetPath}/${name}` : name;
          await drive.move(p, dst);
        }
      } catch (err) {
        silentCatch("drive:breadcrumb-drop")(err);
      }
    },
    [drive],
  );

  const segments = drive.currentPath
    ? drive.currentPath.split("/").filter(Boolean)
    : [];

  // Local controlled state, mirrored to the parent flag so Ctrl+L from
  // DrivePage can flip it. Initial value resets to the current path each
  // time edit mode opens.
  const [draft, setDraft] = useState(drive.currentPath);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (pathEditing) {
      setDraft(drive.currentPath);
      // Defer focus + select until the input has mounted in the swap.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [pathEditing, drive.currentPath]);

  const exitEdit = () => onPathEditingChange?.(false);
  const commitEdit = () => {
    const normalized = normalizePathInput(draft);
    drive.navigate(normalized);
    exitEdit();
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/10 bg-gradient-to-b from-background/70 to-background/40 backdrop-blur-sm">
      {/* Nav cluster */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-card bg-secondary/40 border border-primary/10">
        <IconButton
          icon={ArrowLeft}
          label={t.plugins.drive.back}
          onClick={drive.goBack}
          disabled={!drive.canGoBack}
        />
        <IconButton
          icon={ArrowRight}
          label={t.plugins.drive.forward}
          onClick={drive.goForward}
          disabled={!drive.canGoForward}
        />
        <IconButton
          icon={ArrowUp}
          label={t.plugins.drive.up}
          onClick={drive.goUp}
          disabled={!drive.currentPath}
        />
        <span className="w-px h-4 bg-primary/15 mx-0.5" />
        <IconButton
          icon={RefreshCw}
          label={t.plugins.drive.refresh}
          onClick={drive.refresh}
        />
      </div>

      {/* Breadcrumb (or path input when editing) */}
      {pathEditing ? (
        <div className="flex items-center gap-2 min-w-0 flex-1 px-2 py-1 rounded-card bg-cyan-500/10 border border-cyan-500/35 focus-within:border-cyan-400/60 focus-within:ring-2 focus-within:ring-cyan-500/20">
          <Pencil className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                exitEdit();
              }
            }}
            onBlur={exitEdit}
            placeholder={t.plugins.drive.path_input_placeholder}
            aria-label={t.plugins.drive.path_input_aria}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent typo-body font-mono text-cyan-50 placeholder:text-foreground focus:outline-none"
          />
          <span className="typo-caption text-cyan-200/50 flex-shrink-0 hidden md:inline">
            {t.plugins.drive.path_input_hint}
          </span>
        </div>
      ) : (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-0.5 min-w-0 flex-1 px-2 py-1 rounded-card bg-secondary/30 border border-primary/10 hover:border-primary/20 group/breadcrumb"
        >
          {(() => {
            const isRootLast = segments.length === 0;
            const rootDropActive = breadcrumbDropOver === "";
            return (
              <span
                onDragOver={(e) =>
                  !isRootLast && handleSegmentDragOver(e, "")
                }
                onDragLeave={handleSegmentDragLeave}
                onDrop={(e) => !isRootLast && handleSegmentDrop(e, "")}
              >
                <BreadcrumbPill
                  label={t.plugins.drive.sidebar_root}
                  icon={Home}
                  onClick={() => drive.navigate("")}
                  isLast={isRootLast}
                  dragHint={!isRootLast && !!activeDragCount}
                  dropActive={rootDropActive}
                  dropCount={
                    rootDropActive ? activeDragCount ?? null : null
                  }
                />
              </span>
            );
          })()}
          {segments.map((seg, i) => {
            const subPath = segments.slice(0, i + 1).join("/");
            const isLast = i === segments.length - 1;
            const segDropActive = breadcrumbDropOver === subPath;
            return (
              <div
                key={subPath}
                className="flex items-center gap-0.5 min-w-0"
                onDragOver={(e) =>
                  !isLast && handleSegmentDragOver(e, subPath)
                }
                onDragLeave={handleSegmentDragLeave}
                onDrop={(e) => !isLast && handleSegmentDrop(e, subPath)}
              >
                <ChevronRight className="w-3 h-3 text-foreground flex-shrink-0" />
                <BreadcrumbPill
                  label={seg}
                  onClick={() => drive.navigate(subPath)}
                  isLast={isLast}
                  dragHint={!isLast && !!activeDragCount}
                  dropActive={segDropActive}
                  dropCount={segDropActive ? activeDragCount ?? null : null}
                />
              </div>
            );
          })}
          {/* Trailing empty area + pencil affordance — click to type a path. */}
          <button
            type="button"
            onClick={() => onPathEditingChange?.(true)}
            className="ml-auto flex items-center justify-center w-5 h-5 rounded text-foreground group-hover/breadcrumb:text-cyan-300/70 hover:!text-cyan-200 hover:bg-cyan-500/15 transition-all flex-shrink-0"
            title={t.plugins.drive.path_input_aria}
            aria-label={t.plugins.drive.path_input_aria}
          >
            <Pencil className="w-3 h-3" />
          </button>
        </nav>
      )}

      {/* Search */}
      <div className="relative flex items-center group">
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-foreground pointer-events-none transition-colors group-focus-within:text-cyan-300" />
        <input
          type="text"
          value={drive.searchQuery}
          onChange={(e) => drive.setSearchQuery(e.target.value)}
          placeholder={t.plugins.drive.search_placeholder}
          className="pl-8 pr-7 py-1.5 w-56 rounded-card bg-secondary/40 border border-primary/15 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all"
        />
        {drive.searchQuery && (
          <button
            type="button"
            onClick={() => drive.setSearchQuery("")}
            className="absolute right-1.5 p-0.5 rounded text-foreground hover:text-foreground hover:bg-primary/10"
            aria-label={t.plugins.drive.search_clear_aria}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* View toggle (segmented) */}
      <div className="flex items-center gap-0 p-0.5 rounded-card bg-secondary/40 border border-primary/10">
        <ViewSegment
          mode="list"
          label={t.plugins.drive.view_list}
          icon={List}
          active={drive.viewMode === "list"}
          onClick={() => drive.setViewMode("list")}
        />
        <ViewSegment
          mode="icons"
          label={t.plugins.drive.view_icons}
          icon={Grid3x3}
          active={drive.viewMode === "icons"}
          onClick={() => drive.setViewMode("icons")}
        />
        <ViewSegment
          mode="columns"
          label={t.plugins.drive.view_columns}
          icon={Columns3}
          active={drive.viewMode === "columns"}
          onClick={() => drive.setViewMode("columns")}
        />
      </div>

      {/* Actions — selection-aware morph. With a selection, hide "New …"
          create-buttons (they don't apply to the current focus) and show
          Move-to + Sign instead. Signatures stays visible always. */}
      {hasSelection ? (
        <>
          <div ref={moveAnchorRef} className="relative">
            <ActionButton
              icon={Move}
              label={t.plugins.drive.bulk_move_to}
              onClick={() => setMoveOpen((v) => !v)}
              variant="primary"
            />
            {moveOpen && (
              <MovePopover
                tree={drive.tree}
                selectionPaths={Array.from(drive.selection)}
                title={tx(t.plugins.drive.move_to_title, {
                  count: selectionCount,
                })}
                rootLabel={t.plugins.drive.move_to_root_option}
                emptyLabel={t.plugins.drive.move_to_no_destinations}
                onPick={(dst) => {
                  setMoveOpen(false);
                  onMoveSelection?.(dst);
                }}
              />
            )}
          </div>
          {canSign && (
            <ActionButton
              icon={PenSquare}
              label={t.plugins.drive.bulk_sign}
              onClick={() => onSignSelection?.()}
              variant="ghost"
            />
          )}
        </>
      ) : (
        <>
          {/* Both create buttons share ghost tone — there's no honest
              reason for "+ New folder" to read as twice as urgent as
              "+ New file." Cyan-primary is reserved for selection-mode
              actions ([Move to…]) and the active view-toggle. */}
          <ActionButton
            icon={FolderPlus}
            label={t.plugins.drive.new_folder}
            onClick={onNewFolder}
            variant="ghost"
          />
          <ActionButton
            icon={FilePlus}
            label={t.plugins.drive.new_file}
            onClick={onNewFile}
            variant="ghost"
          />
        </>
      )}
      <ActionButton
        icon={FileSignature}
        label={t.plugins.drive.signatures_button}
        onClick={onOpenSignatures}
        variant="muted-accent"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Move-to popover — flattened tree, click a folder to pick it as destination.
// ---------------------------------------------------------------------------

function MovePopover({
  tree,
  selectionPaths,
  title,
  rootLabel,
  emptyLabel,
  onPick,
}: {
  tree: DriveTreeNode | null;
  selectionPaths: string[];
  title: string;
  rootLabel: string;
  emptyLabel: string;
  onPick: (dst: string) => void;
}) {
  // Flatten the tree into a depth-tagged list. Filters out destinations
  // that would be invalid moves: any selection path itself, and any
  // descendant of a selection path (refuses ancestor-into-descendant —
  // same guard the sidebar drop applies).
  const candidates = useMemo(() => {
    const out: Array<{ node: DriveTreeNode; depth: number }> = [];
    if (!tree) return out;
    const isInvalid = (path: string) =>
      selectionPaths.some(
        (p) => path === p || (p !== "" && path.startsWith(`${p}/`)),
      );
    const walk = (node: DriveTreeNode, depth: number) => {
      if (!isInvalid(node.path)) out.push({ node, depth });
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(tree, 0);
    return out;
  }, [tree, selectionPaths]);

  const { ref: scrollRef, topShadow, bottomShadow } =
    useScrollShadows<HTMLDivElement>();

  return (
    <div
      role="region"
      aria-label={title}
      className="absolute right-0 top-full mt-1 z-30 w-72 rounded-modal border border-primary/15 bg-background/95 backdrop-blur-md shadow-elevation-3 overflow-hidden"
    >
      <div className="sticky top-0 px-3 py-2 border-b border-primary/10 bg-background/95 typo-label text-foreground">
        {title}
      </div>
      <div ref={scrollRef} className="relative max-h-80 overflow-y-auto">
        {candidates.length === 0 ? (
          <div className="px-3 py-4 typo-body text-foreground italic text-center">
            {emptyLabel}
          </div>
        ) : (
          <div className="py-1">
            {candidates.map(({ node, depth }) => (
              <button
                key={node.path || "__root__"}
                type="button"
                onClick={() => onPick(node.path)}
                className="w-full flex items-center gap-2 py-1.5 pr-2 rounded-input text-left typo-body text-foreground hover:bg-cyan-500/15 hover:text-cyan-100 transition-colors"
                style={{ paddingLeft: `${10 + depth * 14}px` }}
              >
                <Folder className="w-3.5 h-3.5 text-sky-400/70 flex-shrink-0" />
                <span className="truncate">
                  {node.name || rootLabel}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Fade affordances — render only when there's actually content
          to scroll in that direction. pointer-events-none keeps them
          purely visual; sticky=top inside the scroll area still works. */}
      {topShadow && (
        <div
          aria-hidden
          className="absolute left-0 right-0 top-[33px] h-4 bg-gradient-to-b from-background/95 to-transparent pointer-events-none"
        />
      )}
      {bottomShadow && (
        <div
          aria-hidden
          className="absolute left-0 right-0 bottom-0 h-4 bg-gradient-to-t from-background/95 to-transparent pointer-events-none"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-input text-foreground hover:text-cyan-200 hover:bg-primary/10 disabled:opacity-40 disabled:text-foreground disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function BreadcrumbPill({
  label,
  icon: Icon,
  onClick,
  isLast,
  dragHint = false,
  dropActive = false,
  dropCount = null,
}: {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  isLast: boolean;
  dragHint?: boolean;
  dropActive?: boolean;
  dropCount?: number | null;
}) {
  // dropActive (cursor over this pill mid-drag) wins over dragHint
  // (drag in flight, pill available) which wins over the default look
  // (active = last segment / hover state).
  const stateClass = dropActive
    ? "bg-cyan-500/30 ring-1 ring-cyan-400/60 text-cyan-50 shadow-[inset_0_0_10px_rgba(34,211,238,0.35)]"
    : dragHint
      ? "ring-1 ring-cyan-400/20 bg-cyan-500/5 text-cyan-100/85"
      : isLast
        ? "typo-section-title"
        : "text-foreground hover:text-cyan-200 hover:bg-primary/10";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded-input typo-body font-medium truncate max-w-[160px] transition-colors ${stateClass}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
      <span className="truncate">{label}</span>
      {dropCount !== null && dropCount > 0 && (
        <DropCountChip count={dropCount} />
      )}
    </button>
  );
}

function ViewSegment({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  mode: ViewMode;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-input typo-body font-medium transition-all ${
        active
          ? "bg-gradient-to-b from-cyan-500/35 to-cyan-500/10 text-cyan-50 shadow-elevation-1 border border-cyan-500/50"
          : "text-foreground hover:text-cyan-200 hover:bg-primary/10 border border-transparent"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  variant,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant: "primary" | "ghost" | "accent" | "muted-accent";
}) {
  // Variant budget:
  //   primary       — selection-mode primary action ([Move to…]).
  //   ghost         — neutral create / utility actions.
  //   accent        — high-intensity fuchsia (unused at rest now;
  //                   reserved for callers that want to demand attention).
  //   muted-accent  — fuchsia-tinted but quiet enough to live next to
  //                   ghost neighbours without out-shouting them. Used by
  //                   the Signatures gateway button.
  const styles = {
    primary:
      "bg-gradient-to-b from-cyan-500/25 to-cyan-500/10 text-cyan-100 border border-cyan-500/40 hover:from-cyan-500/35 hover:to-cyan-500/15 shadow-[0_0_12px_-4px_rgba(34,211,238,0.4)]",
    ghost:
      "bg-secondary/50 text-foreground border border-primary/15 hover:bg-secondary/70 hover:text-foreground",
    accent:
      "bg-gradient-to-b from-fuchsia-500/25 to-rose-500/10 text-fuchsia-100 border border-fuchsia-500/40 hover:from-fuchsia-500/35 hover:to-rose-500/15 shadow-[0_0_12px_-4px_rgba(217,70,239,0.4)]",
    "muted-accent":
      "bg-secondary/50 text-fuchsia-200/80 border border-fuchsia-500/20 hover:bg-fuchsia-500/10 hover:text-fuchsia-100 hover:border-fuchsia-500/35",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-body font-semibold transition-all ${styles[variant]}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
