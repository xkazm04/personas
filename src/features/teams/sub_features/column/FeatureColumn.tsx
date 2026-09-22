// The feature column: B/2's navigation at B/3's density.
//
// VIRTUALISED, because a project carries 50-100 features and this list is the
// page's permanent chrome: it stays mounted while the content area changes tab,
// so a hundred real DOM rows would be paid for on every one of those renders.
// Group headings are items in the same flat list and one of them is pinned via
// the range extractor, which is how a sticky heading survives virtualisation.
import { useCallback, useMemo, useRef } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';

import { NoResults } from '@/features/shared/components/feedback/ScenarioEmptyState';

import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
import { councilLabel } from '@/features/plugins/dev-tools/sub_context/councilGlyph';

import { FEATURE_MOVES, sortRows, type FeatureMove, type FeatureRow, type FeatureSort } from '../featureRules';
import { moveLabel, type TFeatures } from '../featuresModel';
import { FeatureRowItem } from './FeatureRowItem';

const ROW_HEIGHT = 54;
const HEADING_HEIGHT = 30;

type Item =
  | { kind: 'heading'; move: FeatureMove; count: number }
  | { kind: 'row'; row: FeatureRow };

export interface FeatureColumnProps {
  rows: FeatureRow[];
  sort: FeatureSort;
  onSort: (sort: FeatureSort) => void;
  query: string;
  onQuery: (query: string) => void;
  filterRef: React.RefObject<HTMLInputElement | null>;
  selectedId: string | null;
  onSelect: (featureId: string) => void;
  onOpen: (featureId: string) => void;
  totalGroups: number;
  t: TFeatures;
  tDev: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

/** Flatten sorted rows into headings + rows. Under `move` the headings are the
 *  five bands; under any other sort the list is one run and carries none. */
function flatten(rows: FeatureRow[], sort: FeatureSort): Item[] {
  if (sort !== 'move') return rows.map((row) => ({ kind: 'row', row }) as Item);
  const items: Item[] = [];
  for (const move of FEATURE_MOVES) {
    const band = rows.filter((r) => r.move === move);
    if (band.length === 0) continue;
    items.push({ kind: 'heading', move, count: band.length });
    for (const row of band) items.push({ kind: 'row', row });
  }
  return items;
}

export function FeatureColumn({
  rows,
  sort,
  onSort,
  query,
  onQuery,
  filterRef,
  selectedId,
  onSelect,
  onOpen,
  totalGroups,
  t,
  tDev,
  tx,
}: FeatureColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const items = useMemo(() => flatten(sorted, sort), [sorted, sort]);
  const headingIndexes = useMemo(
    () => items.reduce<number[]>((acc, item, i) => (item.kind === 'heading' ? [...acc, i] : acc), []),
    [items],
  );
  const activeHeading = useRef<number>(0);

  const rangeExtractor = useCallback(
    (range: Range) => {
      // The heading at or above the top of the viewport is ALWAYS rendered, so
      // it can be pinned there. Without this the virtualiser unmounts it the
      // moment its own row scrolls past and the band loses its name.
      const pinned = [...headingIndexes].reverse().find((i) => i <= range.startIndex) ?? 0;
      activeHeading.current = pinned;
      return Array.from(new Set([pinned, ...defaultRangeExtractor(range)])).sort((a, b) => a - b);
    },
    [headingIndexes],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i]?.kind === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT),
    overscan: 8,
    rangeExtractor: sort === 'move' ? rangeExtractor : undefined,
  });

  const move = useCallback(
    (delta: number) => {
      const rowItems = items.filter((i): i is Extract<Item, { kind: 'row' }> => i.kind === 'row');
      if (rowItems.length === 0) return;
      const at = rowItems.findIndex((i) => i.row.feature.id === selectedId);
      const next = at < 0 ? 0 : Math.max(0, Math.min(rowItems.length - 1, at + delta));
      const target = rowItems[next];
      if (!target) return;
      onSelect(target.row.feature.id);
      const index = items.indexOf(target);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [items, onSelect, selectedId, virtualizer],
  );

  const sortTabs: Array<{ id: FeatureSort; label: string }> = [
    { id: 'move', label: t.sort_move },
    { id: 'name', label: t.sort_name },
    { id: 'score', label: t.sort_score },
    { id: 'span', label: t.sort_span },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="features-column">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <label className="flex items-center gap-2 rounded-input border border-border bg-secondary/40 px-2 py-1.5">
          <Search className="h-4 w-4 flex-none text-foreground" aria-hidden="true" />
          <input
            ref={filterRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t.filter_placeholder}
            aria-label={t.filter_label}
            data-testid="features-filter"
            className="min-w-0 flex-1 bg-transparent typo-body text-foreground outline-none placeholder:text-foreground/50"
          />
        </label>
        {/* A sort selector, NOT a tab strip: it reorders ONE region rather
            than selecting among several, so it makes no tablist promise it
            would then have to keep. A row of pressed buttons is what it is. */}
        <div role="group" aria-label={t.sort_label} className="flex items-center gap-1">
          {sortTabs.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sort === option.id}
              data-testid={`features-sort-${option.id}`}
              onClick={() => onSort(option.id)}
              className={`flex-1 rounded-interactive border px-2 py-1 typo-caption focus-ring ${
                sort === option.id
                  ? 'border-primary/60 bg-primary/15 text-primary'
                  : 'border-border text-foreground hover:bg-secondary/50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <NoResults onReset={() => onQuery('')} title={t.no_matches_title} subtitle={t.no_matches_subtitle} resetLabel={t.no_matches_reset} />
        </div>
      ) : (
        <div
          ref={scrollRef}
          role="listbox"
          tabIndex={0}
          aria-label={tx(t.column_heading, { count: rows.length })}
          data-testid="features-column-scroll"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter' && selectedId) { e.preventDefault(); onOpen(selectedId); }
          }}
          className="relative min-h-0 flex-1 overflow-y-auto focus-ring"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const item = items[v.index];
              if (!item) return null;
              const pinned = item.kind === 'heading' && v.index === activeHeading.current;
              return (
                <div
                  key={v.key}
                  ref={pinned ? undefined : virtualizer.measureElement}
                  data-index={v.index}
                  style={
                    pinned
                      ? { position: 'sticky', top: 0, zIndex: 2, width: '100%' }
                      : { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }
                  }
                >
                  {item.kind === 'heading' ? (
                    <div className="flex items-center justify-between border-b border-border bg-background px-3 py-1.5">
                      <span className="typo-caption text-foreground">{moveLabel(item.move, t)}</span>
                      <span className="typo-data text-foreground">{item.count}</span>
                    </div>
                  ) : (
                    <FeatureRowItem
                      row={item.row}
                      totalGroups={totalGroups}
                      selected={item.row.feature.id === selectedId}
                      onSelect={onSelect}
                      onOpen={onOpen}
                      t={t}
                      tDev={tDev}
                      tx={tx}
                      stateName={councilLabel(item.row.kind, tDev)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
