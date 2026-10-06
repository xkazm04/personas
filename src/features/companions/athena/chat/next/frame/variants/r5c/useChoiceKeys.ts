/**
 * Folio · the page's keys, above the spread's own (← → Space) and the layer's
 * (Esc, Alt+W): 1-9 take that paragraph, ↑ / ↓ move between paragraphs (Enter
 * then takes the focused one), 0 asks for her note, Enter takes her pick once
 * her note is in the margin, or asks for it first.
 */

import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { CardModel } from '../c/bodies/model';

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function useChoiceKeys(model: CardModel) {
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
        const paras = Array.from(document.querySelectorAll<HTMLButtonElement>('.r5c [data-card-choice]')).filter((b) => !b.disabled);
        if (!paras.length) return false;
        e.preventDefault();
        const at = paras.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        paras[at < 0 ? (step > 0 ? 0 : paras.length - 1) : (at + step + paras.length) % paras.length]!.focus();
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
        // Enter on a focused control belongs to that control.
        if (el && el !== document.body && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY')) return false;
        const picked = model.choices.find((c) => c.recommended);
        if (picked && rec?.revealed && !model.busy) {
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
