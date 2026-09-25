/**
 * ONE hook, two lanes - and one place the push swap happens.
 *
 * ## Why a hook and not two fetches in the page
 *
 * The operator asked for state that ARRIVES: "changing states of queue items
 * will be dynamically reflected in the UI, ideally listening events from
 * Curator... I would avoid polling." The event does not exist yet. The pattern
 * does, so this hook is written for it now: one `createSingletonListener` over
 * `companions://status-changed`, which re-reads the lane when the backend says
 * something moved. The day Curator publishes a request-level event, the swap
 * is the one constant below and nothing else in the variant changes.
 *
 * There is NO interval in this file, deliberately. A polling loop written as a
 * placeholder is a polling loop that ships.
 *
 * ## Why a fixture is a state and not a mock
 *
 * Both tables are empty today (`curator_plan_run` 0 rows, `curator_request` 0
 * rows). A read that lands EMPTY is not a read that FAILED and neither is a
 * read nobody could make - so the lane reports which of the three it is, and
 * the surface says so out loud beside the section title. The fixture is drawn
 * only when the operator asks for it, and the page never pretends it is live.
 */
import { useCallback, useEffect, useState } from 'react';

import { curatorPlanCurrent, curatorRequestsList } from '@/api/curator';
import { COMPANIONS_STATUS_EVENT } from '@/api/companions';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import type { CuratorRequest } from '@/lib/bindings/CuratorRequest';
import { silentCatch } from '@/lib/silentCatch';
import { buildModel } from '@/features/companions/curator/blueprint/model/buildModel';

import { PLAN_ROWS, type PlanRow } from './planFixture';
import { QUEUE_ITEMS, type Fact, type QueueItem } from './queueFixture';

/**
 * THE SWAP POINT. Today the only event Curator's side publishes is the
 * companion-status one; when a request-level event lands, change this name and
 * the whole surface becomes push-fed for free.
 */
const useCuratorChanged = createSingletonListener<unknown>(COMPANIONS_STATUS_EVENT);

/** What the read found. `empty` and `unread` are different facts about a lane. */
export type LaneSource = 'live' | 'empty' | 'unread';

export interface Lanes {
  plan: readonly PlanRow[];
  planSource: LaneSource;
  queue: readonly QueueItem[];
  queueSource: LaneSource;
  loading: boolean;
}

const MS_PER_MIN = 60_000;

/**
 * A live request carries no topic and no impact: the pre-pass the operator
 * described does not exist. That is UNKNOWN for anything with a target, and
 * UNMEASURABLE for a bare-runnable skill, which has no resource to read.
 */
function fromRequest(r: CuratorRequest, now: number): QueueItem {
  const unreadable: Fact = { kind: 'unmeasurable' };
  const unknown: Fact = { kind: 'unknown' };
  const fact = r.argument === null ? unreadable : unknown;
  const filed = Date.parse(r.createdAt);
  return {
    id: r.id,
    skill: r.skill,
    argument: r.argument,
    note: r.note,
    state: r.state,
    filedMinutesAgo: Number.isNaN(filed) ? 0 : Math.max(0, Math.round((now - filed) / MS_PER_MIN)),
    topic: fact,
    impact: fact,
    outcome: r.outcome ?? r.failureReason,
  };
}

export function useLanes(showFixture: boolean): Lanes {
  const [plan, setPlan] = useState<readonly PlanRow[]>([]);
  const [planSource, setPlanSource] = useState<LaneSource>('unread');
  const [queue, setQueue] = useState<readonly QueueItem[]>([]);
  const [queueSource, setQueueSource] = useState<LaneSource>('unread');
  const [loading, setLoading] = useState(true);

  const read = useCallback(async () => {
    const [planRes, queueRes] = await Promise.allSettled([curatorPlanCurrent(), curatorRequestsList()]);
    if (planRes.status === 'fulfilled') {
      const rows = planRes.value ? buildModel(planRes.value).rows ?? [] : [];
      setPlan(rows);
      setPlanSource(rows.length > 0 ? 'live' : 'empty');
    } else {
      silentCatch('curator:blueprint:v2a:plan')(planRes.reason);
      setPlanSource('unread');
    }
    if (queueRes.status === 'fulfilled') {
      const now = Date.now();
      const items = queueRes.value.map((r) => fromRequest(r, now));
      setQueue(items);
      setQueueSource(items.length > 0 ? 'live' : 'empty');
    } else {
      silentCatch('curator:blueprint:v2a:queue')(queueRes.reason);
      setQueueSource('unread');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void read();
  }, [read]);
  // Push, not poll: the backend says something moved and the lane is re-read.
  useCuratorChanged(() => {
    void read();
  });

  if (showFixture) {
    return { plan: PLAN_ROWS, planSource, queue: QUEUE_ITEMS, queueSource, loading: false };
  }
  return { plan, planSource, queue, queueSource, loading };
}
