import { useEffect, useSyncExternalStore } from 'react';
import { listTeamMembers } from '@/api/pipeline/teams';
import { useAgentStore } from '@/stores/agentStore';
import { silentCatch } from '@/lib/silentCatch';

/* ----------------------------------------------------------------------------
 * Shared team-roster cache for the Projects table.
 *
 * The Manage table shows one member stack per project, and a project row does
 * NOT own its roster — the team does. The naive shape (each row fetching on
 * mount) is an IPC storm: N rows = N `list_team_members` calls on every mount,
 * repeated on every remount of a lazy route that fully unmounts on nav-away.
 *
 * So: ONE module-scoped cache keyed by teamId, filled by a single batched
 * `Promise.all` pass over the ids the page is actually showing, deduped against
 * both the cache and the in-flight set. A remount, a workspace-tab switch, or a
 * re-render never refetches a team that is already known — the entries are kept
 * on purpose (the set is bounded by the teams the user's projects are bound to,
 * which is small, and the roster is the slowest-moving data on the page).
 *
 * The COUNT does not come from here at all: `pipelineStore.teamCounts` is
 * already populated by the same `fetchTeams()` the page runs on mount (one
 * `get_team_counts` IPC for every team), so the number paints on the first
 * frame and only the persona icons stream in. No ghost, no spinner — a surface
 * that already has its headline number is not loading (docs/design/overview-loading.md).
 * -------------------------------------------------------------------------- */

/** teamId → the persona ids on that team, in membership order. */
const rosterCache = new Map<string, string[]>();
const inflight = new Set<string>();
const subscribers = new Set<() => void>();

/**
 * Monotonic snapshot token. `useSyncExternalStore` compares snapshots with
 * `Object.is`, so the mutated-in-place Map can never be the snapshot — it would
 * always compare equal and nothing would re-render.
 */
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

/** One-shot guard: personas are not fetched app-wide, and this page needs the
 *  icon/color of each member. Fetch once per process, never per row. */
let personasRequested = false;

/**
 * Rosters for the teams the given projects are bound to.
 *
 * @param teamIds the DISTINCT, already-scoped team ids on screen. Pass a stable
 *   array (memoise it at the call site) — the batch pass keys off its contents.
 * @returns the live cache. Read it during render; a miss simply means the icons
 *   have not arrived yet, which is a legitimate paint (the count is already up).
 */
export function useProjectTeamRosters(teamIds: readonly string[]): ReadonlyMap<string, readonly string[]> {
  useSyncExternalStore(subscribe, getVersion, getVersion);

  // A primitive key so the effect fires on a genuine change of the id SET, not
  // on every new array identity the parent's render produces.
  const key = teamIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const missing = ids.filter((id) => !rosterCache.has(id) && !inflight.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => inflight.add(id));
    void Promise.all(
      missing.map((id) =>
        listTeamMembers(id)
          .then((members) => {
            rosterCache.set(id, members.map((m) => m.persona_id));
          })
          .catch(silentCatch('devTools/sub_projects:useProjectTeamRosters'))
          .finally(() => inflight.delete(id)),
      ),
    ).then(notify);
  }, [key]);

  // Personas hydrate the stack's icons. Nothing else on this route fetches
  // them, so a cold open would otherwise render count-only forever.
  const personaCount = useAgentStore((s) => s.personas.length);
  useEffect(() => {
    if (personasRequested || personaCount > 0) return;
    personasRequested = true;
    void useAgentStore.getState().fetchPersonas().catch(silentCatch('devTools/sub_projects:personas'));
  }, [personaCount]);

  return rosterCache;
}

/** Test seam — drops every cached roster and the one-shot persona guard. */
export function __resetProjectTeamRosters(): void {
  rosterCache.clear();
  inflight.clear();
  personasRequested = false;
  notify();
}
