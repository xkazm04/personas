// Whether an ambient loop (the working sweep on a pile line) may run: motion
// allowed by the OS and the app's own setting, and the window visible. The
// Board's `is-still` reads the same two signals; the CSS gates on the media
// query and `html[data-motion]` again, so a stylesheet alone cannot run it.

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';

/** `ae-moving` for the root of a panel whose lines may sweep, else ''. */
export function useAmbientMotionClass(): string {
  const reduced = useReducedMotion();
  const visible = useDocumentVisibility();
  return !reduced && visible ? 'ae-moving' : '';
}
