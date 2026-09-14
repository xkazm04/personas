// useFocusFlash — Athena's pointer at the board.
//
// She names a node in her caption over this board; the orb writes its key into
// the system store and this is the end that acts on it. The signal is CONSUMED
// and then cleared, like every other transient Monitor signal — a focus that
// persisted would re-scroll the board every time the operator came back to it.
//
// The ring outlives the scroll deliberately: a scroll that lands with no mark
// leaves the operator looking at a column, guessing which tile was meant.

import { useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';

/** How long a node Athena pointed at stays ringed. Long enough to find with
 *  the eye once the scroll settles, short enough that it never becomes chrome. */
export const FOCUS_FLASH_MS = 2600;

/** The focused node key (`p:<personaId>` / `s:<sessionId>`), or null. */
export function useFocusFlash(): string | null {
  const focusNode = useSystemStore((s) => s.monitorFocusNode);
  const setFocusNode = useSystemStore((s) => s.setMonitorFocusNode);

  useEffect(() => {
    if (!focusNode) return;
    const id = setTimeout(() => setFocusNode(null), FOCUS_FLASH_MS);
    return () => clearTimeout(id);
  }, [focusNode, setFocusNode]);

  return focusNode;
}
