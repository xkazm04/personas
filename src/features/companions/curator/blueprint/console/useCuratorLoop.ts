/**
 * The console's three reads and its two writes.
 *
 * Each read is its own door and settles independently: the lane, the skill
 * catalog and the runtime can each fail without the other two going dark, and
 * a door that did not answer leaves its field `null` - which every consumer
 * renders as UNKNOWN. None of them falls back to an empty array, because an
 * empty lane and a lane nobody could read are different facts and this page's
 * whole argument is that they must look different.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  curatorRequestCancel,
  curatorRequestCreate,
  curatorRequestsList,
  curatorRuntimeGet,
  curatorSkillsList,
} from '@/api/curator';
import type { CuratorRequest } from '@/lib/bindings/CuratorRequest';
import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';
import type { CuratorSkill } from '@/lib/bindings/CuratorSkill';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export interface CuratorLoop {
  /** The operator's lane, oldest first. `null` while unread or unreadable. */
  requests: CuratorRequest[] | null;
  /** The discovered skills. `null` while unread or unreadable. */
  skills: CuratorSkill[] | null;
  /** What the loop is doing. `null` while unread or unreadable. */
  runtime: CuratorRuntime | null;
  /** True until the first settle, so a surface can hold its chrome. */
  loading: boolean;
  file: (input: { skill: string; argument: string | null; note: string | null }) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Last settle of this session. One slot, not a keyed cache: there is exactly
 * one registry and one operator lane, so a remount paints warm rather than
 * re-ghosting a queue the operator was just reading.
 */
let warm: { requests: CuratorRequest[] | null; skills: CuratorSkill[] | null; runtime: CuratorRuntime | null } | null =
  null;

export function useCuratorLoop(): CuratorLoop {
  const [requests, setRequests] = useState<CuratorRequest[] | null>(warm?.requests ?? null);
  const [skills, setSkills] = useState<CuratorSkill[] | null>(warm?.skills ?? null);
  const [runtime, setRuntime] = useState<CuratorRuntime | null>(warm?.runtime ?? null);
  const [loading, setLoading] = useState(!warm);

  const reload = useCallback(async () => {
    const [lane, catalog, live] = await Promise.allSettled([
      curatorRequestsList(),
      curatorSkillsList(),
      curatorRuntimeGet(),
    ]);
    // A refused read is reported once and then leaves its field null. It is
    // never coerced to `[]`: "she has nothing queued" and "nobody could ask"
    // are the two facts this surface most needs to keep apart.
    const nextRequests = lane.status === 'fulfilled' ? lane.value : null;
    const nextSkills = catalog.status === 'fulfilled' ? catalog.value : null;
    const nextRuntime = live.status === 'fulfilled' ? live.value : null;
    if (lane.status === 'rejected') silentCatch('curator:loop:requests')(lane.reason);
    if (catalog.status === 'rejected') silentCatch('curator:loop:skills')(catalog.reason);
    if (live.status === 'rejected') silentCatch('curator:loop:runtime')(live.reason);
    setRequests(nextRequests);
    setSkills(nextSkills);
    setRuntime(nextRuntime);
    warm = { requests: nextRequests, skills: nextSkills, runtime: nextRuntime };
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Both writes are the operator's own act, so a refusal is a TOAST and not a
  // console line: they pressed something and are owed an answer.
  const file = useCallback(
    async (input: { skill: string; argument: string | null; note: string | null }) => {
      try {
        await curatorRequestCreate(input);
        await reload();
      } catch (err) {
        toastCatch('curator:loop:file')(err);
      }
    },
    [reload],
  );

  const cancel = useCallback(
    async (id: string) => {
      try {
        await curatorRequestCancel(id);
        await reload();
      } catch (err) {
        toastCatch('curator:loop:cancel')(err);
      }
    },
    [reload],
  );

  return { requests, skills, runtime, loading, file, cancel, reload };
}
