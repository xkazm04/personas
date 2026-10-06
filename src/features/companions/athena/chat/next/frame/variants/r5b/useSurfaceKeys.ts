/**
 * The control surface's keys, above the layer's own: 1-9 press that key, 0 asks
 * Athena (lights her pick), Enter confirms her pick once lit (or asks first),
 * Up / Down move focus across the keys. A focused control keeps its own Enter.
 * Left / Right (walk the waiting queue) and Esc (fold to the timeline) belong
 * to the surface frame.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { CardModel } from '../c/bodies/model';

export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function useSurfaceKeys(model: CardModel) {
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
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const keys = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-r5b-key]')).filter((b) => !b.disabled);
        if (!keys.length) return false;
        e.preventDefault();
        const at = keys.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        keys[at < 0 ? (step > 0 ? 0 : keys.length - 1) : (at + step + keys.length) % keys.length]!.focus();
        return true;
      }
      const rec = model.recommendation;
      if (e.key === '0' && rec?.reveal) {
        e.preventDefault();
        rec.reveal();
        return true;
      }
      if (e.key === 'Enter') {
        const el = document.activeElement;
        if (el && el !== document.body && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY')) return false;
        const picked = model.choices.find((c) => c.recommended);
        if (picked && !model.busy) {
          e.preventDefault();
          void picked.run();
          return true;
        }
        if (rec && !rec.revealed && rec.reveal) {
          e.preventDefault();
          rec.reveal();
          return true;
        }
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 2 },
  );
}
