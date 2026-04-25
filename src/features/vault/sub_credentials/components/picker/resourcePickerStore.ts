/**
 * Global resource-picker store.
 *
 * The picker must outlive the parent form/panel that triggered it — when a
 * Catalog form dispatches `GO_LIST` after save, or an autopilot panel resets,
 * the underlying tree unmounts. A locally-mounted picker disappears with it.
 *
 * The fix: keep picker state in a module-level Zustand store and render the
 * actual `<ResourcePicker>` once at App-root via `<ResourcePickerHost />`.
 * Any caller can dispatch `promptIfScoped` and the picker shows up regardless
 * of which subtree is mounted.
 */
import { create } from 'zustand';

import type { ResourceSpec } from '@/lib/types/types';

interface ResourcePickerState {
  /** Active prompt — null when picker is hidden. */
  active: {
    credentialId: string;
    connectorLabel: string;
    specs: ResourceSpec[];
    /** Resolves when the picker closes (commit, skip, or cancel). */
    resolve: () => void;
  } | null;
  /** Dispatch — opens the picker and returns a promise that resolves on close. */
  prompt: (args: {
    credentialId: string;
    connectorLabel: string;
    specs: ResourceSpec[];
  }) => Promise<void>;
  /** Close handler used by the picker UI on commit / skip / cancel. */
  close: () => void;
}

export const useResourcePickerStore = create<ResourcePickerState>((set, get) => ({
  active: null,
  prompt: ({ credentialId, connectorLabel, specs }) => {
    return new Promise<void>((resolve) => {
      // Defensive: if a previous prompt is still open, resolve it before
      // opening the new one so callers don't deadlock.
      const prev = get().active;
      if (prev) prev.resolve();
      set({
        active: { credentialId, connectorLabel, specs, resolve },
      });
    });
  },
  close: () => {
    const cur = get().active;
    if (cur) {
      set({ active: null });
      cur.resolve();
    }
  },
}));
