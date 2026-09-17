import { useEffect, useMemo, useRef } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";

import ScenarioEmptyState from "@/features/shared/components/feedback/ScenarioEmptyState";
import { useTranslation } from "@/i18n/useTranslation";
import { kindGroupLabel } from "../../designTokens";
import type { FinderViewProps } from "../types";
import { FinderGhost } from "./FinderGhost";
import { FINDER_SCENARIO_BOX, finderScenario, finderScenarioTestId, finderEmptyVariant } from "./finderScenario";
import { ListHeader } from "./ListHeader";
import { ListRow, PhantomRow } from "./ListRow";
import {
  GROUP_H,
  HEADER_H,
  activeHeaderIndex,
  buildListItems,
  headerIndexes,
  itemSize,
} from "./listGrouping";
import { RecursiveResults } from "./RecursiveResults";
import { useEntryDnD } from "./useEntryDnD";

/**
 * Virtualized list: 36px rows under a sticky column header; when the engine
 * sorts by kind, a sticky group header with the bucket count leads every run.
 */
export function ListView(props: FinderViewProps) {
  const { drive, pendingCreate } = props;
  const { t, tx } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dnd = useEntryDnD(props);

  const grouped = drive.sortKey === "kind";
  const items = useMemo(
    () => buildListItems(drive.visibleEntries, grouped),
    [drive.visibleEntries, grouped],
  );
  const headers = useMemo(() => headerIndexes(items), [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => itemSize(items[i]),
    overscan: 12,
    // Keep the governing group header mounted even when scrolled past, so it
    // can pin under the column header (the sticky-header range trick).
    rangeExtractor: (range: Range) => {
      const active = activeHeaderIndex(headers, range.startIndex);
      const base = defaultRangeExtractor(range);
      return active === null || base.includes(active) ? base : [active, ...base];
    },
  });
  const activeSticky = activeHeaderIndex(headers, virtualizer.range?.startIndex ?? 0);

  // Per-folder scroll memory: recall once the folder's entries are in.
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

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-multiselectable
      data-testid="finder-view-ListView"
      className="flex-1 min-h-0 overflow-auto bg-background"
      onScroll={(e) => {
        if (!loading) drive.rememberScroll(currentPath, e.currentTarget.scrollTop);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu(null, e.clientX, e.clientY);
      }}
    >
      <ListHeader drive={drive} />
      {state === "ghost" ? (
        <FinderGhost />
      ) : state !== null ? (
        <div className={FINDER_SCENARIO_BOX} data-testid={finderScenarioTestId(state)}>
          <ScenarioEmptyState {...finderScenario(state, { t, tx, drive, onRequestCreate: props.onRequestCreate })} />
        </div>
      ) : (
        <>
          {pendingCreate && (
            <PhantomRow
              kind={pendingCreate}
              onCommit={props.onCommitPendingCreate}
              onCancel={props.onCancelPendingCreate}
            />
          )}
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const item = items[v.index];
              if (!item) return null;
              const sticky = item.type === "header" && v.index === activeSticky;
              const place = sticky
                ? { position: "sticky" as const, top: HEADER_H, zIndex: 10 }
                : { position: "absolute" as const, top: 0, transform: `translateY(${v.start}px)` };
              if (item.type === "header") {
                return (
                  <div
                    key={item.key}
                    role="rowgroup"
                    data-testid="finder-group-header"
                    style={{ ...place, height: GROUP_H, left: 0, width: "100%" }}
                    className="flex items-center justify-between px-3 border-b border-border bg-secondary/30 backdrop-blur-sm"
                  >
                    <span className="typo-label text-primary">{kindGroupLabel(t, item.bucket)}</span>
                    <span className="typo-label text-foreground tabular-nums">{item.count}</span>
                  </div>
                );
              }
              return (
                <ListRow
                  key={item.key}
                  view={props}
                  entry={item.entry}
                  dnd={dnd}
                  style={{ ...place, left: 0, width: "100%" }}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
