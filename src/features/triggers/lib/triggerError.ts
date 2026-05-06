/**
 * Single source of truth for the `TriggerError.kind` → presentation surface
 * mapping. Every UI surface that consumes `usePipelineStore(s => s.triggerError)`
 * must route through `useRenderTriggerError` (or, in non-React contexts, call
 * `triggerErrorPresentation` directly) so a `crud` error is never toasted and
 * a `fetch` error is never silently rendered inline on a screen that has no
 * form to attach it to.
 *
 * The contract itself is documented on `TriggerErrorKind` in
 * `src/stores/slices/pipeline/triggerSlice.ts`. The exhaustive switch below
 * is what enforces it: adding a new kind without classifying it fails
 * type-checking.
 */
import { useEffect } from 'react';
import type { TriggerError, TriggerErrorKind } from '@/stores/slices/pipeline/triggerSlice';
import { useToastStore } from '@/stores/toastStore';

export type TriggerErrorPresentation = 'inline' | 'toast';

/**
 * Pure classifier — maps a `TriggerErrorKind` to its presentation surface.
 * Exhaustiveness-checked: a new kind that is not assigned to either bucket
 * fails the build at the `_exhaustive: never` line.
 */
export function triggerErrorPresentation(kind: TriggerErrorKind): TriggerErrorPresentation {
  switch (kind) {
    case 'crud':
    case 'validation':
      return 'inline';
    case 'fetch':
      return 'toast';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Hook for components that read `triggerError` from the pipeline store.
 *
 * Returns the message to render *inline* (or `null` if the kind belongs on a
 * different surface or no error is present), and side-effects an error toast
 * for `fetch` kinds. Callers should render the returned string in their own
 * inline error region; the toast is dispatched here so every consumer gets
 * identical toast UX without duplicating the wiring.
 */
export function useRenderTriggerError(error: TriggerError | null): string | null {
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (error && triggerErrorPresentation(error.kind) === 'toast') {
      addToast(error.message, 'error');
    }
    // The slice always sets a fresh `TriggerError` object on each failure and
    // clears to `null` on the next operation, so reference equality is a
    // sufficient dep — we fire one toast per distinct error.
  }, [error, addToast]);

  if (!error) return null;
  return triggerErrorPresentation(error.kind) === 'inline' ? error.message : null;
}
