// "Open the pad on this note with its thread showing" — the door a surface
// OUTSIDE the pad (the LiveCommsStack) uses.
//
// A module request, not a store field: the request is consumed exactly once by
// the host, and the host is lazy — it may not even be mounted when the request
// is made. The pad's own open flag is the system store's, so this module raises
// it and leaves the request for the host to read on mount (or on the next
// render, when the pad is already up).
import { useSyncExternalStore } from 'react';

import { useSystemStore } from '@/stores/systemStore';

let pending: string | null = null;
const subs = new Set<() => void>();

function emit(): void {
  for (const fn of [...subs]) fn();
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

const snapshot = () => pending;

/** Raise the pad on `noteId`'s editor with the thread popover open. */
export function openNotepadThread(noteId: string): void {
  pending = noteId;
  emit();
  useSystemStore.getState().notepadSetOpen(true);
}

/** The host's read of the outstanding request (`null` when none). */
export function useThreadRequest(): string | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The host has acted on the request. */
export function consumeThreadRequest(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

export function __resetThreadDeepLinkForTests(): void {
  pending = null;
  subs.clear();
}
