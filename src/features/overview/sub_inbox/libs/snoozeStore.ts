/**
 * Snooze store — localStorage-backed map of `inbox-item-id → snoozed-until ISO`.
 *
 * Snoozed items are hidden from the Today / This Week swimlanes until the
 * snooze time elapses; they show only in the Snoozed swimlane. The store is
 * read at hook level via `useSyncExternalStore` so the page rerenders on
 * snooze/unsnooze without a global Zustand slice.
 */

import { silentCatch } from '@/lib/silentCatch';

const STORAGE_KEY = 'personas.inbox.snoozed.v1';

export type SnoozeMap = Record<string, string>;

const subscribers = new Set<() => void>();

function read(): SnoozeMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as SnoozeMap;
  } catch (err) {
    silentCatch('inbox.snoozeStore.read')(err);
    return {};
  }
}

function write(next: SnoozeMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    silentCatch('inbox.snoozeStore.write')(err);
  }
  for (const cb of subscribers) cb();
}

export function getSnoozeMap(): SnoozeMap {
  return read();
}

export function isSnoozed(id: string, now: number = Date.now()): boolean {
  const until = read()[id];
  if (!until) return false;
  return Date.parse(until) > now;
}

export function snoozeItem(id: string, durationMinutes: number) {
  const until = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  const next = { ...read(), [id]: until };
  write(next);
}

export function unsnoozeItem(id: string) {
  const current = read();
  if (!(id in current)) return;
  const next = { ...current };
  delete next[id];
  write(next);
}

export function pruneExpired(now: number = Date.now()): void {
  const current = read();
  let changed = false;
  const next: SnoozeMap = {};
  for (const [id, until] of Object.entries(current)) {
    if (Date.parse(until) > now) {
      next[id] = until;
    } else {
      changed = true;
    }
  }
  if (changed) write(next);
}

export function subscribeSnooze(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
