/**
 * The one keyboard map. Bound on the page root, not on `window`, so the page
 * never eats a key while the operator is somewhere else in the app.
 */
import { useCallback } from 'react';

import type { ChannelId } from './model/channels';
import type { BlueprintState } from './useBlueprintState';

interface KeyDeps {
  state: BlueprintState;
  deep: boolean;
  descend: (index: number) => void;
  ascend: () => void;
}

export function useBlueprintKeys({ state, deep, descend, ascend }: KeyDeps) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;

      if (typing) {
        if (k === 'Escape') {
          e.preventDefault();
          target?.blur();
        }
        return;
      }

      if (state.help) {
        if (k === 'Escape' || k === '?') {
          e.preventDefault();
          state.toggleHelp();
        }
        return;
      }
      if (k === '?') {
        e.preventDefault();
        state.toggleHelp();
        return;
      }
      if (k === 'u' || k === 'U') {
        state.undo();
        return;
      }
      if (k === 'd' || k === 'D') {
        e.preventDefault();
        state.toggleDocket();
        return;
      }

      if (state.docket.open) {
        if (k === 'Escape') {
          e.preventDefault();
          if (state.docket.full) state.toggleFull();
          else state.closeDocket();
          return;
        }
        if (k === 'f' || k === 'F') {
          e.preventDefault();
          state.toggleFull();
          return;
        }
        if (/^[1-9]$/.test(k)) {
          e.preventDefault();
          state.answerSelected(Number(k) - 1);
        }
        return;
      }

      if (deep) {
        if (k === 'Escape' || k === 'ArrowLeft' || k === 'Backspace') {
          e.preventDefault();
          ascend();
        }
        return;
      }

      if (k === 'Enter' || k === 'ArrowRight') {
        e.preventDefault();
        descend(state.cursor);
        return;
      }
      if (k === 'j' || k === 'ArrowDown') {
        e.preventDefault();
        state.setCursor(Math.min(state.rows.length - 1, state.cursor + 1));
        return;
      }
      if (k === 'k' || k === 'ArrowUp') {
        e.preventDefault();
        state.setCursor(Math.max(0, state.cursor - 1));
        return;
      }
      if (k === 'Escape') {
        if (state.solo) state.toggleSolo(state.solo);
        else if (state.query) state.setQuery('');
        return;
      }
      if (/^[0-9]$/.test(k)) {
        e.preventDefault();
        if (k === '0') {
          if (state.solo) state.toggleSolo(state.solo);
        } else {
          state.toggleSolo(Number(k) as ChannelId);
        }
      }
    },
    [ascend, deep, descend, state],
  );
}
