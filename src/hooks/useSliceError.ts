import { useMemo } from "react";
import type { SliceError } from "@/stores/storeTypes";

/**
 * Read a single scoped error from a domain store's sliceErrors map.
 *
 * @param useStore - A Zustand hook (e.g. useAgentStore)
 * @param action   - The action key passed to `reportError(..., { action })`
 * @returns The SliceError entry or null if no error is recorded for that action.
 *
 * @example
 * const err = useSliceError(useAgentStore, 'executePersona');
 * if (err) showBanner(err.message);
 */
export function useSliceError<T extends { sliceErrors: Record<string, SliceError> }>(
  useStore: (selector: (state: T) => SliceError | undefined) => SliceError | undefined,
  action: string,
): SliceError | null {
  const entry = useStore((s) => s.sliceErrors[action]);
  return entry ?? null;
}

/**
 * Read all scoped errors from a domain store.
 * Useful for rendering a list of active errors.
 */
export function useAllSliceErrors<T extends { sliceErrors: Record<string, SliceError> }>(
  useStore: (selector: (state: T) => Record<string, SliceError>) => Record<string, SliceError>,
): Array<SliceError & { action: string }> {
  const map = useStore((s) => s.sliceErrors);
  return useMemo(
    () =>
      Object.entries(map).map(([action, entry]) => ({ ...entry, action })),
    [map],
  );
}
