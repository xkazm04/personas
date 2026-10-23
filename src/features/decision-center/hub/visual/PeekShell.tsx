/* eslint-disable custom/enforce-base-modal --
 * A NON-modal popover anchored under a strip chip, not a centred modal: the
 * board behind it stays live, so BaseModal's backdrop and focus trap would be
 * wrong. Escape and the walk keys are owned by `usePeekKeyboard`. Same call as
 * `QuickEditPopover`. */
/**
 * PeekShell — the anchored glass both peeks hang in (R2-C "Aurora Deck"): the
 * chip's lit tile, its name and how many wait, an action slot, the body, and
 * a footer that prints only the navigation keys (verdict keys sit on the row
 * they act on).
 *
 * `role="dialog"` on purpose, beyond semantics: the Monitor's own Escape
 * yields while any `[role="dialog"]` is in the DOM, and a popover a person can
 * act inside is a dialog, not a tooltip. Non-modal — the board stays live.
 *
 * Click outside closes it, through `useClickOutside` — but DEFERRED a task.
 * That hook also closes on Escape from a `document` listener, which runs
 * before the app keyboard's `window` one; closing there would let React
 * unmount the peek before `usePeekKeyboard` can stop the press, and the same
 * Escape would close the Monitor behind it. Deferred, the keyboard hook still
 * owns Escape; the close only lands if the same chip's peek is still open.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';

import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import type { ChipCount } from '../../model/decisionModel';
import { Keycap } from '../../deck/parts';
import { PEEK_ENTER, PEEK_EXIT, peekTransition } from './peekMotion';

/**
 * What a peek calls itself: a mandate lane, or Ready. `id` lands on
 * `data-chip` for tests.
 */
export interface PeekIdentity {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** Gutter the peek keeps from the window's edges, in px. */
const GUTTER = 16;

export function PeekShell({
  identity, lamp, count, anchor, actions, footer, onClose, children,
}: {
  identity: PeekIdentity;
  /** The chip's lamp — the glass is lit from its corner in that tone. */
  lamp: ChipCount['lamp'];
  /** How many wait; null while the list has not been read. */
  count: number | null;
  /** The chip it hangs from. */
  anchor: HTMLElement | null;
  actions?: ReactNode;
  /** Extra walk keys printed after the arrows (the lane peek's 1-4 and O). */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const still = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  anchorRef.current = anchor;
  const [left, setLeft] = useState(0);
  const { label, icon: Icon } = identity;
  const tone = lamp;

  // The peek takes the focus while it is open and gives it back to its chip
  // when it closes. Taking it is what hides the chip's own tooltip (a tip
  // hides on blur), so the tip never sits over the peek's header; the keys
  // stay the app keyboard's, which listens on the window.
  useEffect(() => {
    const el = panel.current;
    el?.focus({ preventScroll: true });
    return () => {
      const at = document.activeElement;
      if (el && (at === null || at === document.body || el.contains(at))) anchorRef.current?.focus({ preventScroll: true });
    };
  }, []);

  const deferredClose = useCallback(() => { setTimeout(onClose, 0); }, [onClose]);
  const inside = useMemo(() => [panel, anchorRef] as const, []);
  useClickOutside(inside, true, deferredClose);

  // Anchored under the chip, kept there when the strip re-flows (labels <->
  // compact), and never past the window's edge.
  useLayoutEffect(() => {
    const box = panel.current?.offsetParent;
    if (!anchor || !(box instanceof HTMLElement)) return;
    const place = () => {
      const boxRect = box.getBoundingClientRect();
      const width = panel.current?.offsetWidth ?? 0;
      const room = window.innerWidth - boxRect.left;
      const at = anchor.getBoundingClientRect().left - boxRect.left;
      setLeft(Math.max(GUTTER - boxRect.left, Math.min(at, room - width - GUTTER)));
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(anchor);
    ro.observe(box);
    return () => ro.disconnect();
  }, [anchor]);

  return (
    <motion.div
      ref={panel}
      role="dialog"
      aria-modal={false}
      tabIndex={-1}
      aria-label={tx(m.dc_hub_peek_aria, { label })}
      initial={PEEK_ENTER(still)}
      animate={{ opacity: 1, y: 0, scaleY: 1 }}
      exit={PEEK_EXIT(still)}
      transition={peekTransition}
      style={{ left, transformOrigin: 'top left' }}
      className={`au-scope au-glass au-hair au-l-${tone} au-t-${tone === 'neutral' ? 'accent' : tone} absolute top-full z-30 mt-2 flex outline-none max-h-[70vh] w-[500px] max-w-[calc(100vw-32px)] flex-col rounded-modal`}
      data-testid="decision-peek"
      data-chip={identity.id}
      data-still={still ? '' : undefined}
    >
      <header className="flex flex-shrink-0 items-center gap-2.5 px-4 pb-2 pt-3">
        <span className="au-tile flex h-8 w-8 items-center justify-center rounded-input"><Icon className="h-4 w-4" aria-hidden /></span>
        <span className="typo-heading text-foreground">{label}</span>
        {count !== null && (
          <span className="flex items-baseline gap-1 typo-caption">
            <span className="typo-heading tabular-nums text-foreground" data-testid="decision-peek-count">{count}</span>
            {m.dc_hub_peek_waiting}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">{actions}</span>
      </header>
      {children}
      <footer className="flex flex-shrink-0 items-center gap-1.5 border-t border-primary/10 px-4 py-2 typo-caption" aria-hidden>
        <Keycap>↑</Keycap><Keycap>↓</Keycap> {m.dc_hub_key_move}
        {/* One walk hint: the arrows, then the lane keys the lane peek adds,
            then the word they all share ("chips" until the WP10 cutover). */}
        <Keycap className="ml-2">←</Keycap><Keycap>→</Keycap>{footer} {m.ml_lane_key_lanes}
        <span className="ml-auto flex items-center gap-1.5"><Keycap>Esc</Keycap> {t.common.close}</span>
      </footer>
    </motion.div>
  );
}
