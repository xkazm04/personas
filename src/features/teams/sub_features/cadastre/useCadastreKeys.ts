// The Cadastre's keys, the winner's set: `j` `k` move and survey, Enter opens
// the deed as a layer, `[` `]` step deeds inside it, Esc goes back one level,
// `w` `i` `u` filter, `l` the lens, `s` the sort, `a` `m` `g` inside a deed,
// `d` the DEV rehearsal. `/` stays the page's own (FeaturesPage), so it lands
// in the filter box exactly as it does on the Board.
//
// Registered through the app's keyboard provider at route priority, below
// every overlay, and switched off while a confirmation is open: the dialog
// owns Esc and Enter then.
import { useCallback, type RefObject } from 'react';

import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import type { Cadastre } from './useCadastre';

export interface CadastreKeyActions {
  openDeed: (key: string) => void;
  closeLayer: () => void;
  runAction: () => void;
  toggleTier: () => void;
  openUnclaimed: () => void;
}

export function useCadastreKeys(
  cad: Cadastre,
  actions: CadastreKeyActions,
  refs: { filter: RefObject<HTMLInputElement | null>; list: RefObject<HTMLDivElement | null> },
  opts: { enabled: boolean; rehearsal: boolean },
) {
  const back = useCallback(() => {
    if (cad.open) { actions.closeLayer(); return; }
    if (cad.lens) { cad.setLens(false); return; }
    if (cad.query) { cad.setQuery(''); return; }
    if (cad.filter) { cad.toggleFilter(cad.filter); return; }
    if (cad.preview) cad.setPreview(null);
  }, [cad, actions]);

  const handler = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const og = cad.filter === 'unclaimed';

    if (isTypingTarget(e.target)) {
      if (e.target !== refs.filter.current) return false;
      if (e.key === 'Escape') {
        if (cad.query) cad.setQuery('');
        else refs.filter.current?.blur();
        refs.list.current?.focus({ preventScroll: true });
        return true;
      }
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        refs.list.current?.focus({ preventScroll: true });
        if (og) cad.moveUnclaimed(1);
        else if (e.key === 'Enter' && cad.focus) actions.openDeed(cad.focus);
        else cad.moveFocus(1);
        return true;
      }
      return false;
    }

    const onButton = e.target instanceof HTMLElement && e.target.tagName === 'BUTTON';
    const filterKey = ({ w: 'waiting', i: 'trouble', u: 'unclaimed' } as const)[e.key as 'w' | 'i' | 'u'];
    if (filterKey) { cad.toggleFilter(filterKey); refs.list.current?.focus({ preventScroll: true }); return true; }
    if (e.key === 'd' && opts.rehearsal) { cad.toggleBig(); return true; }

    if (cad.open) {
      switch (e.key) {
        case 'Escape': case 'g': actions.closeLayer(); return true;
        case '[': case 'k': cad.stepDeed(-1); return true;
        case ']': case 'j': cad.stepDeed(1); return true;
        case 'a': actions.runAction(); return true;
        case 'm': actions.toggleTier(); return true;
        default: return false;
      }
    }

    switch (e.key) {
      case 'j': case 'ArrowDown': if (og) cad.moveUnclaimed(1); else cad.moveFocus(1); return true;
      case 'k': case 'ArrowUp': if (og) cad.moveUnclaimed(-1); else cad.moveFocus(-1); return true;
      case 'Enter':
        if (onButton) return false;
        if (og) { if (cad.ogFocus) actions.openUnclaimed(); else cad.moveUnclaimed(1); }
        else if (cad.focus) actions.openDeed(cad.focus);
        else cad.moveFocus(1);
        return true;
      case 'Escape': back(); return true;
      case 'l': cad.setLens(!cad.lens); return true;
      case 's': if (!cad.filter) cad.cycleSort(); return true;
      default: return false;
    }
  }, [cad, actions, refs, opts.rehearsal, back]);

  useAppKeyboard(handler, { priority: ROUTE_DECISION_PRIORITY, enabled: opts.enabled });
  return back;
}
