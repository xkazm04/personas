/**
 * The console's three reads, its two writes, and her pulse.
 *
 * Each read is its own door and settles independently: the lane, the skill
 * catalog and the runtime can each fail without the other two going dark, and
 * a door that did not answer leaves its field `null` - which every consumer
 * renders as UNKNOWN. None of them falls back to an empty array, because an
 * empty lane and a lane nobody could read are different facts and this page's
 * whole argument is that they must look different.
 *
 * ## The photograph, and what ended it
 *
 * Until 2026-09-25 `reload()` ran ONCE, on mount, plus after a file or a
 * cancel. There was no interval and no listener, so the runtime strip showed
 * whatever had been true when the page was opened - for as long as it stayed
 * open. Measured against the operator's own machine the same day: her loop had
 * dispatched at 13:47, 17:38 and 20:46 UTC, two of her workers were running
 * that minute, and the console said none of it. The loop was never the defect.
 *
 * The fix is her own announcement, not a clock. `curator://pulse` carries her
 * WHOLE runtime, so the strip re-paints with zero IPC; only the kinds that move
 * the operator's lane - a dispatch, a settle - spend a read on it. A pulse that
 * could not measure her carries `runtime: null`, and THAT is the arm that
 * re-reads everything, because "she could not be measured" must never be drawn
 * as "she is doing nothing".
 *
 * **No repeating timer runs in this file or anywhere under it**, which is the
 * operator's own instruction and is checked by a grep over this whole tree.
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
import type { CuratorPulsePayload } from '@/lib/bindings/CuratorPulsePayload';
import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';
import type { CuratorSkill } from '@/lib/bindings/CuratorSkill';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import { LANE_MOVED, useCuratorPulse } from './curatorPulse';

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

  // Her announcement, applied. The runtime on the payload is the same reading
  // `curator_runtime_get` would answer with - it comes from the same function -
  // so taking it here is not a shortcut past the door, it IS the door,
  // delivered rather than asked for.
  useCuratorPulse(
    useCallback(
      (pulse: CuratorPulsePayload) => {
        if (pulse.runtime) {
          setRuntime(pulse.runtime);
          warm = { requests: warm?.requests ?? null, skills: warm?.skills ?? null, runtime: pulse.runtime };
        }
        // Two reasons to spend an IPC, and only two. A pulse this app could not
        // measure leaves the strip holding the previous reading, so the truth
        // has to be fetched; and a pulse that moved a `curator_request` row has
        // changed something the runtime does not carry.
        if (!pulse.runtime || LANE_MOVED.has(pulse.kind)) void reload();
      },
      [reload],
    ),
  );

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

/**
 * Drop the warm slot. Test-only, and mandated rather than convenient: the slot
 * is module scope on purpose (a remount must paint warm rather than re-ghost),
 * which means it also survives between test cases and carries one test's
 * answer into the next.
 */
export function __resetCuratorLoopForTests(): void {
  warm = null;
}
