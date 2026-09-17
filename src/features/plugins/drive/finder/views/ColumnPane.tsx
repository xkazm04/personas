import { useEffect, useState } from "react";
import { ChevronRight, File as FileIcon, Folder as FolderIcon } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { driveList } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import type { FinderViewProps } from "../types";
import { FinderGhost } from "./FinderEmpty";
import { InlineNameInput } from "./InlineNameInput";
import { kindVisual } from "./kindVisual";
import { selectForContextMenu } from "./selection";
import { TagDots } from "./TagDots";
import type { EntryDnD } from "./useEntryDnD";

export const PANE_W = 240;
const ROW = "w-full flex items-center gap-2 px-2.5 py-1.5 typo-body text-left cursor-default";

function PaneRow({
  view,
  entry,
  dnd,
  active,
}: {
  view: FinderViewProps;
  entry: DriveEntry;
  dnd: EntryDnD;
  /** This folder is the one the next pane shows. */
  active: boolean;
}) {
  const { drive, meta } = view;
  const { Icon, tint } = kindVisual(entry);
  const selected = drive.isSelected(entry.path);
  const renaming = view.inlineRenamingPath === entry.path;
  const state = active
    ? "bg-primary/15 text-foreground"
    : selected
      ? "bg-primary/15 ring-1 ring-primary/40"
      : drive.recentlyWritten.has(entry.path)
        ? "bg-status-success/15"
        : "hover:bg-secondary/30";
  return (
    <div
      role="option"
      aria-selected={selected || active}
      data-testid="finder-column-row"
      data-path={entry.path}
      {...dnd.handlers(entry)}
      onClick={() => (entry.kind === "folder" ? drive.navigate(entry.path) : drive.selectOnly(entry.path))}
      onDoubleClick={() => view.onOpen(entry)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        selectForContextMenu(drive, entry);
        view.onContextMenu(entry, e.clientX, e.clientY);
      }}
      className={`${ROW} ${state} ${dnd.dropClass(entry)}`}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 ${tint}`} aria-hidden />
      {renaming ? (
        <InlineNameInput
          initialName={entry.name}
          className="flex-1"
          onCommit={(name) => view.onCommitInlineRename(entry.path, name)}
          onCancel={view.onCancelInlineRename}
        />
      ) : (
        <span className="truncate flex-1 text-foreground">{entry.name}</span>
      )}
      <TagDots tags={meta.tagsFor(entry.path)} />
      {entry.kind === "folder" && (
        <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-foreground" aria-hidden />
      )}
    </div>
  );
}

/**
 * One Miller column. The current folder's pane renders the engine's
 * `visibleEntries`; ancestor panes read the engine's per-path cache and fall
 * back to one `driveList` call.
 */
export function ColumnPane({
  view,
  path,
  activeChild,
  dnd,
}: {
  view: FinderViewProps;
  path: string;
  activeChild: string | null;
  dnd: EntryDnD;
}) {
  const { t } = useTranslation();
  const { drive, pendingCreate } = view;
  const isCurrent = path === drive.currentPath;
  const { cachedEntriesFor } = drive;
  const [loaded, setLoaded] = useState<{ path: string; entries: DriveEntry[] } | null>(null);

  useEffect(() => {
    if (isCurrent) return;
    const seed = cachedEntriesFor(path);
    if (seed) {
      setLoaded({ path, entries: seed });
      return;
    }
    let cancelled = false;
    driveList(path)
      .then((list) => {
        if (!cancelled) setLoaded({ path, entries: list });
      })
      .catch((err: unknown) => {
        silentCatch("drive:finder-column")(err);
        if (!cancelled) setLoaded({ path, entries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isCurrent, path, cachedEntriesFor]);

  const entries = isCurrent ? drive.visibleEntries : loaded?.path === path ? loaded.entries : null;
  const ghosting = isCurrent ? drive.loading && drive.entries.length === 0 : entries === null;

  return (
    <div
      role="listbox"
      data-testid="finder-column-pane"
      data-path={path}
      style={{ width: PANE_W }}
      className="flex-shrink-0 h-full overflow-y-auto border-r border-border bg-background"
    >
      {isCurrent && pendingCreate && (
        <div className={`${ROW} bg-primary/5 ring-1 ring-primary/40`} data-testid="finder-phantom-row">
          {pendingCreate === "folder" ? (
            <FolderIcon className="w-4 h-4 text-primary flex-shrink-0" />
          ) : (
            <FileIcon className="w-4 h-4 text-foreground flex-shrink-0" />
          )}
          <InlineNameInput
            initialName=""
            className="flex-1"
            onCommit={view.onCommitPendingCreate}
            onCancel={view.onCancelPendingCreate}
          />
        </div>
      )}
      {ghosting ? (
        <FinderGhost rows={4} rowHeight={32} />
      ) : (
        (entries ?? []).map((entry) => (
          <PaneRow
            key={entry.path}
            view={view}
            entry={entry}
            dnd={dnd}
            active={entry.path === activeChild}
          />
        ))
      )}
      {!ghosting && (entries?.length ?? 0) === 0 && !pendingCreate && (
        <div className="px-3 py-4 typo-caption text-foreground text-center">
          {t.plugins.drive.finder.columns_empty}
        </div>
      )}
    </div>
  );
}
