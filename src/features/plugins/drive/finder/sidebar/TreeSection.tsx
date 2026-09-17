import { useMemo } from "react";

import type { DriveTreeNode } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";

import type { DriveApi } from "../types";
import { TRASH_PATH } from "./LocationsSection";
import { TreeNode } from "./TreeNode";

interface Props {
  drive: DriveApi;
  activeDragCount: number | null;
  onExternalFolderDragOver: (path: string | null) => void;
}

const GHOST_WIDTHS = ["w-24", "w-16", "w-20"];

/** Folder tree from `drive.tree` (trash hidden — it has its own location row). */
export function TreeSection({ drive, activeDragCount, onExternalFolderDragOver }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;

  const tree = useMemo<DriveTreeNode | null>(() => {
    if (!drive.tree) return null;
    return { ...drive.tree, children: drive.tree.children.filter((c) => c.path !== TRASH_PATH) };
  }, [drive.tree]);

  return (
    <section aria-label={f.tree_section} className="px-2 pt-3">
      <div className="px-2 mb-1 typo-label text-foreground">{f.tree_section}</div>
      {tree ? (
        <div role="tree" aria-label={f.tree_section}>
          <TreeNode
            node={tree}
            drive={drive}
            depth={0}
            initiallyOpen
            activeDragCount={activeDragCount}
            onExternalFolderDragOver={onExternalFolderDragOver}
          />
        </div>
      ) : (
        // Cold-fetch ghost (docs/design/overview-loading.md): delayed entry so
        // a fast tree fetch never paints a placeholder.
        <div aria-hidden="true">
          {GHOST_WIDTHS.map((w, i) => (
            <div
              key={w}
              className="flex items-center gap-1.5 py-1.5 px-2 animate-fade-in"
              style={{ animationDelay: `${120 + i * 35}ms` }}
            >
              <span className="w-3.5 h-3.5 rounded-interactive bg-primary/[0.06] flex-shrink-0" />
              <span className={`h-3 ${w} rounded-interactive bg-primary/[0.06]`} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
