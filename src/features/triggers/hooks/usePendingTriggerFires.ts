import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listAllTriggers, listPendingTriggerFires } from '@/api/pipeline/triggers';
import type { PendingTriggerFire } from '@/lib/bindings/PendingTriggerFire';
import type { PersonaTrigger } from '@/lib/types/types';
import { silentCatch } from '@/lib/silentCatch';

/** How often the held-fire queue is re-read. A human approval is not latency
 *  sensitive; the point is that the count cannot go stale for long. */
const POLL_MS = 20_000;

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
 * a held fire names a trigger we have not seen.
 */
export function usePendingTriggerFires(personaId?: string) {
  const [pending, setPending] = useState<PendingTriggerFire[]>([]);
  const [triggers, setTriggers] = useState<Record<string, PersonaTrigger>>({});
  // True until the first response lands, so callers can avoid claiming "none
  // held" before they have actually heard back.
  const [loading, setLoading] = useState(true);
  const triggersLoaded = useRef(false);

  const refresh = useCallback(() => {
    listPendingTriggerFires()
      .then((fires) => {
        setPending(fires);
        setLoading(false);
      })
      .catch(silentCatch('usePendingTriggerFires.list'));
  }, []);

  useEffect(() => {
    refresh();
    const handle = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(handle);
  }, [refresh]);

  // Resolve trigger metadata lazily: once on the first held fire, then again
  // only if one names a trigger the roster does not have.
  useEffect(() => {
    if (pending.length === 0) return;
    const unknown = pending.some((p) => !triggers[p.trigger_id]);
    if (!unknown && triggersLoaded.current) return;

    let stale = false;
    listAllTriggers()
      .then((all) => {
        if (stale) return;
        triggersLoaded.current = true;
        setTriggers(Object.fromEntries(all.map((tr) => [tr.id, tr])));
      })
      .catch(silentCatch('usePendingTriggerFires.triggers'));
    return () => {
      stale = true;
    };
  }, [pending, triggers]);

  const scoped = useMemo(
    () => (personaId ? pending.filter((p) => p.persona_id === personaId) : pending),
    [pending, personaId],
  );

  /** Drop a fire locally after it round-tripped, without waiting for the poll. */
  const forget = useCallback((id: string) => {
    setPending((cur) => cur.filter((x) => x.id !== id));
  }, []);

  return {
    pending: scoped,
    count: scoped.length,
    loading,
    triggerFor: (fire: PendingTriggerFire): PersonaTrigger | undefined =>
      triggers[fire.trigger_id],
    refresh,
    forget,
  };
}
