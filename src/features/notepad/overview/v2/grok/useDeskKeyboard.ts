import { useCallback, type Dispatch, type RefObject } from 'react';

import { NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { DeskFilter } from '../../deskFilter';
import {
  commandFromKey,
  cycleId,
  escapeOwnedByDesk,
  isTypingSurface,
  moveSelection,
  overlayOwnsKeys,
  type CardAction,
  type ChromeAction,
  type DeskChromeState,
} from './deskModel';

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
        if (!escapeOwnedByDesk(chrome)) return false;
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

  useAppKeyboard(onKey, { enabled, priority: NOTEPAD_LAYER_PRIORITY });
}
