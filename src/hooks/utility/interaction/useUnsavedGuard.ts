import { useEffect, useRef, useCallback, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { resolveError } from '@/lib/errors/errorRegistry';
import type { SidebarSection, SettingsTab } from '@/lib/types/types';

export type UnsavedGuardAction = 'save' | 'discard' | 'stay';

export interface UnsavedGuardCallbacks {
  /** Save all pending changes. Throw to abort navigation. */
  onSave: () => Promise<void>;
  /** Discard all pending changes (reset draft state). */
  onDiscard: () => void;
}

export interface UnsavedGuardOptions {
  /** Also intercept settingsTab changes (for settings sub-tab navigation). */
  guardSettingsTab?: boolean;
}

interface UnsavedGuardState {
  /** Whether the guard modal is currently open. */
  isOpen: boolean;
  /** Resolve the guard by choosing an action. Called from the modal. */
  resolve: (action: UnsavedGuardAction) => void;
  /**
   * Why the last Save failed, or null. The modal stays OPEN while this is set:
   * a failed save that closed the dialog was indistinguishable from Stay, and
   * the user walked away believing their work was written.
   */
  saveError: string | null;
  /** A save is in flight — the modal disables its three buttons. */
  isSaving: boolean;
}

/**
 * Global unsaved-changes guard.
 *
 * Intercepts sidebar section navigation (and optionally settingsTab navigation)
 * and window close when `isDirty` is true.
 * Shows a modal (via the returned state) so the user can Save, Discard, or Stay.
 *
 * Usage:
 * ```ts
 * const guard = useUnsavedGuard(isDirty, { onSave, onDiscard });
 * // render <UnsavedChangesModal isOpen={guard.isOpen} onAction={guard.resolve}
 * //   saveError={guard.saveError} isSaving={guard.isSaving} />
 * ```
 */
export function useUnsavedGuard(
  isDirty: boolean,
  callbacks: UnsavedGuardCallbacks,
  options?: UnsavedGuardOptions,
): UnsavedGuardState {
  const [isOpen, setIsOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Pending navigation target when guard fires
  type PendingNav =
    | { type: 'sidebar'; target: SidebarSection }
    | { type: 'settingsTab'; target: SettingsTab };
  const pendingNavRef = useRef<PendingNav | null>(null);

  // --- beforeunload handler for window/tab close ---
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Modern browsers show their own message; returnValue is for legacy support
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // --- Intercept sidebar section navigation ---
  useEffect(() => {
    let lastSection = useSystemStore.getState().sidebarSection;

    const unsub = useSystemStore.subscribe((state) => {
      const newSection = state.sidebarSection;
      if (newSection === lastSection) return;

      if (dirtyRef.current) {
        // Revert the navigation immediately
        useSystemStore.setState({ sidebarSection: lastSection });
        // Store where the user wanted to go
        pendingNavRef.current = { type: 'sidebar', target: newSection };
        setSaveError(null);
        setIsOpen(true);
      } else {
        lastSection = newSection;
      }
    });

    return unsub;
  }, []);

  // --- Intercept settings tab navigation (opt-in) ---
  const guardSettingsTab = options?.guardSettingsTab ?? false;
  useEffect(() => {
    if (!guardSettingsTab) return;

    let lastTab = useSystemStore.getState().settingsTab;

    const unsub = useSystemStore.subscribe((state) => {
      const newTab = state.settingsTab;
      if (newTab === lastTab) return;

      if (dirtyRef.current) {
        useSystemStore.setState({ settingsTab: lastTab });
        pendingNavRef.current = { type: 'settingsTab', target: newTab };
        setSaveError(null);
        setIsOpen(true);
      } else {
        lastTab = newTab;
      }
    });

    return unsub;
  }, [guardSettingsTab]);

  // --- Resolve the guard modal ---
  const resolve = useCallback(async (action: UnsavedGuardAction) => {
    const pending = pendingNavRef.current;

    if (action === 'stay') {
      pendingNavRef.current = null;
      setSaveError(null);
      setIsOpen(false);
      return;
    }

    if (action === 'save') {
      setSaveError(null);
      setIsSaving(true);
      try {
        await callbacksRef.current.onSave();
      } catch (err) {
        // The write did NOT happen. Keep the modal open, keep the pending
        // navigation, and say so: closing here left the user on a still-dirty
        // editor with no toast, which looks exactly like pressing Stay. Stay
        // and Discard remain available, so this is a report, not a trap.
        silentCatch('useUnsavedGuard:onSave')(err);
        // Known failures get the registry's friendly copy; an unclassified one
        // (a validation message, say) keeps its own words rather than a generic
        // line that hides the reason (error-message-resolution golden path).
        const raw = extractMessage(err);
        const friendly = resolveError(raw);
        setSaveError(friendly.category === 'unclassified' ? raw : friendly.message);
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
    }

    if (action === 'discard') {
      callbacksRef.current.onDiscard();
    }

    // Navigate to the pending target
    pendingNavRef.current = null;
    setSaveError(null);
    setIsOpen(false);
    if (pending) {
      if (pending.type === 'sidebar') {
        useSystemStore.getState().setSidebarSection(pending.target);
      } else {
        useSystemStore.getState().setSettingsTab(pending.target);
      }
    }
  }, []);

  return { isOpen, resolve, saveError, isSaving };
}
