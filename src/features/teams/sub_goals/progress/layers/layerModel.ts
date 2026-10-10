/**
 * The LAYERED views' model: one project seen as its milestones.
 *
 * The fusion this module exists for: a milestone is the unit both surfaces
 * already share. Goals bind to it (`dev_milestone_items`, kind 'goal') and a
 * note is its living brief (`dev_notes.milestone_id`, unique per milestone).
 * So L1 draws milestones, and L2 opens one milestone's brief note together
 * with its goals - neither the Notepad nor the filmstrip is copied, both are
 * read.
 *
 * Pure: everything the DOM or the stores know is passed in, so the three
 * layouts compute the same numbers and a test needs no providers.
 */
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevNote } from '@/lib/bindings/DevNote';

import { isComplete } from '../../goalStatus';
import type { MilestoneLane } from '../milestoneOps';

/** One milestone as every L1 layout draws it. */
export interface MilestoneCard {
  lane: MilestoneLane;
  /** The bound goals, in the goals' own `order_index` order. */
  goals: DevGoal[];
  /** The milestone's brief note, or `null` when nobody has written one. */
  brief: DevNote | null;
  /**
   * 0-100, the mean of the bound goals' progress with a done goal counting as
   * 100. `null` when no goal is bound: an empty cut has no progress, and a 0
   * would claim one was measured.
   */
  progress: number | null;
  doneCount: number;
}

export interface ProjectLayer {
  projectId: string;
  name: string;
  /** Ordered by the plan's `orderIndex`, then target date; shipped cuts last. */
  milestones: MilestoneCard[];
  /** Goals of the project bound to no milestone. */
  unassigned: DevGoal[];
  /** Brainstorm notes of the project that are not any milestone's brief. */
  ideas: DevNote[];
}

/** A goal's contribution to its milestone's fill. */
export function goalWeight(g: DevGoal): number {
  if (isComplete(g.status)) return 100;
  return Math.max(0, Math.min(100, Math.round(g.progress ?? 0)));
}

export function milestoneProgress(goals: readonly DevGoal[]): number | null {
  if (goals.length === 0) return null;
  const sum = goals.reduce((acc, g) => acc + goalWeight(g), 0);
  return Math.round(sum / goals.length);
}

const byOrder = (a: DevGoal, b: DevGoal) => a.order_index - b.order_index;

function milestoneOrder(a: MilestoneCard, b: MilestoneCard): number {
  const shippedA = a.lane.status === 'shipped' ? 1 : 0;
  const shippedB = b.lane.status === 'shipped' ? 1 : 0;
  if (shippedA !== shippedB) return shippedA - shippedB;
  if (a.lane.orderIndex !== b.lane.orderIndex) return a.lane.orderIndex - b.lane.orderIndex;
  return (a.lane.targetDate ?? '').localeCompare(b.lane.targetDate ?? '');
}

/**
 * Shape one project. `goals` is every goal of the project the portfolio holds
 * (done ones included - a milestone's fill counts them even when the strip's
 * done-filter hides them); `notes` is every non-archived note.
 */
export function buildProjectLayer(args: {
  projectId: string;
  name: string;
  goals: readonly DevGoal[];
  lanes: readonly MilestoneLane[];
  notes: readonly DevNote[];
}): ProjectLayer {
  const { projectId, name, goals, lanes, notes } = args;
  const own = goals.filter((g) => g.project_id === projectId);
  const briefOf = new Map<string, DevNote>();
  for (const n of notes) if (n.milestoneId) briefOf.set(n.milestoneId, n);

  const bound = new Set<string>();
  const milestones = lanes
    .map((lane): MilestoneCard => {
      const members = own.filter((g) => lane.goalIds.has(g.id)).sort(byOrder);
      for (const g of members) bound.add(g.id);
      return {
        lane,
        goals: members,
        brief: briefOf.get(lane.id) ?? null,
        progress: milestoneProgress(members),
        doneCount: members.filter((g) => isComplete(g.status)).length,
      };
    })
    .sort(milestoneOrder);

  return {
    projectId,
    name,
    milestones,
    unassigned: own.filter((g) => !bound.has(g.id)).sort(byOrder),
    ideas: notes.filter(
      (n) => n.projectId === projectId && n.milestoneId === null && n.status === 'draft',
    ),
  };
}
