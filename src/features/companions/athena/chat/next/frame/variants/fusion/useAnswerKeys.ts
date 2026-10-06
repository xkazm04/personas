/**
 * Fusion · the answer keys (the Oracle / Spread card model, copied from
 * `../c/bodies/CardBody.tsx`'s `useCardKeys`): live only while an item with a
 * model is on the stage. 1-9 take that answer, ↑/↓ move focus between the
 * answers, 0 asks Athena (reveals her pick, per the product's reveal rule),
 * Enter takes her pick once shown - or asks for it first. A key never fires
 * while the caret is in a field, and Enter on a focused control is that
 * control's.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { CardModel } from '../c/bodies/model';
import { isTyping } from './text';

/** Above the layer's Esc / Alt+W and the stage's walk keys. */
const ANSWER_KEY_PRIORITY = FULLSCREEN_LAYER_PRIORITY + 2;

export function useAnswerKeys(model: CardModel) {
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
        const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-fusion-answer]')).filter((b) => !b.disabled);
        if (!cards.length) return false;
        e.preventDefault();
        const at = cards.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        cards[at < 0 ? (step > 0 ? 0 : cards.length - 1) : (at + step + cards.length) % cards.length]!.focus();
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
        if (pick && !model.busy) {
          e.preventDefault();
          void pick.run();
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
    { priority: ANSWER_KEY_PRIORITY },
  );
}
