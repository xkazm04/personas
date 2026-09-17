import { useEffect, useMemo, useState } from "react";
import { Folder, MapPin } from "lucide-react";

import { driveParentPath, type DriveTreeNode } from "@/api/drive";
import { toastCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import { QuickEditPopover } from "@/features/shared/components/overlays/QuickEditPopover";

import { TRASH_PATH } from "../sidebar/LocationsSection";
import type { DriveApi } from "../types";

interface Props {
  drive: DriveApi;
  /** Trigger rect (toolbar button or context-menu point); null = closed. */
  anchor: DOMRect | null;
  onClose: () => void;
}

/**
 * Pointer-free move (drag-drop standard: every drop target reachable without
 * a pointer). Flattened tree, minus the selection itself, its descendants
 * and the trash — one guard for every move surface — plus the
 * open folder first ("This folder", for the tagged view where the selection
 * may live elsewhere). Pick, then Save / ⌘Enter commits via `moveManyInto`.
 */
export function FinderMoveTo({ drive, anchor, onClose }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  const paths = useMemo(() => Array.from(drive.selection), [drive.selection]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!anchor) setPicked(null);
  }, [anchor]);

  const candidates = useMemo(() => {
    const out: Array<{ path: string; label: string; depth: number }> = [];
    const invalid = (p: string) =>
      p === TRASH_PATH ||
      p.startsWith(`${TRASH_PATH}/`) ||
      paths.some((s) => p === s || (s !== "" && p.startsWith(`${s}/`)));
    const allHere = paths.length > 0 && paths.every((p) => driveParentPath(p) === drive.currentPath);
    if (!invalid(drive.currentPath) && !allHere) {
      out.push({ path: drive.currentPath, label: f.move_to_here, depth: -1 });
    }
    const walk = (node: DriveTreeNode, depth: number) => {
      if (!invalid(node.path) && node.path !== drive.currentPath) {
        out.push({ path: node.path, label: node.name || f.breadcrumb_root, depth });
      }
      for (const child of node.children) walk(child, depth + 1);
    };
    if (drive.tree) walk(drive.tree, 0);
    return out;
  }, [drive.tree, drive.currentPath, paths, f]);

  const commit = () => {
    if (picked === null || saving) return;
    setSaving(true);
    drive
      .moveManyInto(paths, picked)
      .then(() => {
        drive.clearSelection();
        onClose();
      })
      .catch(toastCatch("finder:move-to"))
      .finally(() => setSaving(false));
  };

  return (
    <QuickEditPopover
      open={anchor !== null}
      anchor={anchor}
      title={tx(f.move_to_title, { count: paths.length })}
      onClose={onClose}
      onSave={commit}
      saving={saving}
      canSave={picked !== null}
    >
      <div role="radiogroup" aria-label={f.move_to} className="max-h-64 overflow-y-auto -mx-1">
        {candidates.length === 0 ? (
          <p className="px-2 py-3 typo-caption text-foreground text-center">{t.plugins.drive.move_to_no_destinations}</p>
        ) : (
          candidates.map((c) => {
            const active = picked === c.path;
            return (
              <button
                key={c.path || "__root__"}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPicked(c.path)}
                onDoubleClick={() => {
                  setPicked(c.path);
                  commit();
                }}
                className={`w-full flex items-center gap-2 py-1 pr-2 rounded-input text-left typo-body transition-colors duration-fast focus-ring ${
                  active ? "bg-primary/15 ring-1 ring-primary/40 text-foreground" : "text-foreground hover:bg-secondary/50"
                }`}
                style={{ paddingLeft: `${8 + Math.max(0, c.depth) * 14}px` }}
              >
                {c.depth < 0 ? (
                  <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
                )}
                <span className="truncate">{c.label}</span>
              </button>
            );
          })
        )}
      </div>
    </QuickEditPopover>
  );
}
