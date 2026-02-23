import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Closes a dropdown/popover when the user clicks outside its container or presses Escape.
 * No-op when `isOpen` is false, so listeners are only registered while the popover is open.
 *
 * @param ref     - ref attached to the container element
 * @param isOpen  - whether the popover is currently open
 * @param onClose - called when a click-outside or Escape keystroke is detected
 */
export function useClickOutside(
  ref: RefObject<Element | null>,
  isOpen: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, ref, onClose]);
}
