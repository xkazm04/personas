/**
 * The table's keys: digits pick, arrows move, Enter plays, E takes the picked
 * card into the composer, S skips. The same bindings as the Setup desk.
 *
 * Scoped to the table element, not the window, and inert while a text field
 * has focus — so the composer still takes every letter, including E and S.
 * Enter is also left alone on any button or link: there it already means
 * "press this", and playing a card as well would be a second action from one
 * key. Modifier chords pass through untouched (Ctrl+S is not a skip).
 */

import type { KeyboardEvent } from 'react';

const isTyping = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable === true);
};

const isControl = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  return !!node && (node.tagName === 'BUTTON' || node.tagName === 'A' || node.getAttribute('role') === 'button');
};

interface TableKeys {
  count: number;
  picked: number;
  setPicked: (next: number) => void;
  play: (index: number) => void;
  edit: (index: number) => void;
  skip: () => void;
}

export function tableKeyHandler({ count, picked, setPicked, play, edit, skip }: TableKeys) {
  return (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const digit = Number(e.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= count) {
      setPicked(digit - 1);
    } else if (e.key === 'ArrowRight' && count > 0) {
      setPicked(Math.min(picked + 1, count - 1));
    } else if (e.key === 'ArrowLeft' && count > 0) {
      setPicked(Math.max(picked - 1, 0));
    } else if (e.key === 'Enter' && picked < count && !isControl(e.target)) {
      play(picked);
    } else if (key === 'e' && picked < count) {
      edit(picked);
    } else if (key === 's') {
      skip();
    } else {
      return;
    }
    e.preventDefault();
  };
}
