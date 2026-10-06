/**
 * Fusion · the island's own keys, one rung UNDER the layer's (`useLayer`
 * keeps Alt+W and the first Esc for the work / turn / report views):
 *
 *   Alt+C  open the conversation (caret in the composer) / fold it back
 *   Esc    fold whatever is open: a rail panel, the Brain, then the sheet
 *
 * A non-empty composer keeps its Esc (the draft is not thrown away by a
 * reflex); an empty one folds the island.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { IslandMode } from './Island';

/** Just under the layer's own rung, so the layer's views fold first. */
export const ISLAND_KEY_PRIORITY = FULLSCREEN_LAYER_PRIORITY - 1;

export function useIslandKeys({
  mode,
  brainOpen,
  onToggleChat,
  onFold,
  onCloseBrain,
}: {
  mode: IslandMode;
  brainOpen: boolean;
  onToggleChat: () => void;
  onFold: () => void;
  onCloseBrain: () => void;
}) {
  useAppKeyboard(
    (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        onToggleChat();
        return true;
      }
      if (e.key !== 'Escape') return false;
      const el = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value) return false;
      if (brainOpen) {
        onCloseBrain();
        return true;
      }
      if (mode === 'chat' || mode === 'tall') {
        onFold();
        return true;
      }
      return false;
    },
    { priority: ISLAND_KEY_PRIORITY },
  );
}
