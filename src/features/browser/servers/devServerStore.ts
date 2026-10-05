// Server control store — the ONE copy of the dev-server list for the whole app.
//
// Same shape as `browserStore.ts`: a module singleton that mutates in memory,
// notifies subscribers and hands views the same container until something
// writes. Two surfaces read it — Browser > Server control and every Fleet
// Monitor bay — so a module store keeps one subscription and one fetch no
// matter how many bays are mounted, and a remount paints warm.
//
// Rust owns every state transition (the supervisor derives `state` each tick
// and announces the whole list on `dev-servers-changed`), so there is no
// optimistic write here: an action calls the command and the event repaints.
import { useSyncExternalStore } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';

import * as api from '@/api/devServers';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import { extractMessage, silentCatch, toastCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';

export interface DevServerSnapshot {
  servers: readonly DevServerView[];
  loading: boolean;
  loaded: boolean;
  /** Set when the last list failed. A failed first load must not look like "no servers". */
  error: string | null;
  byProject: ReadonlyMap<string, DevServerView>;
}

const EMPTY: DevServerSnapshot = {
  servers: [],
  loading: false,
  loaded: false,
  error: null,
  byProject: new Map(),
};

let state: DevServerSnapshot = EMPTY;
let unlisten: Promise<UnlistenFn> | null = null;
const wins = createLatestWins();
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeDevServers(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The snapshot getter `useSyncExternalStore` compares by identity. */
export function devServersSnapshot(): DevServerSnapshot {
  return state;
}

function commit(next: DevServerSnapshot): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Pure: adopt a full list from Rust. Exported for tests. */
export function adoptServers(prev: DevServerSnapshot, servers: readonly DevServerView[]): DevServerSnapshot {
  return {
    ...prev,
    servers,
    loading: false,
    loaded: true,
    error: null,
    byProject: new Map(servers.map((s) => [s.projectId, s])),
  };
}

export async function refreshDevServers(): Promise<void> {
  const token = wins.next();
  commit({ ...state, loading: true });
  try {
    const servers = await api.listDevServers();
    if (!wins.isCurrent(token)) return;
    commit(adoptServers(state, servers));
  } catch (err) {
    if (!wins.isCurrent(token)) return;
    silentCatch('dev servers refresh')(err);
    commit({ ...state, loading: false, error: extractMessage(err) });
  }
}

/** Idempotent: subscribe once, then fetch. Every mount may call it. */
export async function ensureDevServers(): Promise<void> {
  if (!unlisten) {
    const pending = api.listenDevServers((servers) => {
      wins.next();
      commit(adoptServers(state, servers));
    });
    unlisten = pending;
    // A rejected subscribe must not latch, or the next mount never retries.
    pending.catch((err: unknown) => {
      silentCatch('dev servers listen')(err);
      if (unlisten === pending) unlisten = null;
    });
  }
  if (!state.loaded && !state.loading) await refreshDevServers();
}

export function useDevServers(): DevServerSnapshot {
  return useSyncExternalStore(subscribeDevServers, devServersSnapshot);
}

/** Start / stop / restart with the error surfaced as a toast. The event repaints. */
export async function serverAction(kind: 'start' | 'stop' | 'restart', projectId: string): Promise<void> {
  const call = kind === 'start' ? api.startDevServer : kind === 'stop' ? api.stopDevServer : api.restartDevServer;
  try {
    await call(projectId);
  } catch (err) {
    toastCatch(`dev server ${kind}`)(err);
  }
}
