/**
 * The skills the registry actually reads off disk, as the instrument reported
 * them on 2026-09-24 - including the one that documents no invocation at all,
 * which is why `runsBare` is nullable in the first place.
 */
import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';
import type { CuratorSkill } from '@/lib/bindings/CuratorSkill';

export function skill(over: Partial<CuratorSkill> = {}): CuratorSkill {
  return {
    name: 'intake',
    lane: 'native',
    path: '.claude/skills/intake/SKILL.md',
    title: 'Intake',
    description: 'Take a resource into the corpus.',
    version: '1.0.0',
    invocationDocumented: true,
    runsBare: false,
    argumentHint: '/intake <url or path>',
    ...over,
  };
}

/** `hygiene` - documents running bare. */
export const BARE = skill({
  name: 'hygiene',
  path: '.claude/skills/hygiene/SKILL.md',
  runsBare: true,
  argumentHint: null,
});
/** `intake` - documents an argument. */
export const TAKES_ARGUMENT = skill();
/** `forge` - documents NO invocation, so bare-runnability is unknown. */
export const UNKNOWN = skill({
  name: 'forge',
  path: '.claude/skills/forge/SKILL.md',
  lane: 'shared',
  invocationDocumented: false,
  runsBare: null,
  argumentHint: null,
});

export function runtime(over: Partial<CuratorRuntime> = {}): CuratorRuntime {
  return {
    enabled: true,
    running: 1,
    workerCap: 2,
    fannedOut: null,
    lane: 'queue',
    haltedReason: null,
    spentTodayUsd: 0,
    dailyBudgetUsd: 20,
    runsToday: 0,
    dailyRunCap: 12,
    commitsToday: 0,
    dailyCommitCap: 3,
    lastSleepAt: null,
    ...over,
  };
}
