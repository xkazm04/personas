import { useEffect, useRef, useCallback, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { SidebarSection } from '@/lib/types/types';

export type UnsavedGuardAction = 'save' | 'discard' | 'stay';

export interface UnsavedGuardCallbacks {
  /** Save all pending changes. Throw to abort navigation. */
  onSave: () => Promise<void>;
  /** Discard all pending changes (reset draft state). */
  onDiscard: () => void;
}

interface UnsavedGuardState {
  /** Whether the guard modal is currently open. */
  isOpen: boolean;
  /** Resolve the guard by choosing an action. Called from the modal. */
  resolve: (action: UnsavedGuardAction) => void;
}

/**
 * Global unsaved-changes guard.
 *
 * Intercepts sidebar section navigation and window close when `isDirty` is true.
 * Shows a modal (via the returned state) so the user can Save, Discard, or Stay.
 *
 * Usage:
 * ```ts
 * const guard = useUnsavedGuard(isDirty, { onSave, onDiscard });
 * // render <UnsavedChangesModal isOpen={guard.isOpen} onAction={guard.resolve} />
 * ```
 */
export function useUnsavedGuard(
  isDirty: boolean,
  callbacks: UnsavedGuardCallbacks,
): UnsavedGuardState {
  const [isOpen, setIsOpen] = useState(false);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Pending navigation target when guard fires
  const pendingNavRef = useRef<SidebarSection | null>(null);

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
        pendingNavRef.current = newSection;
        setIsOpen(true);
      } else {
        lastSection = newSection;
      }
    });

    return unsub;
  }, []);

  // --- Resolve the guard modal ---
  const resolve = useCallback(async (action: UnsavedGuardAction) => {
    const target = pendingNavRef.current;

    if (action === 'stay') {
      pendingNavRef.current = null;
      setIsOpen(false);
      return;
    }

    if (action === 'save') {
      try {
        await callbacksRef.current.onSave();
      } catch {
        // Save failed — stay on page so user can fix the issue
        pendingNavRef.current = null;
        setIsOpen(false);
        return;
      }
    }

    if (action === 'discard') {
      callbacksRef.current.onDiscard();
    }

    // Navigate to the pending target
    pendingNavRef.current = null;
    setIsOpen(false);
    if (target) {
      useSystemStore.getState().setSidebarSection(target);
    }
  }, []);

  return { isOpen, resolve };
}
