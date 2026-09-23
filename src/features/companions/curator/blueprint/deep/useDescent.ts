/**
 * THE DESCENT - the row you clicked, grown.
 *
 * Nothing arrives from off-screen. Every panel in the nested layer starts life
 * as the cell it came out of: the row's own rect and its nine cell rects are
 * measured BEFORE the layer switches, and each panel is then played from that
 * rect to its own with a FLIP. `Esc` is the exact reverse - every panel goes
 * back into the cell it came from and the cursor lands on the row you left.
 *
 * With motion off the same descent is STATED instead of played: the origin
 * band is the row, still carrying its nine marks in their nine columns, and
 * the strips are already beneath it in the same left-to-right order. The end
 * state is identical; only the journey is skipped.
 */
import { useCallback, useRef, useState } from 'react';

import { CHANNEL_ORDER, type ChannelId } from '../model/channels';

export type Layer = 'ledger' | 'deep';

interface Rects {
  row: DOMRect;
  cells: Partial<Record<ChannelId, DOMRect>>;
}

const IN_MS = 420;
const OUT_MS = 300;
const STEP_MS = 26;

function measure(scope: HTMLElement | null, index: number): Rects | null {
  const row = scope?.querySelector<HTMLElement>(`[data-cb-row="${String(index)}"]`);
  if (!row) return null;
  const cells: Partial<Record<ChannelId, DOMRect>> = {};
  const nodes = row.querySelectorAll<HTMLElement>('[data-role="cb-ledger-cell"]');
  CHANNEL_ORDER.forEach((id, i) => {
    const node = nodes[i];
    if (node) cells[id] = node.getBoundingClientRect();
  });
  return { row: row.getBoundingClientRect(), cells };
}

function flip(el: HTMLElement, from: DOMRect, delay: number, duration: number): void {
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const sx = Math.max(0.02, from.width / to.width);
  const sy = Math.max(0.02, from.height / to.height);
  const inner = el.firstElementChild as HTMLElement | null;
  el.style.transition = 'none';
  el.style.transformOrigin = 'top left';
  el.style.transform = `translate(${String(from.left - to.left)}px,${String(from.top - to.top)}px) scale(${String(sx)},${String(sy)})`;
  if (inner) {
    inner.style.transition = 'none';
    inner.style.opacity = '0';
  }
  // Two frames: one to commit the start state, one to start the transition.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `transform ${String(duration)}ms cubic-bezier(.22,.72,.16,1) ${String(delay)}ms`;
      el.style.transform = 'none';
      if (inner) {
        inner.style.transition = `opacity ${String(Math.round(duration * 0.5))}ms linear ${String(delay + Math.round(duration * 0.42))}ms`;
        inner.style.opacity = '1';
      }
    });
  });
}

function clear(el: HTMLElement): void {
  el.style.transition = '';
  el.style.transform = '';
  el.style.transformOrigin = '';
  const inner = el.firstElementChild as HTMLElement | null;
  if (inner) {
    inner.style.transition = '';
    inner.style.opacity = '';
  }
}

export interface Descent {
  layer: Layer;
  animating: boolean;
  descend: (index: number) => void;
  ascend: () => void;
  /** Called by the deep layer once its panels are in the DOM. */
  playIn: (origin: HTMLElement | null, strips: HTMLElement[]) => void;
}

export function useDescent(
  ledgerRef: React.RefObject<HTMLElement | null>,
  deepRef: React.RefObject<HTMLElement | null>,
  reduced: () => boolean,
  onLand: (index: number) => void,
): Descent {
  const [layer, setLayer] = useState<Layer>('ledger');
  const [animating, setAnimating] = useState(false);
  const from = useRef<Rects | null>(null);
  const index = useRef(0);

  const descend = useCallback(
    (i: number) => {
      index.current = i;
      from.current = reduced() ? null : measure(ledgerRef.current, i);
      setLayer('deep');
    },
    [ledgerRef, reduced],
  );

  const playIn = useCallback(
    (origin: HTMLElement | null, strips: HTMLElement[]) => {
      const rects = from.current;
      from.current = null;
      if (!rects || !origin) return;
      setAnimating(true);
      flip(origin, rects.row, 0, 380);
      strips.forEach((el, i) => {
        const cell = rects.cells[CHANNEL_ORDER[i] ?? 1];
        if (cell) flip(el, cell, 90 + i * STEP_MS, IN_MS);
      });
      window.setTimeout(
        () => {
          clear(origin);
          strips.forEach(clear);
          setAnimating(false);
        },
        90 + strips.length * STEP_MS + IN_MS + 20,
      );
    },
    [],
  );

  const ascend = useCallback(() => {
    const land = () => {
      setLayer('ledger');
      setAnimating(false);
      onLand(index.current);
    };
    const deep = deepRef.current;
    // Layer one is still laid out underneath, so its rects are measurable.
    const target = reduced() ? null : measure(ledgerRef.current, index.current);
    if (!target || !deep) {
      land();
      return;
    }
    const origin = deep.querySelector<HTMLElement>('[data-role="cb-origin"]');
    const strips = Array.from(deep.querySelectorAll<HTMLElement>('[data-role="cb-strip"]'));
    setAnimating(true);
    const back = (el: HTMLElement, to: DOMRect, delay: number) => {
      const now = el.getBoundingClientRect();
      if (!now.width || !now.height) return;
      const inner = el.firstElementChild as HTMLElement | null;
      el.style.transformOrigin = 'top left';
      el.style.transition = `transform ${String(OUT_MS)}ms cubic-bezier(.4,0,.2,1) ${String(delay)}ms`;
      el.style.transform = `translate(${String(to.left - now.left)}px,${String(to.top - now.top)}px) scale(${String(Math.max(0.02, to.width / now.width))},${String(Math.max(0.02, to.height / now.height))})`;
      if (inner) {
        inner.style.transition = `opacity 150ms linear ${String(delay)}ms`;
        inner.style.opacity = '0';
      }
    };
    if (origin) back(origin, target.row, 0);
    strips.forEach((el, i) => {
      const cell = target.cells[CHANNEL_ORDER[i] ?? 1];
      if (cell) back(el, cell, (strips.length - 1 - i) * 14);
    });
    window.setTimeout(land, OUT_MS + (strips.length - 1) * 14 + 40);
  }, [deepRef, ledgerRef, onLand, reduced]);

  return { layer, animating, descend, ascend, playIn };
}
