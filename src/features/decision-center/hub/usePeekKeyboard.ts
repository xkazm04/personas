/**
 * usePeekKeyboard — binds `peekKeys` to the app keyboard registry.
 *
 * At the overlay rung (`OVERLAY_DISMISS_PRIORITY`), because the peek is an
 * anchored popover over the board. While an opened item's surface is up, the
 * hub passes `enabled: false`: the modal owns every key, and a verdict letter
 * must never fall through it onto the row behind.
 *
 * ESCAPE IS CONSUMED HARD. The Monitor closes itself on Escape from a bare
 * `window` listener that yields only while a `[role="dialog"]` is in the DOM.
 * The registry's own listener runs first, but React flushes the peek's
 * unmount in the microtask between the two listeners, so by the time the
 * Monitor looks the dialog is gone — one press would close the peek AND the
 * Monitor. `stopImmediatePropagation` ends the press here.
 */
import { useCallback, useState } from 'react';

import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { DecisionItem } from '../model/decisionModel';
import { peekKeyAction } from './peekKeys';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}

export interface PeekKeyboardCallbacks {
  onOpen: (item: DecisionItem) => void;
  onDecide: (item: DecisionItem, verdict: 'accept' | 'reject') => void;
  onWalk: (step: 1 | -1) => void;
  onClose: () => void;
}

export function usePeekKeyboard(
  items: readonly DecisionItem[],
  enabled: boolean,
  cb: PeekKeyboardCallbacks,
) {
  const [focus, setFocus] = useState(0);
  const [armedId, setArmedId] = useState<string | null>(null);
  const index = items.length === 0 ? 0 : Math.min(focus, items.length - 1);
  const item = items[index] ?? null;
  const armed = armedId !== null && armedId === item?.id;
  const { onOpen, onDecide, onWalk, onClose } = cb;

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key !== 'Escape' && isTypingTarget(e.target)) return false;
    const action = peekKeyAction(e.key, { armed, item });
    if (!action) {
      // Any other key lets go of an armed reject rather than leaving it live.
      if (armed) setArmedId(null);
      return false;
    }
    e.preventDefault();
    if (e.key === 'Escape') e.stopImmediatePropagation();
    switch (action.type) {
      case 'move':
        setArmedId(null);
        setFocus(Math.max(0, Math.min(items.length - 1, index + action.step)));
        break;
      case 'walk':
        setArmedId(null);
        onWalk(action.step);
        break;
      case 'open':
        if (item) onOpen(item);
        break;
      case 'arm':
        setArmedId(item?.id ?? null);
        break;
      case 'disarm':
        setArmedId(null);
        break;
      case 'decide':
        setArmedId(null);
        if (item) onDecide(item, action.verdict);
        break;
      case 'close':
        onClose();
        break;
    }
    return true;
  }, [armed, item, items.length, index, onOpen, onDecide, onWalk, onClose]);

  useAppKeyboard(onKey, { priority: OVERLAY_DISMISS_PRIORITY, enabled });

  return { index, setFocus, armed, armedId };
}
