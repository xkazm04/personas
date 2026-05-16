import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, Clock, Folder, FolderOpen, HardDrive, Sparkles } from "lucide-react";

const RECENT_COLLAPSED_KEY = "drive.sidebar.recentCollapsed";

import type { DriveEntry, DriveTreeNode } from "@/api/drive";
import { driveFormatBytes, driveParentPath } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import type { UseDriveResult } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";
import { formatRelativeTime, visualForEntry } from "../designTokens";
import { DriveEmptyHint } from "./DriveEmptyHint";

interface Props {
  drive: UseDriveResult;
}

/** Visual-only cap for the storage meter. Real drives are unbounded. */
const STORAGE_METER_CAP_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export function DriveSidebar({ drive }: Props) {
  const { t, tx } = useTranslation();

  // localStorage-backed collapse state for the Recent rail. A full zustand
  // slice would be heavier than this one boolean deserves; the localStorage
  // read happens once at mount and writes are infrequent.
  const [recentCollapsed, setRecentCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RECENT_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleRecentCollapsed = useCallback(() => {
    setRecentCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RECENT_COLLAPSED_KEY, String(next));
      } catch {
        // Quota / privacy mode — the in-memory state still updates.
      }
      return next;
    });
  }, []);

  return (
    <aside className="w-60 flex-shrink-0 border-r border-primary/10 bg-gradient-to-b from-background via-background to-background/80 flex flex-col">
      {/* Brand header */}
      <div className="relative px-4 py-3 border-b border-primary/10 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-sky-500/5 to-transparent pointer-events-none"
        />
        <div className="relative flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-card bg-gradient-to-br from-cyan-500/25 to-sky-500/5 border border-cyan-500/30 flex items-center justify-center shadow-[0_0_20px_-6px_rgba(14,165,233,0.6)]">
            <HardDrive className="w-4 h-4 text-cyan-200" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="typo-section-title tracking-tight">
              {t.plugins.drive.sidebar_root}
            </div>
            <div className="typo-caption text-foreground">
              {drive.storage?.isDev
                ? t.plugins.drive.dev_badge
                : t.plugins.drive.sidebar_managed_local}
            </div>
          </div>
          {drive.storage?.isDev && (
            <span className="px-1.5 py-0.5 rounded typo-label bg-amber-500/25 text-amber-200 border border-amber-500/50">
              dev
            </span>
          )}
        </div>
      </div>

      {/* Recent rail + folder tree share the scrollable middle area. */}
      <div className="flex-1 overflow-y-auto py-2 px-1">
        <div className="mb-3">
          <button
            type="button"
            onClick={toggleRecentCollapsed}
            aria-expanded={!recentCollapsed}
            className="group w-full px-2 mb-1 flex items-center gap-1.5 typo-label text-foreground hover:text-cyan-200 transition-colors"
          >
            {recentCollapsed ? (
              <ChevronRight className="w-3 h-3 text-foreground/60 group-hover:text-cyan-200/80" />
            ) : (
              <ChevronDown className="w-3 h-3 text-foreground/60 group-hover:text-cyan-200/80" />
            )}
            <Clock className="w-3 h-3 text-cyan-300/80" />
            <span>{t.plugins.drive.sidebar_recent}</span>
            {drive.recent.length > 0 && (
              <span className="ml-auto typo-caption text-foreground/50 tabular-nums">
                {drive.recent.length}
              </span>
            )}
          </button>
          {!recentCollapsed &&
            (drive.recent.length > 0 ? (
              <RecentRail entries={drive.recent} drive={drive} />
            ) : (
              <div className="mx-2">
                <DriveEmptyHint
                  size="sm"
                  icon={Clock}
                  title={t.plugins.drive.sidebar_recent_empty}
                />
              </div>
            ))}
        </div>
        <div className="px-2 mb-1.5 typo-label text-foreground">
          {t.plugins.drive.sidebar_folders_label}
        </div>
        {drive.tree ? (
          <TreeNode node={drive.tree} drive={drive} depth={0} initiallyOpen />
        ) : (
          <div className="px-3 py-2 typo-body text-foreground">
            {t.plugins.drive.loading}
          </div>
        )}
      </div>

      {/* Storage meter */}
      {drive.storage && (
        <div className="border-t border-primary/10 px-4 py-3 bg-background/40">
          <div className="flex items-center justify-between mb-1.5">
            <div className="typo-label text-foreground">
              {t.plugins.drive.sidebar_storage}
            </div>
            <Sparkles className="w-3 h-3 text-cyan-300" />
          </div>
          <StorageMeter
            usedBytes={drive.storage.usedBytes}
            capBytes={STORAGE_METER_CAP_BYTES}
          />
          <div className="mt-2 typo-body text-foreground font-medium">
            {tx(t.plugins.drive.storage_used, {
              used: driveFormatBytes(drive.storage.usedBytes),
              count: drive.storage.entryCount,
            })}
          </div>
          <div
            className="mt-1 typo-caption text-foreground font-mono truncate"
            title={drive.storage.root}
          >
            {drive.storage.root}
          </div>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Recent rail — the N most-recently-modified files across the drive.
// Click a row to navigate to the file's parent folder and select it.
// ---------------------------------------------------------------------------

function RecentRail({
  entries,
  drive,
}: {
  entries: DriveEntry[];
  drive: UseDriveResult;
}) {
  const { t, tx } = useTranslation();
  return (
    <div className="px-1 space-y-0.5">
      {entries.map((entry) => {
        const visual = visualForEntry(entry);
        const Icon = visual.Icon;
        const parent = driveParentPath(entry.path);
        return (
          <button
            key={entry.path}
            type="button"
            onClick={() => {
              drive.navigate(parent);
              // selectOnly may race with the navigation-clears-selection
              // effect; the targeted entry might not be in visibleEntries
              // yet. We schedule the select for the next microtask, which
              // lands after navigate's state batch.
              queueMicrotask(() => drive.selectOnly(entry.path));
            }}
            title={entry.path}
            className="group w-full flex items-center gap-2 py-1.5 px-2 rounded-input text-left typo-body text-foreground hover:bg-cyan-500/10 hover:text-cyan-100 transition-colors"
          >
            <div
              className={`flex items-center justify-center w-5 h-5 rounded bg-gradient-to-br ${visual.gradient} flex-shrink-0`}
            >
              <Icon className={`w-3 h-3 ${visual.text}`} />
            </div>
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <span className="typo-caption text-foreground/60 tabular-nums flex-shrink-0 group-hover:text-cyan-200/60">
              {formatRelativeTime(entry.modified, t, tx)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Storage meter
// ---------------------------------------------------------------------------

function StorageMeter({
  usedBytes,
  capBytes,
}: {
  usedBytes: number;
  capBytes: number;
}) {
  // Log-scale so the bar animates even for very small drives; caps at cap.
  const raw = Math.max(0, usedBytes) / Math.max(1, capBytes);
  const pct = Math.min(1, Math.log10(1 + raw * 9));
  const width = Math.max(4, pct * 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative h-2 w-full overflow-hidden rounded-full bg-secondary/50 border border-primary/10"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-teal-300 shadow-[0_0_10px_rgba(14,165,233,0.6)] transition-all duration-500"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: DriveTreeNode;
  drive: UseDriveResult;
  depth: number;
  initiallyOpen?: boolean;
}

function TreeNode({ node, drive, depth, initiallyOpen = false }: TreeNodeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [dropActive, setDropActive] = useState(false);
  const isActive = drive.currentPath === node.path;
  const hasChildren = node.children.length > 0 || node.hasMoreChildren;

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  // Drag from the file list ships `application/x-drive-move` with the
  // selection's paths. Tree nodes mirror the file-list folder drop target
  // so the sidebar stops feeling decorative.
  const acceptsDrop = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("application/x-drive-move");

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropActive(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!acceptsDrop(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropActive(false);
      const raw = e.dataTransfer.getData("application/x-drive-move");
      if (!raw) return;
      try {
        const { paths } = JSON.parse(raw) as { paths: string[] };
        for (const p of paths) {
          if (p === node.path) continue;
          // Refuse moving an ancestor folder into its own descendant — it
          // would orphan the subtree. The backend would also reject, but
          // catching here avoids the toast on a predictable mis-drop.
          if (node.path !== "" && node.path.startsWith(`${p}/`)) continue;
          const name = p.split("/").pop() ?? p;
          const dst = node.path ? `${node.path}/${name}` : name;
          await drive.move(p, dst);
        }
        // Expand the destination after a successful drop so the user can
        // see where their files landed without re-clicking.
        if (hasChildren && !expanded) setExpanded(true);
      } catch (err) {
        silentCatch("drive:sidebar-drop")(err);
      }
    },
    [drive, node.path, hasChildren, expanded],
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          drive.navigate(node.path);
          if (hasChildren && !expanded) setExpanded(true);
        }}
        onDoubleClick={toggle}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group relative w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-input text-left typo-body transition-all ${
          dropActive
            ? "bg-cyan-500/30 ring-1 ring-cyan-400/60 text-cyan-50 shadow-[inset_0_0_12px_rgba(34,211,238,0.4)]"
            : isActive
              ? "bg-gradient-to-r from-cyan-500/20 via-cyan-500/10 to-transparent text-cyan-100 shadow-[inset_2px_0_0_rgba(34,211,238,0.8)]"
              : "text-foreground hover:bg-secondary/50 hover:text-foreground"
        }`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        {/* Indent guides */}
        {Array.from({ length: depth }).map((_, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-primary/10"
            style={{ left: `${14 + i * 14}px` }}
          />
        ))}
        {hasChildren ? (
          <span
            onClick={toggle}
            className={`flex items-center justify-center w-3.5 h-3.5 rounded hover:bg-primary/10 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          >
            <ChevronRight className="w-3 h-3" />
          </span>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        {expanded && hasChildren ? (
          <FolderOpen
            className={`w-3.5 h-3.5 flex-shrink-0 ${
              isActive ? "text-cyan-300" : "text-sky-400/80"
            }`}
          />
        ) : (
          <Folder
            className={`w-3.5 h-3.5 flex-shrink-0 ${
              isActive ? "text-cyan-300" : "text-sky-400/70"
            }`}
          />
        )}
        <span className="truncate">{node.name || t.plugins.drive.sidebar_root_fallback}</span>
      </button>
      {expanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            drive={drive}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}
