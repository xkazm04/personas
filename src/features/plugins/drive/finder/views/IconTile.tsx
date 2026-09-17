import { useRef } from "react";
import { File as FileIcon, FileSignature, Folder as FolderIcon } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import type { FinderViewProps } from "../types";
import { InlineNameInput } from "./InlineNameInput";
import { kindVisual } from "./kindVisual";
import { entryStateClass, selectByClick, selectForContextMenu } from "./selection";
import { TagDots } from "./TagDots";
import type { EntryDnD } from "./useEntryDnD";
import { useThumbnail } from "./useThumbnail";

/** Tile geometry shared with the icons-view virtualizer. */
export const TILE_MIN_W = 120;
export const TILE_H = 168;
export const TILE_GAP = 12;

const TILE_BOX =
  "flex flex-col items-center gap-2 p-2 rounded-card border border-transparent cursor-default transition-colors duration-150";
const THUMB_BOX =
  "w-24 h-24 rounded-card bg-secondary/30 flex items-center justify-center overflow-hidden";

function TileVisual({ entry }: { entry: DriveEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  const { url } = useThumbnail(entry, 256, ref);
  const { Icon, tint } = kindVisual(entry);
  return (
    <div ref={ref} className={THUMB_BOX}>
      {url ? (
        <img src={url} alt="" draggable={false} className="w-full h-full object-cover" />
      ) : (
        <Icon className={`w-10 h-10 ${tint}`} aria-hidden />
      )}
    </div>
  );
}

export function IconTile({
  view,
  entry,
  dnd,
}: {
  view: FinderViewProps;
  entry: DriveEntry;
  dnd: EntryDnD;
}) {
  const { t } = useTranslation();
  const { drive, meta, signedPaths } = view;
  const selected = drive.isSelected(entry.path);
  const flash = drive.recentlyWritten.has(entry.path);
  const renaming = view.inlineRenamingPath === entry.path;
  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid="finder-icon-tile"
      data-path={entry.path}
      style={{ height: TILE_H }}
      {...dnd.handlers(entry)}
      onClick={(e) => selectByClick(drive, entry, e)}
      onDoubleClick={() => view.onOpen(entry)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        selectForContextMenu(drive, entry);
        view.onContextMenu(entry, e.clientX, e.clientY);
      }}
      className={`${TILE_BOX} ${entryStateClass(selected, flash)} ${dnd.dropClass(entry)}`}
    >
      <TileVisual entry={entry} />
      {renaming ? (
        <InlineNameInput
          initialName={entry.name}
          className="w-full text-center"
          onCommit={(name) => view.onCommitInlineRename(entry.path, name)}
          onCancel={view.onCancelInlineRename}
        />
      ) : (
        <span
          className="w-full typo-body text-foreground text-center line-clamp-2 break-words leading-tight"
          title={entry.name}
        >
          {entry.name}
        </span>
      )}
      <span className="flex items-center gap-1 h-3">
        <TagDots tags={meta.tagsFor(entry.path)} />
        {signedPaths.has(entry.path) && (
          <FileSignature className="w-3 h-3 text-primary" aria-label={t.plugins.drive.signed} />
        )}
      </span>
    </div>
  );
}

/** Phantom tile for a pending create. */
export function PhantomTile({
  kind,
  onCommit,
  onCancel,
}: {
  kind: "folder" | "file";
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const Icon = kind === "folder" ? FolderIcon : FileIcon;
  return (
    <div
      data-testid="finder-phantom-tile"
      style={{ height: TILE_H }}
      className={`${TILE_BOX} bg-primary/5 ring-1 ring-primary/40`}
    >
      <div className={THUMB_BOX}>
        <Icon className={`w-10 h-10 ${kind === "folder" ? "text-primary" : "text-foreground"}`} />
      </div>
      <InlineNameInput initialName="" className="w-full text-center" onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}
