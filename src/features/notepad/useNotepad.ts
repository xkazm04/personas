import { useSyncExternalStore } from 'react';

import type { DevNote } from '@/lib/bindings/DevNote';

import {
  archivedNotes,
  notesSnapshot,
  openNotes,
  orderSnapshot,
  saveStatesSnapshot,
  statusSnapshot,
  subscribeNotepad,
  type NoteSaveState,
} from './notepadStore';

/**
 * `useSyncExternalStore` bindings for the notepad module store.
 *
 * Views subscribe rather than snapshotting into `useState`, so a write from
 * anywhere — the sweeper's refetch, another surface's action — paints
 * immediately. Each getter returns the SAME container until a write
 * invalidates the cache, which is the stability the hook requires.
 */

export function useNotepadNotes(): Readonly<Record<string, DevNote>> {
  return useSyncExternalStore(subscribeNotepad, notesSnapshot, notesSnapshot);
}

export function useNotepadOrder(): readonly string[] {
  return useSyncExternalStore(subscribeNotepad, orderSnapshot, orderSnapshot);
}

export function useNotepadSaveStates(): Readonly<Record<string, NoteSaveState>> {
  return useSyncExternalStore(subscribeNotepad, saveStatesSnapshot, saveStatesSnapshot);
}

export function useNotepadStatus(): Readonly<{ loading: boolean; loaded: boolean }> {
  return useSyncExternalStore(subscribeNotepad, statusSnapshot, statusSnapshot);
}

/** Open (non-archived) notes in tab order. Derived from the subscribed
 *  snapshots rather than memoized separately — both inputs are referentially
 *  stable between writes, so the derivation runs once per actual change. */
export function useOpenNotes(): DevNote[] {
  useNotepadNotes();
  useNotepadOrder();
  return openNotes();
}

export function useArchivedNotes(): DevNote[] {
  useNotepadNotes();
  useNotepadOrder();
  return archivedNotes();
}
