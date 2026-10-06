/**
 * The decision sheet's keys, live only while a sheet with a model is mounted:
 * 1-9 take that tile, 0 asks Athena for her pick, Enter takes her pick once
 * she has given it. A key never fires while the caret is in a field.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { CardModel } from '../c/bodies/model';

/** Above the layer's own Esc/Alt+W (FULLSCREEN_LAYER_PRIORITY) and the sheet's walk keys. */
export const DECISION_KEY_PRIORITY = FULLSCREEN_LAYER_PRIORITY + 2;

export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function useDecisionKeys(model: CardModel) {
  useAppKeyboard(
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(document.activeElement)) return false;
      if (/^[1-9]$/.test(e.key)) {
        const choice = model.choices[Number(e.key) - 1];
        if (!choice || model.busy) return false;
        e.preventDefault();
        void choice.run();
        return true;
      }
      const rec = model.recommendation;
      if (e.key === '0' && rec?.reveal && !rec.revealed) {
        e.preventDefault();
        rec.reveal();
        return true;
      }
      if (e.key === 'Enter') {
        const el = document.activeElement;
        if (el && el !== document.body && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY')) return false;
        const pick = model.choices.find((c) => c.recommended);
        if (!pick || model.busy) return false;
        e.preventDefault();
        void pick.run();
        return true;
      }
      return false;
    },
    { priority: DECISION_KEY_PRIORITY },
  );
}
