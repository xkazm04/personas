/**
 * Inbox snooze registry — the store behind the inbox's Defer and Dismiss
 * actions.
 *
 * Both actions are *inbox-local* by construction: an approval has no backend
 * "deferred" state and `persona_healing_issues` accepts only
 * `open | auto_fix_pending | resolved` (see
 * `src-tauri/db/src/repos/execution/healing.rs` VALID_STATUSES), so neither
 * verb can be pushed server-side without a schema change. What they CAN do
 * honestly is remove the item from *this operator's* inbox: Defer until a
 * deadline, Dismiss until it is un-dismissed. The underlying record is
 * untouched and still visible in its own surface (Approvals, Health).
 *
 * State is a plain `id -> untilMs` map persisted through the app's deduped
 * Web Storage door (`createDedupedStateStorage`) so a defer survives a reload
 * and a private window / blocked site data degrades to an in-memory map with a
 * Sentry breadcrumb instead of throwing.
 *
 * Reactivity is an external store (`useInboxSnooze`) plus ONE timer armed at
 * the earliest pending expiry, so a deferred item reappears on the clock
 * without any surface polling.
 */
import { silentCatch } from '@/lib/silentCatch';
import { createDedupedStateStorage } from '@/stores/util/dedupedStorage';

/** Sentinel `until` for Dismiss: far enough out to be "indefinite", still a
 *  finite JSON-serializable number. */
export const DISMISS_UNTIL_MS = 8_640_000_000_000_000;

/** Default Defer window. One hour is the card's contract: long enough to get
 *  out of the way, short enough that nothing is quietly lost. */
export const DEFER_DURATION_MS = 60 * 60 * 1000;

const STORAGE_KEY = 'personas.inbox.snooze.v1';

export type SnoozeMap = Readonly<Record<string, number>>;

const EMPTY: SnoozeMap = Object.freeze({});

/** `null` until the first read hydrates from storage. Deliberately NOT a
 *  `let loaded = false` latch: this one releases (see `resetInboxSnoozes`). */
let state: SnoozeMap | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

let storage: ReturnType<typeof createDedupedStateStorage> | null = null;
function store() {
  storage ??= createDedupedStateStorage();
  return storage;
}

function readStorage(): SnoozeMap {
  const raw = store().getItem(STORAGE_KEY);
  if (!raw) return EMPTY;
  try {
    // Boundary cast: the blob is written only by `writeStorage` below, which
    // always emits `Record<string, number>`; anything else is corrupt and is
    // dropped by the per-entry typeof check.
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY;
    const out: Record<string, number> = {};
    for (const [id, until] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof until === 'number' && Number.isFinite(until)) out[id] = until;
    }
    return out;
  } catch (err) {
    silentCatch('companion/inbox/snooze:parse')(err);
    return EMPTY;
  }
}

function writeStorage(next: SnoozeMap): void {
  store().setItem(STORAGE_KEY, JSON.stringify(next));
}

function current(): SnoozeMap {
  state ??= readStorage();
  return state;
}

function emit(): void {
  for (const l of listeners) l();
}

/** Arm a single timer at the earliest expiry so deferred items return on the
 *  clock. Expiries at {@link DISMISS_UNTIL_MS} are ignored — a dismiss has no
 *  useful wake-up. */
function rearm(now: number): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  let next = Infinity;
  for (const until of Object.values(current())) {
    if (until >= DISMISS_UNTIL_MS) continue;
    if (until > now && until < next) next = until;
  }
  if (!Number.isFinite(next)) return;
  timer = setTimeout(() => {
    timer = null;
    prune(Date.now());
  }, Math.max(1, next - now));
  // Never hold the process open for a UI convenience (node/test envs).
  (timer as unknown as { unref?: () => void }).unref?.();
}

function commit(next: SnoozeMap, now: number): void {
  state = next;
  writeStorage(next);
  rearm(now);
  emit();
}

/** Drop every entry whose deadline has passed. No-op (and no emit) when
 *  nothing expired, so an armed timer cannot cause a render storm. */
export function prune(now: number = Date.now()): void {
  const next: Record<string, number> = {};
  let changed = false;
  for (const [id, until] of Object.entries(current())) {
    if (until > now) next[id] = until;
    else changed = true;
  }
  if (!changed) {
    rearm(now);
    return;
  }
  commit(next, now);
}

/** Hide `id` until `untilMs`. Returns the deadline actually stored. */
export function snoozeInboxItem(id: string, untilMs: number): number {
  const now = Date.now();
  commit({ ...current(), [id]: untilMs }, now);
  return untilMs;
}

/** Defer `id` for {@link DEFER_DURATION_MS} (or an explicit window). */
export function deferInboxItem(id: string, durationMs: number = DEFER_DURATION_MS): number {
  return snoozeInboxItem(id, Date.now() + durationMs);
}

/** Dismiss `id` indefinitely. */
export function dismissInboxItem(id: string): number {
  return snoozeInboxItem(id, DISMISS_UNTIL_MS);
}

/** Un-defer / un-dismiss `id`. */
export function restoreInboxItem(id: string): void {
  if (!(id in current())) return;
  const next = { ...current() };
  delete next[id];
  commit(next, Date.now());
}

export function isInboxItemSnoozed(id: string, now: number = Date.now()): boolean {
  const until = current()[id];
  return typeof until === 'number' && until > now;
}

/** The raw map, including entries that have already expired. Callers compare
 *  against their own `now` (see {@link isSnoozedIn}). */
export function getSnoozeSnapshot(): SnoozeMap {
  return current();
}

/** Pure predicate over a snapshot — lets a `useMemo` stay dependency-honest. */
export function isSnoozedIn(map: SnoozeMap, id: string, now: number): boolean {
  const until = map[id];
  return typeof until === 'number' && until > now;
}

export function subscribeInboxSnooze(listener: () => void): () => void {
  current();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hatch: forget everything, including the persisted blob. */
export function resetInboxSnoozes(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  state = EMPTY;
  writeStorage(EMPTY);
  emit();
}
