import { useCallback, useState } from "react";
import { ChevronRight, HardDrive, Pencil } from "lucide-react";

import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import Button from "@/features/shared/components/buttons/Button";

import { parseDriveMovePayload } from "../../hooks/useDrive";
import { MOD_KEY_LABEL } from "../FinderKeymap";
import { hasMovePayload } from "../sidebar/TreeNode";
import type { DriveApi } from "../types";

interface Props {
  drive: DriveApi;
  activeDragCount: number | null;
  /** Pencil affordance: swap the trail for the path input (Mod+L does the same). */
  onEditPath: () => void;
}

/**
 * Path segments as ghost buttons; every non-current segment is a drop target
 * for internal moves (`moveManyInto` — self-skip + ancestor guard live there).
 */
export function FinderBreadcrumb({ drive, activeDragCount, onEditPath }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  // Empty string is the root path, so `null` is the only idle sentinel.
  const [dropOver, setDropOver] = useState<string | null>(null);

  const onDragOver = useCallback((e: React.DragEvent, target: string) => {
    if (!hasMovePayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropOver(target);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent, target: string) => {
      if (!hasMovePayload(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropOver(null);
      const paths = parseDriveMovePayload(e);
      if (paths) drive.moveManyInto(paths, target).catch(silentCatch("finder:breadcrumb-drop"));
    },
    [drive],
  );

  const segments = drive.currentPath ? drive.currentPath.split("/").filter(Boolean) : [];
  const crumbs = [
    { path: "", label: f.breadcrumb_root, icon: <HardDrive className="w-3.5 h-3.5" /> },
    ...segments.map((seg, i) => ({
      path: segments.slice(0, i + 1).join("/"),
      label: seg,
      icon: undefined as React.ReactNode,
    })),
  ];

  return (
    <nav
      aria-label={f.breadcrumb_aria}
      className="flex items-center gap-0.5 min-w-0 flex-1 px-1.5 py-0.5 rounded-card bg-secondary/30 border border-border"
    >
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        const over = dropOver === crumb.path;
        const stateClass = over
          ? "bg-accent/20 ring-1 ring-accent/60"
          : !isLast && activeDragCount
            ? "ring-1 ring-accent/20"
            : "";
        return (
          <span key={crumb.path || "__root__"} className="flex items-center gap-0.5 min-w-0">
            {i > 0 && <ChevronRight className="w-3 h-3 flex-shrink-0 text-foreground" aria-hidden />}
            <span
              onDragOver={(e) => !isLast && onDragOver(e, crumb.path)}
              onDragLeave={() => setDropOver(null)}
              onDrop={(e) => !isLast && onDrop(e, crumb.path)}
              className="min-w-0"
            >
              <Button
                variant="ghost"
                size="xs"
                icon={crumb.icon}
                aria-current={isLast ? "location" : undefined}
                onClick={() => drive.navigate(crumb.path)}
                className={`max-w-[160px] ${isLast ? "typo-card-label" : ""} ${stateClass}`}
              >
                <span className="truncate">{crumb.label}</span>
                {over && activeDragCount ? (
                  <span className="typo-caption tabular-nums px-1.5 rounded-full bg-accent/30">
                    {activeDragCount}
                  </span>
                ) : null}
              </Button>
            </span>
          </span>
        );
      })}
      <span className="ml-auto flex-shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={f.path_edit}
          title={`${f.path_edit} (${MOD_KEY_LABEL}+L)`}
          onClick={onEditPath}
        >
          <Pencil className="w-3 h-3" />
        </Button>
      </span>
    </nav>
  );
}
