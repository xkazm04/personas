// The loupe's keyboard: ← → move along the filmstrip, the grease-pencil
// glyphs mark the frame (x ~ o *), p toggles pin mode, Escape goes back to
// the light table. Never fires while the owner types (a note, a pin) and
// never with Ctrl/Meta/Alt held; route-level rung, so any modal above wins.
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import { bucketForKey } from './contactModel';

export interface LoupeKeyActions {
  step: (delta: 1 | -1) => void;
  mark: (bucket: ContestReviewBucket) => void;
  togglePin: () => void;
  back: () => void;
}

/** Pure dispatch, exported for tests: true when the key was handled. */
export function dispatchLoupeKey(event: Pick<KeyboardEvent, 'key' | 'target' | 'ctrlKey' | 'metaKey' | 'altKey'>, a: LoupeKeyActions): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isTypingTarget(event.target)) return false;
  switch (event.key) {
    case 'ArrowRight':
      a.step(1);
      return true;
    case 'ArrowLeft':
      a.step(-1);
      return true;
    case 'p':
    case 'P':
      a.togglePin();
      return true;
    case 'Escape':
      a.back();
      return true;
    default: {
      const bucket = bucketForKey(event.key);
      if (!bucket) return false;
      a.mark(bucket);
      return true;
    }
  }
}

export function useLoupeKeys(actions: LoupeKeyActions, enabled: boolean): void {
  useAppKeyboard(
    (event) => {
      const handled = dispatchLoupeKey(event, actions);
      if (handled) event.preventDefault();
      return handled;
    },
    { enabled, priority: ROUTE_DECISION_PRIORITY },
  );
}
