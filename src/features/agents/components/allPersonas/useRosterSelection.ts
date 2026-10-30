import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Persona } from '@/lib/bindings/Persona';

/**
 * Roster row selection whose select-all is scoped to what the user can SEE.
 *
 * The header checkbox used to select every persona the filters matched while
 * the grid shows 25 per page, so a bulk Archive or Move acted on rows nobody
 * had looked at (archive and move run without a confirm). Now the header
 * checkbox toggles the visible page only, and selecting the rest is an
 * explicit second act ("Select all N matching", Gmail-style), after which the
 * scope reads back as "All N matching are selected".
 *
 * `visibleRows` is the page the grid is showing (DataGrid's `onPageRowsChange`)
 * or, on the unpaginated compact card list, the whole filtered list.
 */
export function useRosterSelection(filteredData: Persona[], visibleRows: Persona[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Drop selections that no longer match the filtered data.
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(filteredData.map((p) => p.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredData]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pageAllSelected = visibleRows.length > 0 && visibleRows.every((p) => selectedIds.has(p.id));

  /** Header checkbox: add the visible page to the selection, or take it out. */
  const togglePage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of visibleRows) {
        if (pageAllSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }, [visibleRows, pageAllSelected]);

  const selectAllMatching = useCallback(() => {
    setSelectedIds(new Set(filteredData.map((p) => p.id)));
  }, [filteredData]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  /** What the scope banner offers: nothing, "select all N matching", or "all N selected". */
  const scope = useMemo<'none' | 'page' | 'matching'>(() => {
    if (filteredData.length <= visibleRows.length) return 'none';
    if (filteredData.length > 0 && filteredData.every((p) => selectedIds.has(p.id))) return 'matching';
    return pageAllSelected ? 'page' : 'none';
  }, [filteredData, visibleRows.length, selectedIds, pageAllSelected]);

  return { selectedIds, setSelectedIds, toggleOne, pageAllSelected, togglePage, selectAllMatching, clear, scope };
}
