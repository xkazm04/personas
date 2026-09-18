import { createTtlValueCache, type TtlValueCache } from '@/lib/async/createTtlValueCache';
import { useEffect, useSyncExternalStore } from 'react';
import { listIdeas } from '@/api/devTools/devTools';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';

/* ----------------------------------------------------------------------------
 * Portfolio pulse for the Projects wall.
 *
 * The Manage table used to answer "what projects exist"; it could not answer
 * "which one needs me". Two columns close that: ATTENTION (findings still
 * pending — the sweep's own open count, kpi_offtrack included) and PULSE (how
 * long since anything was raised for this project at all).
 *
 * The honesty rule that shapes the whole file (`nullable-never-zero`): a
 * project nobody ever scanned must NOT render `0` next to a project that was
 * swept this morning and came back clean. Those are opposite facts. So the
 * measurement is `null` until we have seen at least one idea row for the
 * project, and the cells paint an em dash / "unwatched" for null.
 *
 * Shape follows `useProjectTeamRosters` in this folder: ONE module-scoped TTL
 * cache keyed by projectId, one batched pass over the ids actually on screen,
 * deduped against the cache and the in-flight set — never a fetch per row on
 * every remount of a lazy route.
 * -------------------------------------------------------------------------- */

/** One `dev_tools_list_ideas` page per project. Fresh-first (`created_at DESC`
 *  in the repo), so row 0 IS the pulse and the page is also the attention
 *  sample. 200 keeps a busy backlog from truncating the pending count in
 *  practice while staying one bounded query. */
const PAGE = 200;

/** Pulse TTL — a sweep run from the Triage tab must show up on the wall within
 *  a session without a reload, and the numbers move at sweep cadence, not at
 *  render cadence. */
const PULSE_TTL_MS = 2 * 60_000;

/** In-flight measurements at once. Chosen, not inherited from the row count. */
const FETCH_WIDTH = 6;

export interface ProjectPulse {
  /**
   * Findings still `pending`, or `null` when the project has never had a single
   * idea raised — unmeasured, not clean. Never collapse the two.
   */
  attention: number | null;
  /** `created_at` of the most recent idea, or `null` when nothing was ever raised. */
  lastSignalAt: string | null;
  /** True when the page came back full, so `attention` is a floor, not a total. */
  truncated: boolean;
}

const pulseCache = createTtlValueCache<ProjectPulse>(PULSE_TTL_MS);
const inflight = new Set<string>();
const subscribers = new Set<() => void>();

/** Monotonic snapshot token — a mutated-in-place cache can never be the
 *  `useSyncExternalStore` snapshot (`Object.is` would always say "equal"). */
let version = 0;

function notify(): void {
  version += 1;
  subscribers.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

const getVersion = () => version;

/** Fold one project's idea page into the two numbers the wall shows. Exported
 *  for the gate: this is where the never-scanned-is-not-zero rule lives. */
export function foldPulse(ideas: { status: string; created_at: string }[]): ProjectPulse {
  if (ideas.length === 0) {
    return { attention: null, lastSignalAt: null, truncated: false };
  }
  let attention = 0;
  let newest = ideas[0]!.created_at;
  for (const idea of ideas) {
    if (idea.status === 'pending') attention += 1;
    if (idea.created_at > newest) newest = idea.created_at;
  }
  return { attention, lastSignalAt: newest, truncated: ideas.length >= PAGE };
}

/**
 * Attention + pulse for the projects currently on screen.
 *
 * @param projectIds the DISTINCT, already workspace-scoped ids being rendered.
 *   Pass a memoised array — the batch pass keys off its contents.
 * @returns the live cache. A miss means the measurement has not landed yet,
 *   which paints exactly like "never measured" on purpose: both are "we do not
 *   know", and inventing a zero for either is the defect this hook exists for.
 */
export function useProjectPulse(projectIds: readonly string[]): TtlValueCache<ProjectPulse> {
  useSyncExternalStore(subscribe, getVersion, getVersion);

  const key = projectIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const missing = ids.filter((id) => pulseCache.get(id) === undefined && !inflight.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => inflight.add(id));
    // Bounded fan-out (bounded-parallel-fan-out): a fleet operator can have
    // dozens of projects on the wall, and the width of this pass must be a
    // number somebody chose, not "however many rows the workspace happens to
    // hold". Each item catches its own failure, so one dead project does not
    // discard the rest of the pass.
    void mapWithConcurrency(missing, FETCH_WIDTH, (id) =>
      listIdeas(id, undefined, undefined, undefined, PAGE)
        .then((ideas) => {
          pulseCache.set(id, foldPulse(ideas));
        })
        .catch(silentCatch('devTools/sub_projects:useProjectPulse'))
        .finally(() => inflight.delete(id)),
    ).then(notify);
  }, [key]);

  return pulseCache;
}

/** Test seam — drops every cached measurement. */
export function __resetProjectPulse(): void {
  pulseCache.clear();
  inflight.clear();
  notify();
}
