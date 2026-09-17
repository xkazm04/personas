import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { FinderViewProps } from "../types";
import { FinderEmpty, FinderGhost, finderEmptyVariant } from "./FinderEmpty";
import { IconTile, PhantomTile, TILE_GAP, TILE_H, TILE_MIN_W } from "./IconTile";
import { RecursiveResults } from "./RecursiveResults";
import { useEntryDnD } from "./useEntryDnD";

/** Past this many entries the grid is virtualized by rows. */
export const VIRTUALIZE_ABOVE = 400;
const PAD = 16;

export function columnsForWidth(width: number): number {
  return Math.max(1, Math.floor((width - PAD * 2 + TILE_GAP) / (TILE_MIN_W + TILE_GAP)));
}

/**
 * Icon grid: `repeat(auto-fill, minmax(120px, 1fr))` tiles with a 96px
 * thumbnail; large folders switch to a row-virtualized grid whose column
 * count is derived from the container width.
 */
export function IconsView(props: FinderViewProps) {
  const { drive, pendingCreate } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const dnd = useEntryDnD(props);
  const [width, setWidth] = useState(0);

  const entries = drive.visibleEntries;
  const virtual = entries.length > VIRTUALIZE_ABOVE;
  const cols = columnsForWidth(width);
  const rowCount = virtual ? Math.ceil((entries.length + (pendingCreate ? 1 : 0)) / cols) : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((records) => {
      const w = records[0]?.contentRect.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TILE_H + TILE_GAP,
    overscan: 3,
    enabled: virtual,
  });

  const { currentPath, loading, recallScroll } = drive;
  useEffect(() => {
    if (loading) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = recallScroll(currentPath);
  }, [currentPath, loading, recallScroll]);

  if (drive.recursiveResults !== null || drive.recursiveLoading) {
    return <RecursiveResults view={props} />;
  }
  const state = finderEmptyVariant(drive, pendingCreate);

  // Tiles in visual order; the phantom tile leads when a create is pending.
  const tiles = [
    ...(pendingCreate
      ? [
          <PhantomTile
            key="__phantom"
            kind={pendingCreate}
            onCommit={props.onCommitPendingCreate}
            onCancel={props.onCancelPendingCreate}
          />,
        ]
      : []),
    ...entries.map((entry) => <IconTile key={entry.path} view={props} entry={entry} dnd={dnd} />),
  ];

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-multiselectable
      data-testid="finder-view-IconsView"
      className="flex-1 min-h-0 overflow-auto bg-background"
      style={{ padding: state === null ? PAD : 0 }}
      onScroll={(e) => {
        if (!loading) drive.rememberScroll(currentPath, e.currentTarget.scrollTop);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu(null, e.clientX, e.clientY);
      }}
    >
      {state === "ghost" ? (
        <FinderGhost rows={6} rowHeight={56} />
      ) : state !== null ? (
        <FinderEmpty variant={state} drive={drive} />
      ) : !virtual ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))]"
          style={{ gap: TILE_GAP }}
        >
          {tiles}
        </div>
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className="absolute left-0 w-full grid"
              style={{
                transform: `translateY(${row.start}px)`,
                gap: TILE_GAP,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {tiles.slice(row.index * cols, row.index * cols + cols)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
