/**
 * The two reads that sit BESIDE the plan: the operator's live settings and the
 * consent they have given per checkout.
 *
 * Both are optional because both are separate doors that can fail
 * independently of the plan, and a page that refused to draw without them
 * would be hostage to the smaller read.
 */
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';
import type { CuratorProject } from '@/lib/bindings/CuratorProject';

import type { BlueprintPolicy } from './types';

export interface BlueprintSources {
  policy?: CuratorPolicy | null;
  projects?: CuratorProject[] | null;
}

export function policyOf(p: CuratorPolicy): BlueprintPolicy {
  return {
    backpressureN: p.backpressureN,
    workerCap: p.workerCap,
    dailyBudgetUsd: p.dailyBudgetUsd,
    dailyRunCap: p.dailyRunCap,
    dailyCommitCap: p.dailyCommitCap,
    quietHours: p.quietHours,
    levels: {
      research: p.levelResearch,
      forge: p.levelForge,
      conform: p.levelConform,
      sweep: p.levelSweep,
    },
  };
}

/**
 * Which policy fields the live read disagrees with. The plan carries the
 * policy a person AGREED to; a caps change since then is a fact about the
 * decision they made, not a refresh to paper over.
 *
 * Compared FIELD BY FIELD rather than by serialising both sides: key order in
 * a JS object is insertion order and survives a round trip, so two identical
 * policies that were built in a different order would serialise differently
 * and report as drift.
 */
export function driftOf(stored: BlueprintPolicy, live: BlueprintPolicy | null): (keyof BlueprintPolicy)[] {
  if (!live) return [];
  const drift: (keyof BlueprintPolicy)[] = [];
  if (stored.backpressureN !== live.backpressureN) drift.push('backpressureN');
  if (stored.workerCap !== live.workerCap) drift.push('workerCap');
  if (stored.dailyBudgetUsd !== live.dailyBudgetUsd) drift.push('dailyBudgetUsd');
  if (stored.dailyRunCap !== live.dailyRunCap) drift.push('dailyRunCap');
  if (stored.dailyCommitCap !== live.dailyCommitCap) drift.push('dailyCommitCap');
  if (stored.quietHours !== live.quietHours) drift.push('quietHours');
  const levels = ['research', 'forge', 'conform', 'sweep'] as const;
  if (levels.some((k) => stored.levels[k] !== live.levels[k])) drift.push('levels');
  return drift;
}
