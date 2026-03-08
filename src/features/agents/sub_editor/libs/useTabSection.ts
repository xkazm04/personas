import { useEffect } from 'react';
import { useDebouncedSave } from '@/hooks';
import { useEditorDirty } from './EditorDocument';

// -- Types --

/** Save semantics for a tab section. */
export type TabSaveMode = 'debounced' | 'immediate' | 'explicit';

/**
 * Configuration for a single editor tab section.
 *
 * Each tab passes one of these to `useTabSection` to participate in
 * the EditorDocument dirty / save / cancel protocol.
 */
export interface TabSectionConfig {
  /** Tab identifier registered in the DirtyStore (e.g. 'settings', 'model', 'prompt'). */
  tab: string;
  /** Whether this tab has unsaved changes. */
  isDirty: boolean;
  /** Persist current state to backend. */
  save: () => Promise<void>;
  /**
   * Save semantics:
   * - `'debounced'`  -- auto-saves after `delay` ms of inactivity.
   * - `'immediate'`  -- saves inline on every mutation (no dirty tracking needed).
   * - `'explicit'`   -- saves only on manual trigger (button click / saveAll).
   */
  mode: TabSaveMode;
  /** Debounce delay in ms (`mode: 'debounced'` only, default 800). */
  delay?: number;
  /** Dependencies that reset the debounce timer (`mode: 'debounced'` only). */
  deps?: readonly unknown[];
  /** Guard that prevents debounced save from firing (`mode: 'debounced'` only, default true). */
  enabled?: boolean;
}

/** Handle returned by useTabSection. */
export interface TabSectionHandle {
  /** True while the save function is executing (debounced mode only). */
  isSaving: boolean;
  /** Cancel any pending debounced save. No-op for non-debounced modes. */
  cancel: () => void;
}

// -- Hook --

const noop = () => {};

/**
 * Unified hook for editor tab sections to participate in the
 * EditorDocument dirty / save / cancel protocol.
 *
 * Encapsulates debounce wiring, DirtyStore registration, and unmount cleanup.
 */
export function useTabSection(config: TabSectionConfig): TabSectionHandle {
  const { tab, isDirty, save, mode, delay = 800, deps = [], enabled = true } = config;

  // useDebouncedSave is always called (hooks can't be conditional).
  // For non-debounced modes the isDirty guard is false so it never fires.
  const { isSaving, cancel } = useDebouncedSave(
    save,
    mode === 'debounced' && isDirty && enabled,
    deps,
    delay,
  );

  // Register with EditorDocument's DirtyStore.
  // Only debounced tabs need a cancel callback (to stop pending timers on saveAll/cancelAll).
  const cancelForStore = mode === 'debounced' ? cancel : undefined;
  const unregister = useEditorDirty(tab, isDirty, save, cancelForStore);

  // Auto-unregister on unmount so consumers don't need manual cleanup.
  useEffect(() => unregister, [unregister]);

  return { isSaving, cancel: mode === 'debounced' ? cancel : noop };
}
