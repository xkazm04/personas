import { useEffect, useRef, type RefObject } from 'react';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

/**
 * Everything focusable a dialog can hand the keyboard to. Kept here rather
 * than inline at each call site so "what counts as focusable" has one answer.
 */
export const DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogKeyboardOptions {
  /** Off while the dialog is closed; turning it off restores focus. */
  enabled?: boolean;
  /** Rung on the ladder in `AppKeyboardProvider`. */
  priority?: number;
  /** Set false for a surface that must not close on Escape. */
  closeOnEscape?: boolean;
}

/**
 * The three things a modal surface owes the keyboard: focus moves INTO it when
 * it opens, Tab cannot leave it, and closing returns focus to whatever summoned
 * it. Escape closes, once - the handler reports the key as consumed, so a
 * surface underneath that also listens does not close a second thing.
 *
 * Extracted from `BaseModal`, which implemented exactly this inline and was the
 * only surface in the app that had it; `FullScreenOverlay` is the first
 * adopter, and BaseModal is the intended second so the selector and the trap
 * stop existing twice.
 */
export function useDialogKeyboard(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: DialogKeyboardOptions = {},
): void {
  const { enabled = true, priority = 0, closeOnEscape = true } = options;
  const triggerRef = useRef<HTMLElement | null>(null);

  // Remember the summoner and move focus inside. The rAF lets the surface (and
  // any entrance animation) commit first, so the first focusable really exists.
  useEffect(() => {
    if (!enabled) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(document.activeElement)) return;
      container.querySelector<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Give focus back on close/unmount, never to a node that has since left the
  // document (a restore into a detached element silently focuses <body>).
  useEffect(() => {
    if (!enabled) return;
    return () => {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, [enabled]);

  useAppKeyboard(
    (event) => {
      if (closeOnEscape && event.key === 'Escape') {
        onClose();
        // Reporting the key as consumed is what makes this ONE close: a list
        // inside that also listens for Escape never sees it.
        return true;
      }
      if (event.key !== 'Tab') return false;
      const container = containerRef.current;
      if (!container) return false;
      const focusable = container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return false;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
        return true;
      }
      if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
        return true;
      }
      return false;
    },
    { enabled, priority },
  );
}
