import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

import type { DriveEntry } from "@/api/drive";
import { driveFormatBytes } from "@/api/drive";
import { Numeric } from "@/features/shared/components/display/Numeric";
import { useTranslation } from "@/i18n/useTranslation";
import type { DriveApi, FinderViewProps } from "../types";
import { ColumnPane, PANE_W } from "./ColumnPane";
import { FinderEmpty } from "./FinderEmpty";
import { kindLabelFor, kindVisual } from "./kindVisual";
import { RecursiveResults } from "./RecursiveResults";
import { firstSelected } from "./selection";
import { useEntryDnD } from "./useEntryDnD";
import { useThumbnail } from "./useThumbnail";

/** Root, every ancestor, then the current folder — one pane each. */
export function columnLevels(currentPath: string): string[] {
  const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];
  return ["", ...segments.map((_, i) => segments.slice(0, i + 1).join("/"))];
}

/** Compact preview of the selected file in the rightmost column. */
function ColumnPreview({ entry }: { entry: DriveEntry }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { url } = useThumbnail(entry, 256, ref);
  const { Icon, tint } = kindVisual(entry);
  return (
    <div
      ref={ref}
      data-testid="finder-column-preview"
      style={{ width: PANE_W }}
      className="flex-shrink-0 h-full overflow-y-auto p-4 flex flex-col items-center gap-3 bg-background"
    >
      <div className="w-40 h-40 rounded-card bg-secondary/30 flex items-center justify-center overflow-hidden">
        {url ? (
          <img src={url} alt="" draggable={false} className="w-full h-full object-cover" />
        ) : (
          <Icon className={`w-14 h-14 ${tint}`} aria-hidden />
        )}
      </div>
      <div className="w-full text-center typo-title text-foreground break-words">{entry.name}</div>
      <div className="w-full grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 typo-caption">
        <span className="text-foreground">{t.plugins.drive.finder.insp_kind}</span>
        <span className="text-foreground truncate">{kindLabelFor(t, entry)}</span>
        <span className="text-foreground">{t.plugins.drive.finder.insp_size}</span>
        <Numeric className="text-foreground">{driveFormatBytes(entry.size)}</Numeric>
      </div>
    </div>
  );
}

/** ↑/↓ step the selection in the current pane; → enters a selected folder; ← steps up. */
export function columnsKeyNav(drive: DriveApi, key: string): boolean {
  const entries = drive.visibleEntries;
  const current = firstSelected(drive, entries);
  if (key === "ArrowDown" || key === "ArrowUp") {
    if (entries.length === 0) return false;
    const idx = current ? entries.indexOf(current) : -1;
    const next = key === "ArrowDown" ? Math.min(idx + 1, entries.length - 1) : Math.max(idx - 1, 0);
    const target = entries[next];
    if (target) drive.selectOnly(target.path);
    return true;
  }
  if (key === "ArrowRight") {
    if (current?.kind === "folder") drive.navigate(current.path);
    else if (!current && entries[0]) drive.selectOnly(entries[0].path);
    return true;
  }
  if (key === "ArrowLeft") {
    if (!drive.currentPath) return false;
    const leaving = drive.currentPath;
    drive.goUp();
    queueMicrotask(() => drive.selectOnly(leaving));
    return true;
  }
  return false;
}

export function ColumnsView(props: FinderViewProps) {
  const { drive, pendingCreate } = props;
  const dnd = useEntryDnD(props);
  const stripRef = useRef<HTMLDivElement>(null);
  const levels = columnLevels(drive.currentPath);

  // Keep the newest pane in view as the path deepens.
  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [drive.currentPath]);

  if (drive.recursiveResults !== null || drive.recursiveLoading) {
    return <RecursiveResults view={props} />;
  }
  if (drive.error) return <FinderEmpty variant="unreadable" drive={drive} />;
  if (!drive.loading && drive.visibleEntries.length === 0 && levels.length === 1 && !pendingCreate) {
    return (
      <FinderEmpty
        variant={drive.searchQuery.trim().length >= 2 ? "search-empty" : "empty"}
        drive={drive}
        onRequestCreate={props.onRequestCreate}
      />
    );
  }

  const selected = firstSelected(drive, drive.visibleEntries);
  const preview = selected && selected.kind === "file" && drive.selection.size === 1 ? selected : null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName === "INPUT") return;
    if (columnsKeyNav(drive, e.key)) e.preventDefault();
  };

  return (
    <div
      ref={stripRef}
      tabIndex={0}
      role="tree"
      data-testid="finder-view-ColumnsView"
      className="flex-1 min-h-0 flex overflow-x-auto bg-background focus-visible:ring-2 focus-visible:ring-primary/60 outline-none"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu(null, e.clientX, e.clientY);
      }}
    >
      {levels.map((path, i) => (
        <ColumnPane
          key={path || "/"}
          view={props}
          path={path}
          activeChild={levels[i + 1] ?? null}
          dnd={dnd}
        />
      ))}
      {preview && <ColumnPreview entry={preview} />}
    </div>
  );
}
