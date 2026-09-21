import { useCallback, useEffect, useState, type Dispatch, type RefObject } from 'react';

import { NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { DeskFilter } from './deskFilter';
import {
  columnsFromRowTops,
  columnsFromTemplate,
  commandFromKey,
  GRID_COLUMNS,
  cycleId,
  escapeOwnedByDesk,
  isTypingSurface,
  moveSelection,
  overlayOwnsKeys,
  type CardAction,
  type ChromeAction,
  type DeskChromeState,
} from './deskModel';

/**
 * The grid's RENDERED column count, so `↑` / `↓` move one visual row whatever
 * width the pad is at. Reads the computed `grid-template-columns`; when that is
 * unreadable, counts the cards sharing the first card's row. Re-measured on
 * every resize of the grid and whenever `revision` (the visible set) changes.
 */
export function useGridColumns(gridRef: RefObject<HTMLElement | null>, revision: string): number {
  const [columns, setColumns] = useState(GRID_COLUMNS);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const fromTemplate = columnsFromTemplate(getComputedStyle(el).gridTemplateColumns, 0);
      if (fromTemplate > 0) {
        setColumns(fromTemplate);
        return;
      }
      const rects = Array.from(el.children, (child) => child.getBoundingClientRect());
      // No layout yet (or a DOM without one): every box is 0×0 and "all on one
      // row" would be a lie — keep the styled count.
      if (rects.every((r) => r.width === 0 && r.height === 0)) {
        setColumns(GRID_COLUMNS);
        return;
      }
      setColumns(columnsFromRowTops(rects.map((r) => r.top)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `revision` re-runs the effect when the grid element itself is swapped
    // (empty state ↔ grid) and when the card set changes under the same width.
  }, [gridRef, revision]);

  return columns;
}

/**
 * One rung ABOVE the pad's own layer. The host (`NotepadOverlayHost`) registers
 * at `NOTEPAD_LAYER_PRIORITY` and owns the Escape ladder; at an EQUAL priority
 * the provider asks the later registration first, and the host — a parent —
 * registers after the desk, so its Escape (blur the field, then close the pad)
 * would always beat the desk's "clear find" rung. Every key the desk does not
 * consume still falls through to the host. Modals (80) stay above both.
 */
const DESK_KEY_PRIORITY = NOTEPAD_LAYER_PRIORITY + 1;

/**
 * The desk's keyboard layer, through the app's one keyboard provider (never a
 * window listener). Letter keys are ignored while a typing surface or an
 * overlay owns focus; Escape is claimed only while the desk has something of
 * its own to close (see `escapeOwnedByDesk`) and nothing above it (a popover
 * listening on `document`) has already handled it.
 */
export function useDeskKeyboard({
  enabled,
  chrome,
  dispatch,
  visibleIds,
  columns,
  statusFilters,
  status,
  onStatus,
  projectIds,
  project,
  onProject,
  onOpen,
  onAct,
  searchRef,
  scrollTo,
}: {
  enabled: boolean;
  chrome: DeskChromeState;
  dispatch: Dispatch<ChromeAction>;
  visibleIds: readonly string[];
  columns: number;
  statusFilters: readonly DeskFilter[];
  status: DeskFilter;
  onStatus: (next: DeskFilter) => void;
  projectIds: readonly string[];
  project: string;
  onProject: (id: string) => void;
  onOpen: (id: string) => void;
  onAct: (id: string, action: CardAction) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  scrollTo: (id: string) => void;
}): void {
  const onKey = useCallback(
    (event: KeyboardEvent): boolean | void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false;

      if (event.key === 'Escape') {
        if (event.defaultPrevented || !escapeOwnedByDesk(chrome)) return false;
        event.preventDefault();
        const hadQuery = chrome.query.length > 0;
        dispatch({ type: 'escape' });
        if (chrome.searchOpen && !hadQuery && !chrome.cheatOpen) {
          searchRef.current?.blur();
        }
        return true;
      }

      if (event.key === '?' && !isTypingSurface(event.target)) {
        event.preventDefault();
        dispatch({ type: 'toggleCheat' });
        return true;
      }

      if (isTypingSurface(event.target) || overlayOwnsKeys(event.target)) return false;

      const cmd = commandFromKey({ key: event.key, code: event.code, shiftKey: event.shiftKey });
      if (!cmd || cmd.type === 'escape' || cmd.type === 'cheat') return false;

      event.preventDefault();

      switch (cmd.type) {
        case 'nav': {
          const next = moveSelection(visibleIds, chrome.selectedId, cmd.dir, columns);
          if (next) {
            dispatch({ type: 'select', id: next });
            scrollTo(next);
          }
          return true;
        }
        case 'open':
          if (chrome.selectedId) onOpen(chrome.selectedId);
          return true;
        case 'search':
          dispatch({ type: 'openSearch' });
          queueMicrotask(() => searchRef.current?.focus());
          return true;
        case 'status': {
          const next = statusFilters[cmd.index];
          if (next && next !== status) onStatus(next);
          return true;
        }
        case 'project': {
          const next = projectIds[cmd.index];
          if (next) onProject(next);
          return true;
        }
        case 'projectCycle':
          if (projectIds.length > 1) onProject(cycleId(projectIds, project, cmd.delta));
          return true;
        case 'act':
          if (chrome.selectedId) onAct(chrome.selectedId, cmd.action);
          return true;
      }
    },
    [
      chrome,
      dispatch,
      visibleIds,
      columns,
      statusFilters,
      status,
      onStatus,
      projectIds,
      project,
      onProject,
      onOpen,
      onAct,
      searchRef,
      scrollTo,
    ],
  );

  useAppKeyboard(onKey, { enabled, priority: DESK_KEY_PRIORITY });
}
