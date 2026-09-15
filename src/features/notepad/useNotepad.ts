import { useEffect, useSyncExternalStore } from 'react';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';

import {
  archivedNotes,
  notesSnapshot,
  openNotes,
  orderSnapshot,
  planSummariesSnapshot,
  refreshPlanSummaries,
  saveStatesSnapshot,
  shippedNotes,
  statusSnapshot,
  subscribeNotepad,
  type NoteSaveState,
} from './notepadStore';
import { useShipLiveRevision } from './plan/useShipLive';

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

export function useNotepadStatus(): Readonly<{ loading: boolean; loaded: boolean; planSummariesStale: boolean }> {
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

/** Shipped notes, newest-shipped first — the archive drawer's second group.
 *  Subscribes to the plan summaries too, because that is where the ship stamp
 *  the ordering uses lives. */
export function useShippedNotes(): DevNote[] {
  useNotepadNotes();
  useNotepadOrder();
  useNotepadPlanSummaries();
  return shippedNotes();
}

export function useNotepadPlanSummaries(): Readonly<Record<string, NotePlanSummary>> {
  return useSyncExternalStore(subscribeNotepad, planSummariesSnapshot, planSummariesSnapshot);
}

/** The linked milestone's reading for one note, or `undefined` for a brainstorm
 *  note. Callers render the absence — there is no zeroed placeholder summary. */
export function usePlanSummary(noteId: string | null | undefined): NotePlanSummary | undefined {
  const all = useNotepadPlanSummaries();
  return noteId ? all[noteId] : undefined;
}

/**
 * Keep the plan join live for as long as the pad is open.
 *
 * `NOTEPAD_NOTE_CHANGED` covers the moves that touch a NOTE row. It does not
 * cover the ones that touch only the MILESTONE — a goal completing, a cut being
 * stamped from the Ship tab, a CLI ingest writing ratings — and those are
 * exactly what `goalsDone`, `cutAt` and `shippedAt` report. `useShipLiveRevision`
 * is the Ship tables' own push+reconcile signal, so this is the same wiring the
 * planner uses, pointed at the one query the pad reads.
 *
 * Mount this ONCE, in the pad's host. It is a fetch per revision change, not
 * per subscriber.
 */
export function useNotepadPlanLive(): void {
  const revision = useShipLiveRevision();
  useEffect(() => {
    // Skipped on the first run only in the sense that `load()` has already
    // fetched the same rows; a second read here is one cheap query and keeps
    // the effect honest rather than carrying a "have I run yet" flag.
    void refreshPlanSummaries();
  }, [revision]);
}
