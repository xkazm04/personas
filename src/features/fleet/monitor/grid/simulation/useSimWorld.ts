// useSimWorld — the simulated fleet, built once and held for the session.
//
// The roster, the cards and the sessions are pure functions of their seeds, so
// they are built ONCE into a module singleton rather than per mount. Two
// reasons, and the second is the one that decided it:
//
//   • Cost. Sixty cards, twenty-two sessions and a hundred-odd rail rows is
//     not free, and the Monitor is an overlay that mounts on every open.
//   • IDENTITY. `PersonaTile` is memoized on its card and `ColumnBody` keys
//     rows by id; rebuilding the world on each mount would hand every tile a
//     new object with the same contents, and the board would re-render whole
//     while looking identical. A fixture that makes the surface behave worse
//     than the real one measures the wrong thing.
//
// The PLANS are the exception. They are anchored to the wall clock (their
// meters count down towards a reset), and they are the one part of the world
// the operator can change from the UI — switching the live plan, forgetting a
// dead one. So they live in React state, seeded once per mount.

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import type { FleetQueueSnapshot } from '@/lib/bindings/FleetQueueSnapshot';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { ClaudeAutoRotateConfig } from '@/lib/bindings/ClaudeAutoRotateConfig';
import { groupSessions, type SessionGrouping } from '../fleetSessionModel';
import type { PersonaHourlyRuns } from '@/lib/bindings/PersonaHourlyRuns';
import { buildSimCards } from './simCards';
import { buildSimRoster, type SimRoster } from './simFleet';
import { simHourlyRuns } from './simHourly';
import { SIM_LOAD_AGENTS_PER_PROJECT } from './simRandom';
import { buildSimQueueSnapshot, buildSimSessions } from './simSessions';
import {
  buildSimAccountsSnapshot, simRelogin, simRemoveAccount, simSaveProfile, simSetProfile, simSwitchActive,
} from './simPlans';
import type { PersonaCardModel } from '../../monitorModel';

export interface SimWorld {
  roster: SimRoster;
  cards: PersonaCardModel[];
  /** Already routed cwd → project → team, by the board's own grouper. */
  sessions: SessionGrouping;
  /** The flat registry — what the queue model joins against. */
  sessionList: FleetSession[];
  /** The door's snapshot for that registry, at the simulated cap. */
  queue: FleetQueueSnapshot;
}

let world: SimWorld | null = null;

// The QUEUE half of the world is the one part a board can CHANGE (reorder,
// cancel, start now), so it is versioned: every simulated verb rebuilds the
// list and the snapshot from the current rows and bumps a tick that
// `useSimQueue` subscribes to. The roster and the cards never move.
let queueTick = 0;
const queueListeners = new Set<() => void>();
function bumpQueue(next: FleetSession[]): void {
  if (!world) return;
  world = {
    ...world,
    sessionList: next,
    sessions: groupSessions(next, world.roster.projects),
    queue: buildSimQueueSnapshot(next),
  };
  queueTick += 1;
  for (const l of queueListeners) l();
}
const subscribeQueue = (l: () => void) => { queueListeners.add(l); return () => { queueListeners.delete(l); }; };
const readQueueTick = () => queueTick;

/** Re-render on every simulated queue verb; returns the current world. */
export function useSimQueue(): SimWorld {
  useSyncExternalStore(subscribeQueue, readQueueTick, readQueueTick);
  return simWorld();
}

const byRank = (a: FleetSession, b: FleetSession) => (a.queueRank ?? 0) - (b.queueRank ?? 0);

/** The simulated verbs — local, synchronous, and honest about rank. */
export const simQueueActions = {
  reorder(ids: string[]): void {
    const w = simWorld();
    const rank = new Map(ids.map((id, i) => [id, i + 1]));
    const unlisted = w.sessionList.filter((x) => x.state === 'queued' && !rank.has(x.id)).sort(byRank);
    unlisted.forEach((x, i) => rank.set(x.id, ids.length + i + 1));
    bumpQueue(w.sessionList.map((x) => (x.state === 'queued' ? { ...x, queueRank: rank.get(x.id) ?? x.queueRank } : x)));
  },
  cancel(id: string): void {
    const w = simWorld();
    let r = 0;
    bumpQueue([...w.sessionList].filter((x) => x.id !== id).sort(byRank)
      .map((x) => (x.state === 'queued' ? { ...x, queueRank: ++r } : x)));
  },
  startNow(id: string): void {
    const w = simWorld();
    let r = 0;
    bumpQueue([...w.sessionList].sort(byRank).map((x) => {
      if (x.id === id) {
        return { ...x, state: 'running' as const, queueRank: null, createdAtMs: BigInt(Date.now()), childPid: 4242 };
      }
      return x.state === 'queued' ? { ...x, queueRank: ++r } : x;
    }));
  },
};

/** The fleet half of the world — deterministic, so it is built at most once. */
export function simWorld(): SimWorld {
  if (world) return world;
  const roster = buildSimRoster();
  const sessionList = buildSimSessions(roster);
  world = {
    roster,
    cards: buildSimCards(roster),
    sessions: groupSessions(sessionList, roster.projects),
    sessionList,
    queue: buildSimQueueSnapshot(sessionList),
  };
  return world;
}

/** A roster at one size, its cards, and their runs-per-hour. */
export interface SimFleet {
  roster: SimRoster;
  cards: PersonaCardModel[];
  /** The 24h sparkline rows, in `getPersonaRunsHourly`'s shape. */
  hourly: PersonaHourlyRuns[];
}

let loadFleet: SimFleet | null = null;

/**
 * The 100-agent fleet (20 projects x `SIM_LOAD_AGENTS_PER_PROJECT`), built at
 * most once for the same identity reason as {@link simWorld}. The Activity
 * board keeps its 60-agent world; the full-frame Board is judged at this one.
 * `hourly` is anchored to the first call's clock — a consumer that stays open
 * across an hour boundary can rebuild it with `simHourlyRuns(cards, now)`.
 */
export function simLoadFleet(): SimFleet {
  if (loadFleet) return loadFleet;
  const roster = buildSimRoster(SIM_LOAD_AGENTS_PER_PROJECT);
  const cards = buildSimCards(roster);
  loadFleet = { roster, cards, hourly: simHourlyRuns(cards) };
  return loadFleet;
}

export interface SimPlans {
  /** Null while the simulation is off — the strip reads its real accounts then. */
  snapshot: ClaudeAccountsSnapshot | null;
  switchTo: (id: string) => void;
  remove: (id: string) => void;
  setAutoRotate: (config: ClaudeAutoRotateConfig) => void;
  /** The re-login half: a run answered in the same call, links and profiles edited in place. */
  relogin: (id: string) => void;
  setProfile: (id: string, profileKey: string | null, inbox: string | null, unattended: boolean) => void;
  saveProfile: (key: string, label: string, vaultCredentialId: string | null) => void;
}

/**
 * The plan half — stateful, because the strip's three acts change it. Every act
 * stays wired while simulating: the confirm dialogs, the switch, the forget and
 * the auto-rotate threshold all run their real components and land in this
 * state instead of in the backend, so the flows can be walked end to end.
 */
export function useSimPlans(enabled: boolean): SimPlans {
  // The seed is built only once the strip is actually simulating: a production
  // Monitor mounts this hook too, and it should not pay for five fixture plans
  // it will never render. Edits ride ON TOP of the seed, so switching the
  // simulation off and on again returns to the plans as the operator left them.
  const seed = useMemo(() => (enabled ? buildSimAccountsSnapshot() : null), [enabled]);
  const [edited, setEdited] = useState<ClaudeAccountsSnapshot | null>(null);
  const snapshot = enabled ? (edited ?? seed) : null;

  // `edit` must see the snapshot of the render it fires in, not the one it
  // closed over at mount; a ref is the smallest thing that guarantees that.
  const latest = useRef<ClaudeAccountsSnapshot | null>(null);
  latest.current = snapshot;

  const edit = useCallback(
    (fn: (s: ClaudeAccountsSnapshot) => ClaudeAccountsSnapshot) =>
      setEdited((prev) => {
        const base = prev ?? latest.current;
        return base ? fn(base) : prev;
      }),
    [],
  );

  const switchTo = useCallback((id: string) => edit((s) => simSwitchActive(s, id)), [edit]);
  const remove = useCallback((id: string) => edit((s) => simRemoveAccount(s, id)), [edit]);
  const setAutoRotate = useCallback(
    (config: ClaudeAutoRotateConfig) => edit((s) => ({ ...s, autoRotate: config })),
    [edit],
  );

  const relogin = useCallback((id: string) => edit((s) => simRelogin(s, id)), [edit]);
  const setProfile = useCallback(
    (id: string, profileKey: string | null, inbox: string | null, unattended: boolean) =>
      edit((s) => simSetProfile(s, id, profileKey, inbox, unattended)),
    [edit],
  );
  const saveProfile = useCallback(
    (key: string, label: string, vaultCredentialId: string | null) => edit((s) => simSaveProfile(s, key, label, vaultCredentialId)),
    [edit],
  );

  return useMemo(
    () => ({ snapshot, switchTo, remove, setAutoRotate, relogin, setProfile, saveProfile }),
    [snapshot, switchTo, remove, setAutoRotate, relogin, setProfile, saveProfile],
  );
}

/** Test hatch — the fleet half is a module singleton. */
export function _resetSimWorldForTests(): void {
  world = null;
  loadFleet = null;
  queueTick = 0;
}
