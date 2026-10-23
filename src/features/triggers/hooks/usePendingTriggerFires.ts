import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { listAllTriggers, listPendingTriggerFires } from '@/api/pipeline/triggers';
import type { PendingTriggerFire } from '@/lib/bindings/PendingTriggerFire';
import type { PersonaTrigger } from '@/lib/types/types';
import { silentCatch } from '@/lib/silentCatch';

/** How often the held-fire queue is re-read. A human approval is not latency
 *  sensitive; the point is that the count cannot go stale for long. */
const POLL_MS = 20_000;

interface Snapshot {
  pending: PendingTriggerFire[];
  triggers: Record<string, PersonaTrigger>;
  /** True until the first response lands. */
  loading: boolean;
}

/*
 * ONE source shared by every mounted reader. The Triggers page mounts the badge
 * (header) and the panel (body) together; when each called its own hook they
 * ran two 20 s pollers and held two copies of the queue, so resolving a fire in
 * the panel dropped it there while the badge kept counting it until its own
 * next poll. The snapshot, the poll and the roster fetch now live here, poll
 * refcounted by subscribers.
 */
let snapshot: Snapshot = { pending: [], triggers: {}, loading: true };
const listeners = new Set<() => void>();
let subscribers = 0;
let pollHandle: number | null = null;
/** Fires resolved locally whose removal an in-flight poll may not reflect yet. */
const forgotten = new Set<string>();
/** Trigger ids the roster was already fetched for, found or not, so a fire whose
 *  trigger the roster lacks cannot drive a refetch loop. */
const rosterAsked = new Set<string>();
let rosterInFlight = false;

function emit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}

function loadRosterIfNeeded() {
  if (rosterInFlight) return;
  const unknown = snapshot.pending.filter(
    (p) => !snapshot.triggers[p.trigger_id] && !rosterAsked.has(p.trigger_id),
  );
  if (unknown.length === 0) return;
  for (const p of unknown) rosterAsked.add(p.trigger_id);
  rosterInFlight = true;
  listAllTriggers()
    .then((all) => emit({ triggers: Object.fromEntries(all.map((tr) => [tr.id, tr])) }))
    .catch(silentCatch('usePendingTriggerFires.triggers'))
    .finally(() => { rosterInFlight = false; });
}

function refresh() {
  listPendingTriggerFires()
    .then((fires) => {
      const ids = new Set(fires.map((f) => f.id));
      for (const id of forgotten) if (!ids.has(id)) forgotten.delete(id);
      emit({ pending: fires.filter((f) => !forgotten.has(f.id)), loading: false });
      loadRosterIfNeeded();
    })
    .catch(silentCatch('usePendingTriggerFires.list'));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) {
    refresh();
    pollHandle = window.setInterval(refresh, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0 && pollHandle !== null) {
      window.clearInterval(pollHandle);
      pollHandle = null;
    }
  };
}

const getSnapshot = () => snapshot;

/** Drop a fire for every reader after it round-tripped, without waiting for the poll. */
function forgetFire(id: string) {
  forgotten.add(id);
  emit({ pending: snapshot.pending.filter((x) => x.id !== id) });
}

/** @internal test hatch: module state outlives a test's unmount. */
export function __resetPendingTriggerFiresForTests() {
  if (pollHandle !== null) window.clearInterval(pollHandle);
  pollHandle = null;
  subscribers = 0;
  listeners.clear();
  forgotten.clear();
  rosterAsked.clear();
  rosterInFlight = false;
  snapshot = { pending: [], triggers: {}, loading: true };
}

/**
 * The trigger fires currently HELD awaiting human approval (the `approval`
 * unattended-mode of the destructive-action gate, UAT P5).
 *
 * One source for both the panel that lists them and the badge that says they
 * exist, so the two can never disagree about the count. Pass `personaId` to
 * scope to a single agent's triggers (the per-persona Triggers sub-tab); omit
 * it for the workspace-wide view.
 *
 * `PendingTriggerFire` carries only `trigger_id`, so the firing trigger's type
 * is resolved against the trigger roster, fetched once and refreshed only when
 * a held fire names a trigger we have not asked about.
 */
export function usePendingTriggerFires(personaId?: string) {
  const snap = useSyncExternalStore(subscribe, getSnapshot);

  const scoped = useMemo(
    () => (personaId ? snap.pending.filter((p) => p.persona_id === personaId) : snap.pending),
    [snap.pending, personaId],
  );

  const triggerFor = useCallback(
    (fire: PendingTriggerFire): PersonaTrigger | undefined => snap.triggers[fire.trigger_id],
    [snap.triggers],
  );

  return {
    pending: scoped,
    count: scoped.length,
    loading: snap.loading,
    triggerFor,
    refresh,
    forget: forgetFire,
  };
}
