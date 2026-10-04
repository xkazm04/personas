// Keyboard for every variant: digits 1..N open a dimension, Esc returns to
// layer 1. Registered on the app keyboard ladder at the route rung, so any
// overlay above the page (a modal, the customize popover) wins the key first;
// typing in a field is never hijacked.

import { useCallback } from 'react';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useDimKeys<T extends string>(order: readonly T[], onSelect: (id: T) => void, onBack: () => void) {
  const handler = useCallback((e: KeyboardEvent): boolean => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return false;
    if (e.key === 'Escape') { onBack(); return true; }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= order.length) {
      e.preventDefault();
      onSelect(order[n - 1]!);
      return true;
    }
    return false;
  }, [order, onSelect, onBack]);
  useAppKeyboard(handler, { priority: ROUTE_DECISION_PRIORITY });
}
