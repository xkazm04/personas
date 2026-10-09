/**
 * THE SEAM. Every write the Progress canvas performs goes through exactly these
 * three operations, and nothing else in `progress/` calls the milestone API.
 *
 * All three are REAL: `dev_milestones` and `dev_milestone_items` already exist
 * (see `src/api/devTools/milestones.ts`, `src-tauri/db/src/repos/dev/milestones.rs`)
 * and the Ship tab has been writing them since the Ship layer landed. A goal
 * binds to a milestone as a member row with `item_kind = 'goal'`; "moving" a
 * goal between milestones is therefore a remove plus an upsert, not a column
 * update on the goal. Nothing here invents an entity or fabricates data.
 *
 * It is one module so the canvas layouts can be read without knowing the
 * schema, and so a future change of mind about what a bind MEANS (bucket,
 * ordering, whether a goal may sit in two cuts) is one file.
 */
import {
  createMilestone,
  deleteMilestone,
  listMilestoneItems,
  listMilestones,
  removeMilestoneItem,
  setMilestoneItem,
  type MilestoneBucket,
} from '@/api/devTools/milestones';
import type { DevMilestone } from '@/lib/bindings/DevMilestone';
import { mapWithConcurrency } from '@/lib/concurrency';

/**
 * The bucket a goal lands in when it is bound from this surface.
 *
 * `core` is the honest default: dropping a goal onto a milestone here is a
 * deliberate commitment, and `later`/`never` are triage verdicts the Ship tab's
 * composer exists to make. The canvas does not offer a bucket choice, so it must
 * not silently pick a hedge.
 */
export const BIND_BUCKET: MilestoneBucket = 'core';

/** How many member-list reads run at once. A fan-out needs a declared width. */
const MEMBER_FANOUT = 6;

/** One milestone as the canvas needs it: identity, cut state, and its goals. */
export interface MilestoneLane {
  id: string;
  projectId: string;
  name: string;
  /** 'planned' | 'active' | 'shipped' - the cut's own lifecycle. */
  status: string;
  targetDate: string | null;
  /** Goal ids bound to this milestone (member rows of kind 'goal'). */
  goalIds: ReadonlySet<string>;
  /** The cut's position in the project's plan - the layered views order by it. */
  orderIndex: number;
  /** The objective as a SHORT title (the Ship heading); `null` when unset. */
  objective: string | null;
  description: string | null;
  cutAt: string | null;
  shippedAt: string | null;
}

/** Create a milestone in `planned` state. Cutting and shipping stay in Ship. */
export async function addMilestone(projectId: string, name: string): Promise<string> {
  const created = await createMilestone({ projectId, name: name.trim(), status: 'planned' });
  return created.id;
}

/** Delete a milestone outright. Its member rows go with it (FK cascade). */
export async function removeMilestone(milestoneId: string): Promise<void> {
  await deleteMilestone(milestoneId);
}

/**
 * Re-bind a goal. `from` is every milestone it currently sits in (usually one,
 * but the schema permits several and a silent partial move would leave the goal
 * in two cuts); `to` is `null` to unbind it entirely.
 *
 * Unbind-then-bind, in that order: binding first would, for a goal already in
 * `to`, be followed by its own removal.
 */
export async function moveGoalToMilestone(
  goalId: string,
  from: readonly string[],
  to: string | null,
): Promise<void> {
  for (const id of from) {
    if (id === to) continue;
    await removeMilestoneItem(id, 'goal', goalId);
  }
  if (to && !from.includes(to)) {
    await setMilestoneItem(to, 'goal', goalId, BIND_BUCKET);
  }
}

/**
 * Read the lanes for one project: its milestones, each with the goal ids bound
 * to it. The member lists are a fan-out, so it runs at a DECLARED width rather
 * than `Promise.all` over whatever the data happened to be.
 */
export async function loadLanes(projectId: string): Promise<MilestoneLane[]> {
  const milestones = await listMilestones(projectId);
  return lanesFor(projectId, milestones);
}

/** The same shaping, for callers that already hold the milestone rows. */
export async function lanesFor(
  projectId: string,
  milestones: readonly DevMilestone[],
): Promise<MilestoneLane[]> {
  return mapWithConcurrency(milestones, MEMBER_FANOUT, async (m) => {
    const items = await listMilestoneItems(m.id);
    const goalIds = new Set(items.filter((i) => i.itemKind === 'goal').map((i) => i.itemId));
    return {
      id: m.id,
      projectId,
      name: m.name,
      status: m.status,
      targetDate: m.targetDate,
      goalIds,
      orderIndex: m.orderIndex,
      objective: m.goal,
      description: m.description,
      cutAt: m.cutAt,
      shippedAt: m.shippedAt,
    };
  });
}
