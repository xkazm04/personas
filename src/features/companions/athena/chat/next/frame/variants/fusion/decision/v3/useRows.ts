/**
 * Fusion · decision v3 - the rows' motion and echoes:
 * - `useRowFlight`: each row leaves the rail's attention circle
 *   (`[data-fusion-anchor]`) and slides home into the stack, top to bottom,
 *   on the product's ease; reduced motion simply shows them. Measured before
 *   paint, so a row never flashes in its slot first.
 * - `useTakenEcho`: which row was just taken (a click, its digit, or Enter on
 *   her pick), so it can confirm while the stage moves on. It only listens
 *   (through the app keyboard registry, returning false); `useAnswerKeys`
 *   owns what the keys do.
 * - `useHighlightPick`: once her pick lands, the palette highlight lands on
 *   it (focus), unless the operator already holds a row or a field.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { animate } from 'framer-motion';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { CardModel } from '../../../c/bodies/model';
import { EASE, isTyping } from '../../text';

export function useRowFlight(listRef: React.RefObject<HTMLOListElement | null>, count: number) {
  const { shouldAnimate } = useMotion();
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !shouldAnimate) return;
    const anchor = document.querySelector('[data-fusion-anchor]')?.getBoundingClientRect();
    const rows = Array.from(list.children) as HTMLElement[];
    for (const el of rows) el.style.transform = '';
    const rects = rows.map((el) => el.getBoundingClientRect());
    for (const el of rows) el.style.opacity = '0';
    const runs = rows.map((el, i) => {
      const r = rects[i]!;
      // The row leaves the circle right edge first (origin: its right end), small, and unfolds home.
      const dx = anchor ? anchor.left + anchor.width / 2 - r.right : 220;
      const dy = anchor ? (anchor.top + anchor.height / 2 - (r.top + r.height / 2)) * 0.8 : -80;
      el.style.transformOrigin = 'right center';
      return animate(
        el,
        { x: [dx, 0], y: [dy, 0], scale: [0.22, 1], opacity: [0, 1] },
        { duration: 0.5, delay: 0.12 + i * 0.06, ease: EASE },
      );
    });
    return () => {
      runs.forEach((r) => r.stop());
      for (const el of rows) {
        el.style.transform = '';
        el.style.opacity = '';
        el.style.transformOrigin = '';
      }
    };
  }, [listRef, count, shouldAnimate]);
}

/** One rung above `useAnswerKeys` (FULLSCREEN + 2): sees the key first, never takes it. */
const ECHO_PRIORITY = FULLSCREEN_LAYER_PRIORITY + 3;

export function useTakenEcho(model: CardModel) {
  const [taken, setTaken] = useState<number | null>(null);
  useAppKeyboard(
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat || model.busy || isTyping(document.activeElement)) return false;
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (model.choices[i]) setTaken(i);
        return false;
      }
      if (e.key !== 'Enter') return false;
      const el = document.activeElement;
      // A focused control's Enter is its own click (the row's onClick echoes itself).
      if (el && el !== document.body && ['BUTTON', 'A', 'SUMMARY'].includes(el.tagName)) return false;
      const at = model.choices.findIndex((c) => c.recommended);
      if (at >= 0) setTaken(at);
      return false;
    },
    { priority: ECHO_PRIORITY },
  );
  // A failed run hands the row back.
  return [model.error ? null : taken, setTaken] as const;
}

export function useHighlightPick(rows: React.RefObject<(HTMLButtonElement | null)[]>, at: number) {
  useEffect(() => {
    if (at < 0) return;
    const el = document.activeElement;
    if (isTyping(el) || el?.closest('[data-fusion-answer]')) return;
    const row = rows.current?.[at];
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }, [rows, at]);
}
