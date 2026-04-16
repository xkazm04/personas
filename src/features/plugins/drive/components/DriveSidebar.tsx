import { useState, useCallback } from "react";
import { ChevronRight, Folder, FolderOpen, HardDrive, Sparkles } from "lucide-react";

import type { DriveTreeNode } from "@/api/drive";
import { driveFormatBytes } from "@/api/drive";
import type { UseDriveResult } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";

interface Props {
  drive: UseDriveResult;
}

/** Visual-only cap for the storage meter. Real drives are unbounded. */
const STORAGE_METER_CAP_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export function DriveSidebar({ drive }: Props) {
  const { t, tx } = useTranslation();

  return (
    <aside className="w-60 flex-shrink-0 border-r border-primary/10 bg-gradient-to-b from-background via-background to-background/60 flex flex-col">
      {/* Brand header */}
      <div className="relative px-4 py-3 border-b border-primary/10 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-sky-500/5 to-transparent pointer-events-none"
        />
        <div className="relative flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/25 to-sky-500/5 border border-cyan-500/30 flex items-center justify-center shadow-[0_0_20px_-6px_rgba(14,165,233,0.6)]">
            <HardDrive className="w-4 h-4 text-cyan-200" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="typo-body font-semibold text-foreground tracking-tight">
              {t.plugins.drive.sidebar_root}
            </div>
            <div className="typo-body text-foreground/90">
              {drive.storage?.isDev
                ? t.plugins.drive.dev_badge
                : "Managed local"}
            </div>
          </div>
          {drive.storage?.isDev && (
            <span className="px-1.5 py-0.5 rounded typo-body font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
              dev
            </span>
          )}
        </div>
      </div>

      {/* Folder tree */}
      <div className="flex-1 overflow-y-auto py-2 px-1">
        <div className="px-2 mb-1 typo-body font-semibold text-foreground/90 uppercase tracking-wider">
          Folders
        </div>
        {drive.tree ? (
          <TreeNode node={drive.tree} drive={drive} depth={0} initiallyOpen />
        ) : (
          <div className="px-3 py-2 typo-body text-foreground/90">
            {t.plugins.drive.loading}
          </div>
        )}
      </div>

      {/* Storage meter */}
      {drive.storage && (
        <div className="border-t border-primary/10 px-4 py-3 bg-background/40">
          <div className="flex items-center justify-between mb-1.5">
            <div className="typo-body font-semibold text-foreground/90 uppercase tracking-wider">
              {t.plugins.drive.sidebar_storage}
            </div>
            <Sparkles className="w-3 h-3 text-cyan-400/70" />
          </div>
          <StorageMeter
            usedBytes={drive.storage.usedBytes}
            capBytes={STORAGE_METER_CAP_BYTES}
          />
          <div className="mt-1.5 typo-body text-foreground/90">
            {tx(t.plugins.drive.storage_used, {
              used: driveFormatBytes(drive.storage.usedBytes),
              count: drive.storage.entryCount,
            })}
          </div>
          <div
            className="mt-1 typo-body text-foreground/90 font-mono truncate"
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
  const [expanded, setExpanded] = useState(initiallyOpen);
  const isActive = drive.currentPath === node.path;
  const hasChildren = node.children.length > 0 || node.hasMoreChildren;

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          drive.navigate(node.path);
          if (hasChildren && !expanded) setExpanded(true);
        }}
        onDoubleClick={toggle}
        className={`group relative w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-left typo-body transition-all ${
          isActive
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
        <span className="truncate">{node.name || "Drive"}</span>
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
