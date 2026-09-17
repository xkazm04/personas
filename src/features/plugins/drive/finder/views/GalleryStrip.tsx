import { useEffect, useRef } from "react";

import type { DriveEntry } from "@/api/drive";
import type { FinderViewProps } from "../types";
import { kindVisual } from "./kindVisual";
import { selectByClick, selectForContextMenu } from "./selection";
import type { EntryDnD } from "./useEntryDnD";
import { useThumbnail } from "./useThumbnail";

function StripThumb({
  view,
  entry,
  dnd,
  current,
}: {
  view: FinderViewProps;
  entry: DriveEntry;
  dnd: EntryDnD;
  /** The entry the hero shows. */
  current: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { url } = useThumbnail(entry, 96, ref);
  const { Icon, tint } = kindVisual(entry);
  const { drive } = view;
  const selected = drive.isSelected(entry.path);
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      data-testid="finder-gallery-thumb"
      data-path={entry.path}
      aria-label={entry.name}
      {...dnd.handlers(entry)}
      onClick={(e) => selectByClick(drive, entry, e)}
      onDoubleClick={() => view.onOpen(entry)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        selectForContextMenu(drive, entry);
        view.onContextMenu(entry, e.clientX, e.clientY);
      }}
      className={`w-24 h-24 flex-shrink-0 rounded-card overflow-hidden flex items-center justify-center bg-secondary/30 cursor-default transition-colors duration-150 ${
        selected || current
          ? "ring-2 ring-primary/60"
          : drive.recentlyWritten.has(entry.path)
            ? "bg-status-success/15"
            : "hover:bg-secondary/50"
      } ${dnd.dropClass(entry)}`}
    >
      {url ? (
        <img src={url} alt="" draggable={false} className="w-full h-full object-cover" />
      ) : (
        <Icon className={`w-8 h-8 ${tint}`} aria-hidden />
      )}
    </div>
  );
}

/** Horizontal filmstrip of 96px thumbs; the current tile is kept in view. */
export function GalleryStrip({
  view,
  current,
  dnd,
}: {
  view: FinderViewProps;
  current: DriveEntry | null;
  dnd: EntryDnD;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const currentPath = current?.path ?? null;

  useEffect(() => {
    if (!currentPath || !stripRef.current) return;
    const tile = Array.from(
      stripRef.current.querySelectorAll<HTMLElement>("[data-path]"),
    ).find((el) => el.dataset.path === currentPath);
    tile?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [currentPath]);

  return (
    <div
      ref={stripRef}
      role="listbox"
      aria-multiselectable
      data-testid="finder-gallery-strip"
      className="flex-shrink-0 flex items-center gap-2 px-3 py-2 overflow-x-auto border-t border-border bg-secondary/30"
    >
      {view.drive.visibleEntries.map((entry) => (
        <StripThumb
          key={entry.path}
          view={view}
          entry={entry}
          dnd={dnd}
          current={entry.path === currentPath}
        />
      ))}
    </div>
  );
}
