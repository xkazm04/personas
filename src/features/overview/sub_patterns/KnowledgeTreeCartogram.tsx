// Variant A — CARTOGRAM. Metaphor: a map of territory.
//
// The baseline rail is a list, and a list makes a 66-item area and a 10-item
// area the same size — you have to read digits to find the mass. Here the rail
// is a squarified treemap: surface IS count, so the shape of the corpus is the
// first thing you see. Each block is filled from the bottom by the share that
// has been ADOPTED, so the second thing you see is how much of each territory
// is still unreviewed (349 of 523 items, today). Clusters are nested inside
// their area as a mosaic of sub-blocks — an 11-item cluster cannot borrow the
// weight of a 27-item one, because the geometry will not let it.
//
// Selecting a block scopes the list; selecting an area also drills the map into
// that area's clusters. Every block is a real button with an aria-label naming
// the territory and its three counts, so the map is reachable without sight.
import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, Library } from 'lucide-react';

import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { buildTerritories, squarify, type Cell, type Territory } from './knowledgeCartogramModel';
import {
  applyView,
  PracticeFilters,
  usePracticeColumns,
  useKnowledgeReview,
  type KnowledgeTreeProps,
} from './knowledgeTableShared';
import type { KnowledgeItemView } from './libraryModel';

export default function KnowledgeTreeCartogram(props: KnowledgeTreeProps) {
  const { items, onRowClick } = props;
  const { tx } = useTranslation();
  const state = useKnowledgeReview(props);
  const tw = state.tw;

  // '' = whole library, 'frontend' = an area, 'frontend/state' = a cluster.
  const [scopePath, setScopePath] = useState('');
  const [drilled, setDrilled] = useState<string | null>(null);

  const territories = useMemo(() => buildTerritories(items), [items]);
  const openArea = drilled ? territories.find((a) => a.path === drilled) : undefined;
  const level = openArea ? openArea.children : territories;
  const cells = useMemo(() => squarify(level), [level]);

  const scope = useCallback(
    (i: KnowledgeItemView) =>
      !scopePath || i.topic === scopePath || i.topic.startsWith(`${scopePath}/`),
    [scopePath],
  );
  const rows = useMemo(() => applyView(items, scope, state), [items, scope, state]);
  const columns = usePracticeColumns(state);

  const scoped = useMemo(() => {
    const inScope = items.filter(scope);
    return {
      total: inScope.length,
      adopted: inScope.filter((i) => i.status === 'adopted').length,
      pending: inScope.filter((i) => i.status === 'observed' || i.status === 'proposed').length,
    };
  }, [items, scope]);

  const pick = (territory: Territory) => {
    setScopePath((prev) => (prev === territory.path ? (openArea?.path ?? '') : territory.path));
    if (!openArea) setDrilled(territory.path);
  };

  return (
    <div className="flex min-h-0 h-full gap-4">
      <aside className="w-72 shrink-0 flex flex-col gap-2 min-h-0">
        <div className="flex items-center gap-1.5">
          {openArea ? (
            <button
              type="button"
              onClick={() => {
                setDrilled(null);
                setScopePath('');
              }}
              className="flex items-center gap-1 typo-label text-foreground hover:text-primary transition-colors focus-ring rounded-interactive"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {tw.map_back}
            </button>
          ) : (
            <span className="typo-label text-foreground">{tw.map_title}</span>
          )}
          <span className="typo-caption ml-auto">
            {tx(tw.map_scope_line, {
              name: scopePath || tw.map_whole_library,
              count: scoped.total,
              adopted: scoped.adopted,
              pending: scoped.pending,
            })}
          </span>
        </div>

        <div className="relative w-full aspect-[4/5] rounded-card border border-primary/10 bg-secondary/20 p-1">
          {cells.map((cell) => {
            const territory = level.find((n) => n.path === cell.path);
            if (!territory) return null;
            return (
              <TerritoryBlock
                key={cell.path}
                cell={cell}
                territory={territory}
                active={scopePath === cell.path}
                label={territory.label || tw.map_uncategorized}
                ariaLabel={tx(tw.map_cell_aria, {
                  name: territory.label || tw.map_uncategorized,
                  count: territory.total,
                  adopted: territory.adopted,
                  pending: territory.pending,
                })}
                onSelect={() => pick(territory)}
              />
            );
          })}
        </div>

        <div className="flex items-center gap-3 typo-caption">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-interactive bg-primary/40 border border-primary/30" />
            {tw.map_legend_adopted}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-interactive bg-secondary/60 border border-primary/20" />
            {tw.map_legend_unreviewed}
          </span>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-center gap-3 pb-2">
          <span className="typo-caption">
            {scopePath
              ? tx(tw.branch_summary, { topic: scopePath, count: rows.length })
              : tx(tw.all_topics_summary, { count: rows.length })}
          </span>
          <div className="ml-auto">
            <PracticeFilters state={state} />
          </div>
        </div>

        <DataGrid
          columns={columns}
          data={rows}
          getRowKey={(r) => r.id}
          onRowClick={onRowClick ? (r) => onRowClick(r, rows) : undefined}
          sortKey={state.sortKey}
          sortDirection={state.sortDir}
          onSort={state.onSort}
          pageSize={25}
          density="compact"
          emptyIcon={Library}
          emptyTitle={tw.library_empty_title}
          emptyDescription={tw.library_empty_desc}
          className="flex-1 min-h-0 rounded-card border border-primary/10"
          {...state.selectionProps(rows)}
        />
      </div>
    </div>
  );
}

/* -- one territory --------------------------------------------------------- */

/** A block whose surface is its item count and whose fill is its adopted share.
 *  At area level the fill is drawn per CLUSTER (a nested squarify), so the
 *  block reads as a mosaic of how reviewed each part of the territory is. */
function TerritoryBlock({
  cell,
  territory,
  label,
  ariaLabel,
  active,
  onSelect,
}: {
  cell: Cell;
  territory: Territory;
  label: string;
  ariaLabel: string;
  active: boolean;
  onSelect: () => void;
}) {
  const mosaic = useMemo(
    () => (territory.children.length > 1 ? squarify(territory.children) : []),
    [territory],
  );
  const showLabel = cell.w > 0.17 && cell.h > 0.1;
  const showCount = cell.w > 0.08 && cell.h > 0.05;

  return (
    <Tooltip content={`${label} · ${territory.total}`} placement="right">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={ariaLabel}
        className={`absolute overflow-hidden rounded-interactive border transition-colors focus-ring ${
          active
            ? 'border-primary/70 ring-1 ring-primary/40'
            : 'border-primary/15 hover:border-primary/45'
        }`}
        style={{
          left: `${cell.x * 100}%`,
          top: `${cell.y * 100}%`,
          width: `${cell.w * 100}%`,
          height: `${cell.h * 100}%`,
        }}
      >
        <span className="absolute inset-0 bg-secondary/50" />
        {mosaic.length > 0 ? (
          mosaic.map((sub) => {
            const child = territory.children.find((c) => c.path === sub.path);
            const share = child && child.total > 0 ? child.adopted / child.total : 0;
            return (
              <span
                key={sub.path}
                className="absolute border border-background/40"
                style={{
                  left: `${sub.x * 100}%`,
                  top: `${sub.y * 100}%`,
                  width: `${sub.w * 100}%`,
                  height: `${sub.h * 100}%`,
                }}
              >
                <span
                  className="absolute inset-x-0 bottom-0 bg-primary/40"
                  style={{ height: `${share * 100}%` }}
                />
              </span>
            );
          })
        ) : (
          <span
            className="absolute inset-x-0 bottom-0 bg-primary/40"
            style={{
              height: `${territory.total > 0 ? (territory.adopted / territory.total) * 100 : 0}%`,
            }}
          />
        )}
        {showCount && (
          <span className="absolute left-1 top-1 max-w-[calc(100%-0.5rem)] flex items-baseline gap-1 rounded-interactive bg-background/70 px-1 py-0.5">
            {showLabel && <span className="typo-label text-foreground truncate">{label}</span>}
            <span className="typo-data text-foreground/90">{territory.total}</span>
          </span>
        )}
      </button>
    </Tooltip>
  );
}
