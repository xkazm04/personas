import { useState, useCallback } from "react";
import { ChevronRight, Folder, FolderOpen, HardDrive } from "lucide-react";

import type { DriveTreeNode } from "@/api/drive";
import { driveFormatBytes } from "@/api/drive";
import type { UseDriveResult } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";

interface Props {
  drive: UseDriveResult;
}

export function DriveSidebar({ drive }: Props) {
  const { t, tx } = useTranslation();

  return (
    <aside className="w-60 flex-shrink-0 border-r border-primary/10 bg-background/40 flex flex-col">
      <div className="px-3 py-2 border-b border-primary/10 flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-sky-400" />
        <span className="typo-caption font-semibold text-foreground/80">
          {t.plugins.drive.sidebar_root}
        </span>
        {drive.storage?.isDev && (
          <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">
            {t.plugins.drive.dev_badge}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {drive.tree && (
          <TreeNode
            node={drive.tree}
            drive={drive}
            depth={0}
            initiallyOpen
          />
        )}
      </div>

      {drive.storage && (
        <div className="border-t border-primary/10 px-3 py-2">
          <div className="typo-caption font-semibold text-foreground/70 mb-1.5">
            {t.plugins.drive.sidebar_storage}
          </div>
          <div className="typo-caption-sm text-foreground/60">
            {tx(t.plugins.drive.storage_used, {
              used: driveFormatBytes(drive.storage.usedBytes),
              count: drive.storage.entryCount,
            })}
          </div>
          <div
            className="mt-1 text-[10px] text-foreground/40 font-mono truncate"
            title={drive.storage.root}
          >
            {drive.storage.root}
          </div>
        </div>
      )}
    </aside>
  );
}

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

  const toggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded((v) => !v);
    },
    [],
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          drive.navigate(node.path);
          if (hasChildren && !expanded) setExpanded(true);
        }}
        onDoubleClick={toggle}
        className={`w-full flex items-center gap-1 py-1 pr-2 text-left typo-caption transition-colors ${
          isActive
            ? "bg-sky-500/15 text-sky-400"
            : "text-foreground/70 hover:bg-secondary/40 hover:text-foreground"
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <ChevronRight
            className={`w-3 h-3 flex-shrink-0 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
            onClick={toggle}
          />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {expanded && hasChildren ? (
          <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <Folder className="w-3.5 h-3.5 flex-shrink-0" />
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
