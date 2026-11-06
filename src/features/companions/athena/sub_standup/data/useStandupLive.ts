import { useCallback, useEffect, useMemo, useState } from 'react';

import { listProjects } from '@/api/devTools/devTools';
import {
  hostUtilizationSeries, standupArm, standupCurrent, standupDiscuss, standupEnd, standupEvents, standupForecast,
  standupOpen, standupPropose, standupSetAwayRules, standupUpdateItem,
} from '@/api/companion/standup';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { Standup } from '@/lib/bindings/Standup';
import type { StandupEvent } from '@/lib/bindings/StandupEvent';
import type { StandupItemPatch } from '@/lib/bindings/StandupItemPatch';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';
import { DAY_MS, HOUR_MS, MIN_MS } from '../model/timeAxis';
import { errorText } from './errorText';
import type { BusyAction, StandupSource } from './types';
import { useRegion } from './useRegion';

const EVENTS_LIMIT = 400;
/** The proposal job's own IPC budget; past it the ghosts give way to whatever arrived. */
const PROPOSING_MAX_MS = 180_000;
const EMPTY: never[] = [];
/** A list answer that came back absent reads as empty, never as a crash. */
const list = <T,>(p: Promise<T[] | null | undefined>): Promise<T[]> => p.then((x) => x ?? []);

/** WP1's arm writes a refusal as a `stop` event: `detail { itemId, reason: "headless_master", note }`. */
const REFUSAL_HEADLESS_MASTER = 'headless_master';

/** itemId -> why the plan refused it, read from the event ledger (the newest event wins). */
export function refusalsFrom(events: readonly StandupEvent[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events) {
    const id = e.detail?.itemId;
    if (e.kind !== 'stop' || e.detail?.reason !== REFUSAL_HEADLESS_MASTER || typeof id !== 'string' || id in out) continue;
    out[id] = typeof e.detail?.note === 'string' ? e.detail.note : e.summary;
  }
  return out;
}

/** The live page: every call through `src/api/companion/standup.ts`, every region on its own. */
export function useStandupLive(enabled: boolean, longHistory: boolean): StandupSource {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState<Partial<Record<BusyAction, boolean>>>({});
  const [actionError, setActionError] = useState<string>();
  const [proposingSince, setProposingSince] = useState<number | null>(null);
  const [override, setOverride] = useState<Standup | null | undefined>(undefined);

  const current = useRegion<Standup | null>('standupCurrent', enabled ? 'on' : 'off', null, () => (enabled ? standupCurrent() : null));
  // An action's returned Standup shows at once; the next snapshot read replaces it (render-time
  // reset), so a refresh never flashes the older data back in between (loading law 1).
  const [seenSnapshot, setSeenSnapshot] = useState(current.data);
  if (seenSnapshot !== current.data) {
    setSeenSnapshot(current.data);
    setOverride(undefined);
  }
  const standup = override !== undefined ? override : current.data;
  const id = standup?.id ?? '';
  const events = useRegion<StandupEvent[]>('standupEvents', `${id}`, EMPTY, () => (id ? list(standupEvents(id, EVENTS_LIMIT)) : null));
  const forecast = useRegion('standupForecast', `${id}:${standup?.status}`, EMPTY, () => (id ? list(standupForecast(id)) : null));
  // The machine row re-reads every few minutes; the 12-day history only while Z shows it.
  const bucket = Math.floor(nowMs / (5 * MIN_MS));
  const since = nowMs - (longHistory ? 12 * DAY_MS : 13 * HOUR_MS);
  const utilization = useRegion('hostUtilizationSeries', enabled ? `${longHistory}:${bucket}` : 'off', EMPTY, () => (enabled ? list(hostUtilizationSeries(since, nowMs)) : null));
  const projects = useRegion('listProjects', enabled ? 'on' : 'off', EMPTY, () => (enabled ? list(listProjects()) : null));
  const personas = useAgentStore((s) => s.personas);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNowMs(Date.now()), MIN_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  const { reload: reloadCurrent } = current;
  const { reload: reloadEvents } = events;
  const { reload: reloadForecast } = forecast;
  const refresh = useCallback(() => {
    reloadCurrent();
    reloadEvents();
    reloadForecast();
  }, [reloadCurrent, reloadEvents, reloadForecast]);

  // Snapshot plus stream: every `standup://updated` re-reads the snapshot, and the snapshot is
  // read once more the moment the listener is attached, so an update that landed while
  // listen() was still resolving is never lost (the event carries only the id).
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    typedListen(EventName.STANDUP_UPDATED, () => { if (alive) refresh(); })
      .then((u) => {
        if (!alive) { u(); return; }
        unlisten = u;
        refresh();
      })
      .catch(silentCatch('StandupPanel.standup_updated'));
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [enabled, refresh]);

  /** Run one call; a returned Standup replaces the shown one at once (the event re-reads it anyway). */
  const run = useCallback(async (action: BusyAction | null, context: string, call: () => Promise<Standup | null | void>) => {
    if (action) setBusy((b) => ({ ...b, [action]: true }));
    setActionError(undefined);
    try {
      const next = await call();
      if (next !== undefined) setOverride(next);
    } catch (err) {
      setActionError(errorText(context, err));
    } finally {
      if (action) setBusy((b) => ({ ...b, [action]: false }));
    }
  }, []);

  const actions = useMemo<StandupSource['actions']>(() => ({
    open: () => run('open', 'standupOpen', standupOpen),
    propose: () => run('propose', 'standupPropose', async () => {
      if (!id) return;
      setProposingSince(Date.now());
      return standupPropose(id);
    }),
    patch: (patch: StandupItemPatch) => run(null, 'standupUpdateItem', async () => (id ? standupUpdateItem(id, patch) : undefined)),
    setRules: (rules: AwayRules) => run(null, 'standupSetAwayRules', async () => (id ? standupSetAwayRules(id, rules) : undefined)),
    arm: () => run('arm', 'standupArm', async () => (id ? standupArm(id) : undefined)),
    end: () => run('end', 'standupEnd', async () => (id ? standupEnd(id) : undefined)),
    discuss: async (itemId: string) => {
      setActionError(undefined);
      try {
        return await standupDiscuss(id, itemId);
      } catch (err) {
        setActionError(errorText('standupDiscuss', err));
        return null;
      }
    },
    clearError: () => setActionError(undefined),
  }), [id, run]);

  const proposing = proposingSince !== null && nowMs - proposingSince < PROPOSING_MAX_MS
    && Boolean(standup?.plan.items.some((i) => i.kind === 'direction' && i.proposals.length === 0 && !i.evidence));

  const projectNames = useMemo(() => Object.fromEntries(projects.data.map((p) => [p.id, p.name])), [projects.data]);
  const personaNames = useMemo(() => Object.fromEntries(personas.map((p) => [p.id, p.name])), [personas]);
  const refusals = useMemo(() => refusalsFrom(events.data), [events.data]);
  const input = useMemo(() => ({
    standup, events: events.data, forecast: forecast.data, utilization: utilization.data,
    projectNames, personaNames, history: EMPTY_HISTORY, refusals, nowMs,
  }), [standup, events.data, forecast.data, utilization.data, projectNames, personaNames, refusals, nowMs]);

  return {
    kind: 'live',
    input,
    utilizationLong: utilization.data,
    loading: { standup: current.loading, events: events.loading, machine: utilization.loading || forecast.loading },
    errors: { standup: current.error, events: events.error, machine: utilization.error ?? forecast.error, action: actionError },
    busy,
    proposing,
    actions,
  };
}

/** Per-project standup history is not on the wire yet (StandupSummary carries no items): drawn as "not recorded". */
const EMPTY_HISTORY: Record<string, never> = {};
