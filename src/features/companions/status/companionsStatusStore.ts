/**
 * The Companions status, as a module-scoped store.
 *
 * ## One read, one listener, one warm slot
 *
 * Several surfaces ask for this at once (the sidebar group headers, the landing
 * columns, whichever Setup page is open, the gate that mounts Athena's
 * overlays), and lazy routes unmount completely on nav-away. So the state lives
 * here, not in each component: a remount paints the last answer instead of
 * re-ghosting, the `companions://status-changed` subscription is opened once
 * and ref-counted, and a burst of mounts collapses into a single
 * `companions_status` call.
 *
 * A single slot, hand-rolled, is the sanctioned shape - `createModuleCache` is
 * for a cache with MULTIPLE keyed entries, which needs a declared cap. There is
 * exactly one companions status per app.
 *
 * ## Why this is its own file
 *
 * It imports the companions API and nothing else. `useCompanionsStatus` adds
 * Curator's registry override, which reaches into the Dev Tools registry-link
 * store and its API chain; the app-shell footer and the overlay gate need only
 * Athena's switch, and must not drag that chain into their bundle to get it.
 */
import { useSyncExternalStore } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { COMPANIONS_STATUS_EVENT, companionsStatus } from "@/api/companions";
import { extractMessage, silentCatch } from "@/lib/silentCatch";

import type { CompanionStatusDto, CompanionsStatusDto } from "../types";

export interface CompanionsStatusSlot {
  /** One entry per companion, in category order. Null until the first read settles. */
  companions: CompanionStatusDto[] | null;
  /** True while a read is in flight. */
  loading: boolean;
  /** Set when the last read failed. */
  error: string | null;
}

let slot: CompanionsStatusSlot = { companions: null, loading: true, error: null };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let unlistenPromise: Promise<UnlistenFn> | null = null;
let consumers = 0;

function notify(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CompanionsStatusSlot {
  return slot;
}

/**
 * Read the status. Concurrent callers share one call, and a read NEVER blanks
 * the rows it already has - a refresh keeps painting the last answer while it
 * is in flight (loading pattern v2, law 1).
 */
export function readCompanionsStatus(): Promise<void> {
  if (inFlight) return inFlight;
  slot = { ...slot, loading: true };
  notify();
  inFlight = companionsStatus()
    .then((dto: CompanionsStatusDto) => {
      slot = { companions: dto.companions, loading: false, error: null };
    })
    .catch((e: unknown) => {
      slot = { companions: slot.companions, loading: false, error: extractMessage(e) };
      silentCatch("companions_status")(e);
    })
    .finally(() => {
      inFlight = null;
      notify();
    });
  return inFlight;
}

/** Open the status subscription once, however many surfaces are mounted. */
export function attachCompanionsStatus(): void {
  consumers += 1;
  if (unlistenPromise) return;
  unlistenPromise = listen<CompanionsStatusDto>(COMPANIONS_STATUS_EVENT, (event) => {
    slot = { companions: event.payload.companions, loading: false, error: null };
    notify();
  });
  unlistenPromise.catch(silentCatch("companions:status-listen"));
  // Going from nobody-listening to somebody-listening is the one moment the
  // slot can be stale: no listener was open to hear a change. Re-read.
  void readCompanionsStatus();
}

export function detachCompanionsStatus(): void {
  consumers = Math.max(0, consumers - 1);
  if (consumers > 0 || !unlistenPromise) return;
  const pending = unlistenPromise;
  unlistenPromise = null;
  void pending.then((fn) => fn()).catch(silentCatch("companions:status-unlisten"));
}

/** Subscribe a component to the slot. */
export function useCompanionsStatusSlot(): CompanionsStatusSlot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Drop the warm slot and the subscription. Test-only: the module state is
 * deliberately process-wide, so a suite that does not reset it carries one
 * test's answer into the next.
 */
export function __resetCompanionsStatusForTests(): void {
  slot = { companions: null, loading: true, error: null };
  listeners.clear();
  inFlight = null;
  unlistenPromise = null;
  consumers = 0;
}
