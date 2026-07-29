/**
 * useCockpitKeyboard — the Cockpit's input layer, and the published map of it.
 *
 * Two properties matter more than the key list:
 *
 *  1. **The listener is registered once.** Handlers are read through a
 *     latest-ref, so a burst of keypresses during a re-render can't be
 *     swallowed by a stale closure — which is exactly the failure a reviewer
 *     would experience as "it dropped my third accept".
 *  2. **Navigation is not a decision.** ↑/↓ and J/K move the cursor and write
 *     nothing. That is the line between this variant and a swipe deck, and it
 *     is enforced here rather than trusted to the panes.
 *
 * Everything is guarded against modifier chords (so Cmd-R still reloads) and
 * against text-entry targets (so typing an answer doesn't reject the item).
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */
import { useEffect, useRef } from 'react';

import type { TriageVerdict } from '../triageTypes';
import type { LegendEntry } from './ShortcutChip';

/** The map, rendered verbatim in the footer strip. If a key is added here it
 *  becomes visible in the UI in the same commit — that is the point. */
export const COCKPIT_LEGEND: LegendEntry[] = [
  { keys: ['↑', '↓'], label: 'Move (no decision)' },
  { keys: ['J', 'K'], label: 'Same, home row' },
  { keys: ['A'], label: 'Accept' },
  { keys: ['R'], label: 'Reject' },
  { keys: ['S'], label: 'Skip — stays in the queue' },
  { keys: ['1', '9'], label: 'Branch actions' },
  { keys: ['Esc'], label: 'Close' },
];

export interface CockpitKeyHandlers {
  /** Move the cursor by ±1 without deciding anything. */
  onMove: (delta: number) => void;
  onVerdict: (verdict: TriageVerdict) => void;
  /** Zero-based position in `item.branches`, from digits 1–9. */
  onBranch: (position: number) => void;
  onClose: () => void;
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable
  );
}

export function useCockpitKeyboard(handlers: CockpitKeyHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { onMove, onVerdict, onBranch, onClose } = ref.current;
      const typing = isTextEntry(event.target);

      // Escape is the one key that survives a focused field: it steps out of the
      // input first, and only closes the surface on the second press.
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typing) (event.target as HTMLElement | null)?.blur();
        else onClose();
        return;
      }
      if (typing) return;

      if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') {
        event.preventDefault();
        onMove(1);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        onMove(-1);
        return;
      }

      // Holding a key may scroll the queue; it must never machine-gun verdicts.
      if (event.repeat) return;

      const key = event.key.toLowerCase();
      if (key === 'a' || key === 'r' || key === 's') {
        event.preventDefault();
        onVerdict(key === 'a' ? 'accept' : key === 'r' ? 'reject' : 'skip');
        return;
      }
      if (event.key.length === 1 && event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        onBranch(Number(event.key) - 1);
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
