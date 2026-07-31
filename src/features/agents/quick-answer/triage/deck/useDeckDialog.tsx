// useDeckDialog — the deck's dialog contract: focus in, focus out, focus kept,
// and the body scrolled by the keyboard.
//
// Kept apart from `useDeckControls` on purpose. That hook owns everything
// between "the reviewer expressed an intent" and "the queue recorded a
// verdict"; none of this decides anything. What it does is make the surface
// USABLE without a mouse, which the deck was not:
//
//  • The prose scroller had no `tabIndex` and no focusable descendant, and the
//    deck bound no vertical keys — `←`/`→` are verdicts. A review with a
//    40-line description or a long evidence blob was therefore UNDECIDABLE by
//    keyboard: you could only read the first ~15 lines of what you approved.
//  • The deck was a bare `motion.section` with an `aria-label`. No
//    `role="dialog"`, no focus trap, no restore: Tab walked into the route
//    underneath, and on close focus landed on `<body>`, so reopening meant
//    tabbing from the top of the app.
//
// The approach is lifted from `lib/ui/BaseModal` — capture the trigger, rAF the
// first focus, cycle Tab across the panel's focusables, restore on close —
// rather than invented here. BaseModal itself is NOT reused: it is a centred
// (or right-drawer) panel with a backdrop, its own animation variants and a
// modal-stack position, while the deck is a full-app surface pinned under the
// title bar with no backdrop and its own entrance. Wrapping the deck in it
// would mean overriding every one of those.
//
// (A hook in a `.tsx` file, like its sibling: the deck variant is scoped to
// `triage/deck/*.tsx`, so the extension is the constraint, not a preference.)
import { useCallback, useEffect, useRef } from 'react';

/** Everything the browser will let a keyboard reach. Same list as BaseModal. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** One arrow press. A few lines, not a jump — this is reading, not paging. */
const LINE_STEP_PX = 64;
/** A page press keeps an overlap line so the eye can stitch the two views. */
const PAGE_OVERLAP = 0.85;

/** Vertical keys are RESERVED for the body. None of them may become a verdict. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export interface DeckDialog {
  /** Attach to the deck's root element — the dialog panel. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Attach to the top card's prose scroller. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** Scroll the body if `key` is one of the reserved vertical keys. */
  scrollBody: (key: string) => boolean;
  /** BaseModal's Tab cycling, applied to the deck's own focusables. */
  cycleTab: (event: KeyboardEvent) => boolean;
  /**
   * Pull focus back into the deck when it has fallen out — every verdict
   * remounts the top card, which takes the focused scroller with it and drops
   * focus on `<body>`, quietly ending the trap after one decision.
   */
  recoverFocus: () => void;
}

export function useDeckDialog(): DeckDialog {
  const containerRef = useRef<HTMLElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  /**
   * The body first, not the first button.
   *
   * BaseModal focuses the first focusable descendant, which here is a kind
   * filter chip. For a surface whose whole job is "read this, then rule on it",
   * landing on the prose means the reviewer can scroll immediately and Tab
   * still reaches every control from there.
   */
  const focusFirst = useCallback(() => {
    const target = scrollerRef.current ?? focusablesIn(containerRef.current)[0];
    target?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(focusFirst);
    return () => {
      cancelAnimationFrame(raf);
      // Back to the title-bar capsule that opened the deck. Without this the
      // reviewer lands on `<body>` and has to tab from the top of the app to
      // reopen the queue they were just working through.
      triggerRef.current?.focus?.({ preventScroll: true });
      triggerRef.current = null;
    };
  }, [focusFirst]);

  const recoverFocus = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const active = document.activeElement;
    // Only when focus has genuinely escaped: a reviewer who just clicked a
    // flank button is standing exactly where they meant to.
    if (active && active !== document.body && root.contains(active)) return;
    focusFirst();
  }, [focusFirst]);

  const scrollBody = useCallback((key: string) => {
    if (!SCROLL_KEYS.has(key)) return false;
    const el = scrollerRef.current;
    // Still consumed with no scroller: a question card replaces the prose with
    // its input, and ArrowDown must not fall through to the route underneath.
    if (!el) return true;
    const page = Math.max(LINE_STEP_PX, el.clientHeight * PAGE_OVERLAP);
    if (key === 'Home') el.scrollTo({ top: 0 });
    else if (key === 'End') el.scrollTo({ top: el.scrollHeight });
    else if (key === 'ArrowDown') el.scrollBy({ top: LINE_STEP_PX });
    else if (key === 'ArrowUp') el.scrollBy({ top: -LINE_STEP_PX });
    else if (key === 'PageDown') el.scrollBy({ top: page });
    else el.scrollBy({ top: -page });
    return true;
  }, []);

  const cycleTab = useCallback((event: KeyboardEvent) => {
    const root = containerRef.current;
    if (event.key !== 'Tab' || !root) return false;
    const focusable = focusablesIn(root);
    if (focusable.length === 0) return false;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;

    // Tab out of the panel in either direction wraps back into it. The extra
    // clause over BaseModal's is `!root.contains(active)`: the deck can lose
    // focus to `<body>` mid-session (see `recoverFocus`), and from there Tab
    // would otherwise walk straight into the route rendered underneath.
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }, []);

  return { containerRef, scrollerRef, scrollBody, cycleTab, recoverFocus };
}
