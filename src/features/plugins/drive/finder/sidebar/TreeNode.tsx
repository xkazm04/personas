import { useCallback, useState } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";

import { driveListTree, type DriveTreeNode } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";

import { parseDriveMovePayload } from "../../hooks/useDrive";
import { DRIVE_MOVE_MIME, type DriveApi } from "../types";

export const hasFilesPayload = (e: React.DragEvent) =>
  e.dataTransfer?.types?.includes("Files") ?? false;
export const hasMovePayload = (e: React.DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes(DRIVE_MOVE_MIME);

interface Props {
  node: DriveTreeNode;
  drive: DriveApi;
  depth: number;
  initiallyOpen?: boolean;
  activeDragCount: number | null;
  onExternalFolderDragOver: (path: string | null) => void;
}

/**
 * One folder row. Children come from `drive.tree` when present; a node the
 * backend truncated (`hasMoreChildren` with no children) is fetched lazily
 * on first expand. Drop target for internal moves and OS-file drags.
 */
export function TreeNode({
  node,
  drive,
  depth,
  initiallyOpen = false,
  activeDragCount,
  onExternalFolderDragOver,
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [dropActive, setDropActive] = useState(false);
  const [lazyChildren, setLazyChildren] = useState<DriveTreeNode[] | null>(null);
  const children = node.children.length > 0 ? node.children : (lazyChildren ?? []);
  const hasChildren = children.length > 0 || node.hasMoreChildren;
  const isActive = drive.currentPath === node.path;

  const expand = useCallback(() => {
    setExpanded(true);
    if (node.children.length === 0 && node.hasMoreChildren && lazyChildren === null) {
      driveListTree(node.path, 1)
        .then((sub) => setLazyChildren(sub.children))
        .catch(silentCatch("finder:tree-lazy"));
    }
  }, [node, lazyChildren]);

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (hasFilesPayload(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropActive(true);
        onExternalFolderDragOver(node.path);
        return;
      }
      if (!hasMovePayload(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropActive(true);
    },
    [node.path, onExternalFolderDragOver],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      setDropActive(false);
      if (hasFilesPayload(e)) onExternalFolderDragOver(null);
    },
    [onExternalFolderDragOver],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      setDropActive(false);
      if (hasFilesPayload(e)) return; // bubbles to the page-level OS drop
      if (!hasMovePayload(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const paths = parseDriveMovePayload(e);
      if (!paths) return;
      drive
        .moveManyInto(paths, node.path)
        .then(() => {
          if (hasChildren) expand();
        })
        .catch(silentCatch("finder:tree-drop"));
    },
    [drive, node.path, hasChildren, expand],
  );

  const stateClass = dropActive
    ? "bg-accent/20 ring-1 ring-accent/60 text-foreground"
    : activeDragCount
      ? "ring-1 ring-accent/20 text-foreground"
      : isActive
        ? "bg-primary/15 ring-1 ring-primary/40 text-foreground"
        : "text-foreground hover:bg-secondary/50";

  return (
    <div role="treeitem" aria-level={depth + 1} aria-expanded={hasChildren ? expanded : undefined} aria-selected={isActive}>
      <button
        type="button"
        onClick={() => {
          drive.navigate(node.path);
          if (hasChildren && !expanded) expand();
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative w-full flex items-center gap-1.5 py-1 pr-2 rounded-input text-left typo-body transition-colors duration-fast focus-ring ${stateClass}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {Array.from({ length: depth }).map((_, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-border"
            style={{ left: `${13 + i * 14}px` }}
          />
        ))}
        {hasChildren ? (
          <span
            role="presentation"
            onClick={(e) => {
              e.stopPropagation();
              if (expanded) setExpanded(false);
              else expand();
            }}
            className={`flex items-center justify-center w-3.5 h-3.5 rounded-interactive hover:bg-primary/10 transition-transform duration-fast ${expanded ? "rotate-90" : ""}`}
          >
            <ChevronRight className="w-3 h-3" />
          </span>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        {expanded && hasChildren ? (
          <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
        ) : (
          <Folder className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
        )}
        <span className="truncate flex-1">{node.name || t.plugins.drive.finder.breadcrumb_root}</span>
        {dropActive && activeDragCount ? (
          <span className="typo-caption tabular-nums px-1.5 rounded-full bg-accent/30 text-foreground">
            {activeDragCount}
          </span>
        ) : null}
      </button>
      {expanded && children.length > 0 && (
        <div role="group">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              drive={drive}
              depth={depth + 1}
              activeDragCount={activeDragCount}
              onExternalFolderDragOver={onExternalFolderDragOver}
            />
          ))}
        </div>
      )}
    </div>
  );
}
