import { useState, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';

const VIEWPORT_MARGIN = 12;

/**
 * Clamps an absolute-positioned dropdown/popup so it stays within the viewport.
 *
 * For elements using `position: absolute` relative to a parent trigger. Measures the
 * element after render and applies corrective translate offsets if it overflows.
 * Returns a style object with the transform to apply.
 *
 * @param ref    - ref attached to the popup element
 * @param isOpen - whether the popup is currently visible
 */
export function useViewportClampAbsolute(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
): { transform: string } {
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });

  const measure = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    // Overflows right
    if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
      dx = window.innerWidth - VIEWPORT_MARGIN - rect.right;
    }
    // Overflows left
    if (rect.left + dx < VIEWPORT_MARGIN) {
      dx = VIEWPORT_MARGIN - rect.left;
    }
    // Overflows bottom
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
      dy = window.innerHeight - VIEWPORT_MARGIN - rect.bottom;
    }
    // Overflows top
    if (rect.top + dy < VIEWPORT_MARGIN) {
      dy = VIEWPORT_MARGIN - rect.top;
    }
    setOffset({ dx, dy });
  }, [ref]);

  useEffect(() => {
    if (!isOpen) {
      setOffset({ dx: 0, dy: 0 });
      return;
    }
    requestAnimationFrame(measure);
  }, [isOpen, measure]);

  return {
    transform: offset.dx !== 0 || offset.dy !== 0
      ? `translate(${offset.dx}px, ${offset.dy}px)`
      : '',
  };
}
