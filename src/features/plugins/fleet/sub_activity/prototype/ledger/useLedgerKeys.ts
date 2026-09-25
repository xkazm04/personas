/**
 * The Ledger variant's list keys on Fleet Activity: j / k (or the arrows) move the
 * selection, Enter opens the selected row, Esc closes the folio and then clears
 * the selection, `/` focuses the search. Registered on the app's keyboard ladder at
 * the route rung, so any overlay above the page (the insights modal) wins first.
 *
 * Skipped from the variant: 1-5 (surface switching, the prototype shell's own
 * routes), G (the grid overlay, a specimen device) and T (theme toggle, the app
 * owns theming). None of j, k, Enter, Esc or `/` is bound on the Activity tab
 * today; the Sessions tab's own `/` and arrows (useFleetHotkeys) never mount here.
 */
import type { RefObject } from 'react';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { LedgerSession } from './ledgerModel';

function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  return target.closest('[role="dialog"]') !== null;
}

export function useLedgerKeys({ visible, sel, searchRef, select, openRow, back }: {
  visible: LedgerSession[];
  sel: string | null;
  searchRef: RefObject<HTMLInputElement | null>;
  select: (key: string) => void;
  openRow: () => void;
  back: () => void;
}): (d: 1 | -1) => void {
  const move = (d: 1 | -1) => {
    if (!visible.length) return;
    const i = visible.findIndex((s) => s.key === sel);
    const next = i < 0 ? (d > 0 ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, i + d));
    const key = visible[next]!.key;
    select(key);
    const row = document.querySelector<HTMLElement>(`.lgk [data-key="${CSS.escape(key)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: 'nearest' });
  };

  useAppKeyboard((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || ownsKeys(e.target)) return;
    const onControl = e.target instanceof HTMLElement && ['BUTTON', 'A'].includes(e.target.tagName);
    switch (e.key) {
      case 'j': case 'ArrowDown': move(1); break;
      case 'k': case 'ArrowUp': move(-1); break;
      case 'Enter': if (onControl || !sel) return; openRow(); break;
      case 'Escape': if (!sel) return; back(); break;
      case '/': searchRef.current?.focus(); searchRef.current?.select(); break;
      default: return;
    }
    e.preventDefault();
    return true;
  }, { priority: ROUTE_DECISION_PRIORITY });
  return move;
}

/** The search field's own keys: Esc hands focus back to the list, ArrowDown moves into it. */
export function searchKeys(e: React.KeyboardEvent<HTMLInputElement>, moveDown: () => void): void {
  if (e.key === 'Escape') { e.currentTarget.blur(); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { e.currentTarget.blur(); moveDown(); e.preventDefault(); }
}
