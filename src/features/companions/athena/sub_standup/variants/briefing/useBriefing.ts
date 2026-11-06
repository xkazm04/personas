import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { StandupSource } from '../../data/types';
import { openAthenaChat } from '../../data/openAthenaChat';
import { statePatch } from '../../model/patch';
import type { GroupId, RowView, StandupView } from '../../model/types';
import type { StandupController } from '../types';

/** The order the memo reads in: what needs you, then directions, agents, fill and held. */
export const DOC_ORDER: readonly GroupId[] = ['waits', 'decide', 'blank', 'agents', 'filler', 'refused'];

/** One step above the shared controller (25), so j/k walk the DOCUMENT, not the table order. */
const DOC_KEY_PRIORITY = 26;

function fromEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export interface DocEntry { row: RowView; index: number }

/**
 * The briefing reads in a different order than the shared table (asks first),
 * so the cursor must too: j/k and the arrows move through the document order
 * and every other key falls through to the shared keymap. The selected item is
 * scrolled into view. Click paths for the keys the controller exposes no
 * function for (skip, undo, accept, talk) go through the same source actions.
 */
export function useBriefing(view: StandupView, source: StandupSource, c: StandupController) {
  const indexOf = useMemo(() => new Map(view.rows.map((r, i) => [r.key, i])), [view.rows]);
  const entries = useCallback((ids: readonly GroupId[]): DocEntry[] => view.groups
    .filter((g) => ids.includes(g.id))
    .sort((a, b) => DOC_ORDER.indexOf(a.id) - DOC_ORDER.indexOf(b.id))
    .flatMap((g) => g.rows.map((row) => ({ row, index: indexOf.get(row.key) ?? 0 }))), [view.groups, indexOf]);
  const order = useMemo(() => entries(DOC_ORDER).map((e) => e.index), [entries]);

  useAppKeyboard((e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || fromEditable(e.target)) return false;
    if (c.ui.rules || c.ui.keys || order.length === 0) return false;
    const step = e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return false;
    const at = Math.max(0, order.indexOf(c.ui.sel));
    const next = order[Math.min(order.length - 1, Math.max(0, at + step))]!;
    e.preventDefault();
    c.select(next);
    return true;
  }, { priority: DOC_KEY_PRIORITY });

  // Follow the cursor once it MOVES; the first paint keeps the masthead in view.
  const selKey = view.rows[c.ui.sel]?.key;
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    const moved = Boolean(shown.current) && shown.current !== selKey;
    shown.current = selKey;
    if (moved && selKey) document.getElementById(`sb-item-${selKey}`)?.scrollIntoView({ block: 'nearest' });
  }, [selKey]);

  const { actions } = source;
  const setState = useCallback((row: RowView, state: 'accepted' | 'skipped' | 'proposed') => {
    const patch = statePatch(row, state);
    if (patch) void actions.patch(patch);
  }, [actions]);
  const talk = useCallback((row: RowView) => {
    if (!row.itemId) return;
    void actions.discuss(row.itemId).then((id) => { if (id) openAthenaChat(id); });
  }, [actions]);

  return { entries, setState, talk };
}

export type BriefingApi = ReturnType<typeof useBriefing>;
