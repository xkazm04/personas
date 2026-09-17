// useAttentionCursor — the board's queue cursor.
//
// Triage on the Activity board was click-a-tile: a six-item morning was six
// mouse trips to the drawer, across a wrapped board of hundreds of tiles where
// the six sit wherever their teams put them. The tiles were already focusable
// (`PersonaTile` is a `<button>`), so what was missing was not an affordance
// but an ORDER — a next-attention key that skips everything with nothing
// pending, including the idle tiles sitting between two actionable ones.
//
// `n` / `j` walk forward, `k` walks back, `Enter` opens the focused card on its
// primary section. The predicate is `actionWeight > 0`, the same one the
// header's "Needs you only" filter uses, so the cursor visits exactly the set
// that filter would show — whether or not it is on.

import { useCallback, useEffect, useRef } from 'react';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../monitorModel';
import { actionWeight } from './fleetGridModel';
import type { BoardModel } from './useBoardModel';

/** The tile attribute the cursor addresses. Set by `PersonaTile`. */
export const TILE_ID_ATTR = 'data-persona-id';

/**
 * The actionable personas in BOARD order — columns left to right as the board
 * lays them out, then the ungrouped tray. Cards arrive urgency-sorted inside
 * each column, so this is "team order, then urgency" without a second sort.
 */
export function attentionOrder(model: BoardModel): string[] {
  const out: string[] = [];
  for (const column of model.columns) {
    for (const card of column.cards) {
      if (actionWeight(card) > 0) out.push(card.personaId);
    }
  }
  for (const card of model.ungrouped) {
    if (actionWeight(card) > 0) out.push(card.personaId);
  }
  return out;
}

/**
 * The next id in the walk, wrapping at both ends.
 *
 * Wrapping rather than stopping: the queue is a ring the operator empties, and
 * a cursor that silently does nothing at the last card reads as a broken key
 * rather than as the end of the list. A cursor whose card has left the board
 * (answered, or filtered away) restarts from the top instead of guessing where
 * it would have been.
 */
export function stepAttention(
  order: readonly string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at < 0) return delta === 1 ? order[0]! : order[order.length - 1]!;
  const next = (at + delta + order.length) % order.length;
  return order[next]!;
}

/** True for a target that owns its own keystrokes — a field, or a dialog's. */
export function swallowsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // A modal owns the keyboard while it is up; the board is behind it.
  return target.closest('[role="dialog"]') !== null;
}

/**
 * Install the board's cursor. Returns nothing: the cursor's whole state is DOM
 * focus, so there is no second copy of "which tile is current" to drift from
 * what the operator can see.
 */
export function useAttentionCursor(
  model: BoardModel,
  cards: PersonaCardModel[],
  onSelect: (personaId: string, section: DrawerSection) => void,
  enabled = true,
) {
  const cursor = useRef<string | null>(null);

  const focusTile = useCallback((personaId: string) => {
    cursor.current = personaId;
    const el = document.querySelector<HTMLElement>(
      `[${TILE_ID_ATTR}="${CSS.escape(personaId)}"]`,
    );
    el?.focus();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (swallowsKeys(e.target)) return;

      if (e.key === 'n' || e.key === 'j' || e.key === 'k') {
        const order = attentionOrder(model);
        if (order.length === 0) return;
        const next = stepAttention(order, cursor.current, e.key === 'k' ? -1 : 1);
        if (!next) return;
        e.preventDefault();
        focusTile(next);
        return;
      }

      if (e.key === 'Enter' && cursor.current) {
        const card = cards.find((c) => c.personaId === cursor.current);
        if (!card) return;
        e.preventDefault();
        onSelect(card.personaId, primaryDrawerSection(card));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [model, cards, onSelect, enabled, focusTile]);
}
