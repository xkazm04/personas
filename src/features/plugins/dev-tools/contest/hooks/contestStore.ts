// Module-scoped warm state for the Contest page (loading pattern v2, law 4).
//
// The page is a lazy route that fully unmounts on nav-away, so the last fetch
// lives here and a remount paints warm instead of re-ghosting. Every entry is
// a `{data, loading, error}` slot in a `createModuleCache`; hooks subscribe
// with `useModuleSubscription`. Fetches are latest-wins per slot; concurrent
// refreshes of one slot share the in-flight request and owe it one trailing
// re-fetch (see `load`).
//
// Errors are kept RAW (`unknown`) and resolved at render through
// `resolveErrorTranslated` — the commands may answer "not implemented" until
// the backend lands, and that must read as an error, never as "no contests".
import { createModuleCache, type ModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { createKeyedLatestWins } from '@/stores/util/latestWins';
import { getContest, getContestEnvironment, getContestLineups, listContests } from '@/api/contest';
import { silentCatch } from '@/lib/silentCatch';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestEnvironment } from '@/lib/bindings/ContestEnvironment';
import type { ContestLineup } from '@/lib/bindings/ContestLineup';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

export interface Slot<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
}

const EMPTY_SLOT: Slot<never> = { data: null, loading: false, error: null };

export function emptySlot<T>(): Slot<T> {
  return EMPTY_SLOT;
}

/** The one list of every contest (a single fixed key). */
export const contestListSlots = createModuleCache<'all', Slot<ContestSummary[]>>();

/** Contest details, keyed `${projectId}/${contestId}`. A session reviews a
 *  handful of contests; twelve warm is generous and still bounded. */
export const CONTEST_DETAIL_CACHE_MAX = 12;
export const contestDetailSlots = createModuleCache<string, Slot<ContestDetail>>({
  maxSize: CONTEST_DETAIL_CACHE_MAX,
});

/** Readiness per project. Projects are few; eight covers a workspace. */
export const CONTEST_ENV_CACHE_MAX = 8;
export const contestEnvSlots = createModuleCache<string, Slot<ContestEnvironment>>({
  maxSize: CONTEST_ENV_CACHE_MAX,
});

/** The saved line-ups (a single fixed key). */
export const contestLineupSlots = createModuleCache<'all', Slot<ContestLineup[]>>();

const listWins = createKeyedLatestWins<string>();
const inflight = new Map<string, Promise<void>>();
/** Keys asked for again while their fetch was running: they owe one more. */
const trailing = new Set<string>();
/** Flights started in the current task. Every subscriber of ONE event asks in
 *  the same task (the singleton listener fans out synchronously), and that
 *  read already sees the event — only a LATER ask owes a trailing re-read. */
const fresh = new Set<string>();

/** One fetch into one slot; keeps the previous data while loading (a refetch
 *  never blanks rendered rows — law 1) and drops stale responses. */
async function fetchOnce<K, T>(
  cache: ModuleCache<K, Slot<T>>,
  key: K,
  flightKey: string,
  fetcher: () => Promise<T>,
): Promise<void> {
  const token = listWins.next(flightKey);
  const prev = cache.get(key) ?? (EMPTY_SLOT as Slot<T>);
  cache.set(key, { ...prev, loading: true });
  cache.notify();
  try {
    const data = await fetcher();
    if (!listWins.isCurrent(flightKey, token)) return;
    cache.set(key, { data, loading: false, error: null });
  } catch (error: unknown) {
    // Reported even when the slot keeps older data: a backend that stops
    // answering must not leave a frozen page with no trace.
    silentCatch(`contest:load:${flightKey.split(':')[0]}`)(error);
    if (!listWins.isCurrent(flightKey, token)) return;
    const cur = cache.get(key) ?? (EMPTY_SLOT as Slot<T>);
    cache.set(key, { data: cur.data, loading: false, error });
  }
}

/** Coalesce, but keep the trailing edge: a refresh asked for while one is in
 *  flight marks the key and runs exactly ONE more fetch after it settles, so
 *  an event that landed mid-read is never answered with the read that began
 *  before it. Every caller's promise settles after the last fetch. */
function load<K, T>(
  cache: ModuleCache<K, Slot<T>>,
  key: K,
  flightKey: string,
  fetcher: () => Promise<T>,
): Promise<void> {
  const running = inflight.get(flightKey);
  if (running) {
    if (!fresh.has(flightKey)) trailing.add(flightKey);
    return running;
  }
  fresh.add(flightKey);
  queueMicrotask(() => fresh.delete(flightKey));
  const p = (async () => {
    do {
      trailing.delete(flightKey);
      await fetchOnce(cache, key, flightKey, fetcher);
    } while (trailing.has(flightKey));
  })().finally(() => {
    inflight.delete(flightKey);
    cache.notify();
  });
  inflight.set(flightKey, p);
  return p;
}

export function detailKey(projectId: string, contestId: string): string {
  return `${projectId}/${contestId}`;
}

export function refreshContests(): Promise<void> {
  return load(contestListSlots, 'all', 'list', listContests);
}

export function refreshContest(projectId: string, contestId: string): Promise<void> {
  const key = detailKey(projectId, contestId);
  return load(contestDetailSlots, key, `detail:${key}`, () => getContest(projectId, contestId));
}

export function refreshEnvironment(projectId: string): Promise<void> {
  return load(contestEnvSlots, projectId, `env:${projectId}`, () => getContestEnvironment(projectId));
}

export function refreshLineups(): Promise<void> {
  return load(contestLineupSlots, 'all', 'lineups', getContestLineups);
}

/** Replace the line-ups slot after a successful save (no refetch needed). */
export function primeLineups(lineups: ContestLineup[]): void {
  contestLineupSlots.set('all', { data: lineups, loading: false, error: null });
  contestLineupSlots.notify();
}

/** Put a freshly created/decided summary at the top of the list at once;
 *  the event-driven refetch then reconciles it. */
export function primeSummary(summary: ContestSummary): void {
  const cur = contestListSlots.get('all');
  const rest = (cur?.data ?? []).filter(
    (s) => !(s.projectId === summary.projectId && s.contestId === summary.contestId),
  );
  contestListSlots.set('all', { data: [summary, ...rest], loading: cur?.loading ?? false, error: cur?.error ?? null });
  contestListSlots.notify();
}

/** Replace one list row with a fresh summary, in the backend's order (newest
 *  `updatedAtMs` first, then id). No-op when the list does not hold it. */
export function patchSummary(summary: ContestSummary): void {
  const cur = contestListSlots.get('all');
  if (!cur?.data) return;
  const same = (s: ContestSummary) => s.projectId === summary.projectId && s.contestId === summary.contestId;
  if (!cur.data.some(same)) return;
  const rows = cur.data.map((s) => (same(s) ? summary : s));
  rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.contestId.localeCompare(b.contestId));
  contestListSlots.set('all', { ...cur, data: rows });
  contestListSlots.notify();
}

/**
 * React to a `contest-changed` for one contest. The event names the contest,
 * and its fresh detail carries the list row, so the list is patched from it —
 * one `contest_get` instead of a walk of every arena on disk. Only a contest
 * the list has never seen (a create from the CLI) or a failed detail read
 * falls back to a full re-list.
 */
export async function refreshForChange(projectId: string, contestId: string): Promise<void> {
  const listed = contestListSlots
    .get('all')
    ?.data?.some((s) => s.projectId === projectId && s.contestId === contestId);
  if (!listed) return refreshContests();
  await refreshContest(projectId, contestId);
  const slot = contestDetailSlots.get(detailKey(projectId, contestId));
  if (!slot?.data || slot.error) return refreshContests();
  patchSummary(slot.data.summary);
}

/** Test hatch: forget every slot. */
export function __resetContestStoreForTests(): void {
  contestListSlots.clear();
  contestDetailSlots.clear();
  contestEnvSlots.clear();
  contestLineupSlots.clear();
  inflight.clear();
  trailing.clear();
  fresh.clear();
}
