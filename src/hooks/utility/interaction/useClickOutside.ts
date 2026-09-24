import { useEffect } from 'react';
import type { RefObject } from 'react';

export interface ClickOutsideOptions {
  /**
   * Escape is CLAIMED rather than merely observed: an Escape some inner control
   * already handled (`defaultPrevented`) is left alone, and the one this hook
   * acts on is `preventDefault`ed, so a surface-level Escape ladder that stops at
   * a handled event (the notepad's) does not also step back a layer.
   */
  claimEscape?: boolean;
}

/**
 * Closes a dropdown/popover when the user clicks outside its container or presses Escape.
 * No-op when `isOpen` is false, so listeners are only registered while the popover is open.
 *
 * Pass an ARRAY of refs when the panel is portalled away from its trigger: a
 * press inside any of them is "inside" (anchored-popover.md Gap 3), so the
 * press on the trigger that toggles the panel never also dismisses it.
 *
 * @param ref     - ref (or refs) attached to the container element(s)
 * @param isOpen  - whether the popover is currently open
 * @param onClose - called when a click-outside or Escape keystroke is detected
 * @param options - see {@link ClickOutsideOptions}
 */
export function useClickOutside(
  ref: RefObject<Element | null> | readonly RefObject<Element | null>[],
  isOpen: boolean,
  onClose: () => void,
  options?: ClickOutsideOptions,
): void {
  const claimEscape = options?.claimEscape ?? false;
  useEffect(() => {
    if (!isOpen) return;
    const refs: readonly RefObject<Element | null>[] = Array.isArray(ref) ? ref : [ref as RefObject<Element | null>];

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Nothing mounted yet is not "outside" — the single-ref form never closed then.
      if (!refs.some((r) => r.current)) return;
      if (refs.some((r) => r.current?.contains(target))) return;
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (claimEscape) {
        if (e.defaultPrevented) return;
        e.preventDefault();
      }
      onClose();
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, ref, onClose, claimEscape]);
}
