/**
 * useMandates — every live mandate (`mandate_list`), kept fresh by the act
 * stream: each `charter-act-recorded` (an envelope change, a steward or an
 * operator act, a revert) re-reads the list once.
 *
 * Loading pattern v2: `mandates` is null until the first read lands (the
 * plate draws its ghost), a failed read is `failed` and keeps whatever was
 * there, and a refetch never hides rendered rows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { listMandates } from '@/api/mandates';
import { getAutopilotMode, type AutopilotMode } from '@/api/devTools/autopilot';
import { useCharterActRecorded } from '@/features/decision-center/lanes/useLanesSnapshot';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { silentCatch } from '@/lib/silentCatch';
import { mapWithConcurrency } from '@/lib/concurrency';

/** Mode reads in flight at once: one per charter would scale with the fleet. */
const MODE_READS = 4;

export interface MandatesState {
  mandates: MandateSummary[] | null;
  failed: boolean;
  refresh: () => void;
}

export function useMandates(enabled = true): MandatesState {
  const [mandates, setMandates] = useState<MandateSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  // StrictMode runs mount, cleanup, mount: the second mount must re-arm it.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(() => {
    listMandates()
      .then((rows) => {
        if (!alive.current) return;
        setMandates(rows);
        setFailed(false);
      })
      .catch((err: unknown) => {
        silentCatch('fleet/mandates:list')(err);
        if (alive.current) setFailed(true);
      });
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);
  const onAct = useCallback(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);
  useCharterActRecorded(onAct);

  return { mandates, failed, refresh };
}

/**
 * Each project's `autopilot_mode`, read once per project id set. A mode that
 * failed to read is absent from the map (shown as unknown, never as `off`);
 * `null` means unset, which the cockpit renders as `off`.
 */
export function useAutopilotModes(projectIds: readonly string[]): ReadonlyMap<string, AutopilotMode | null> {
  const key = [...projectIds].sort().join(',');
  const [modes, setModes] = useState<ReadonlyMap<string, AutopilotMode | null>>(new Map());
  useEffect(() => {
    if (!key) return;
    let live = true;
    const ids = key.split(',');
    const FAILED = Symbol('failed');
    void mapWithConcurrency(ids, MODE_READS, (id) =>
      getAutopilotMode(id).catch((err: unknown): typeof FAILED => {
        silentCatch('fleet/mandates:autopilot-mode')(err);
        return FAILED;
      }),
    ).then((results) => {
      if (!live) return;
      const next = new Map<string, AutopilotMode | null>();
      results.forEach((r, i) => { if (r !== FAILED) next.set(ids[i]!, r); });
      setModes(next);
    });
    return () => { live = false; };
  }, [key]);
  return modes;
}
