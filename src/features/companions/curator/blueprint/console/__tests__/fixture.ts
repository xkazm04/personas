/**
 * The loop's runtime, as the instrument reported it on 2026-09-24.
 *
 * The three skill fixtures that stood beside it went with the request
 * composer, which is moving to the app-wide console; nothing in this console
 * reads the skill catalog any more.
 */
import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';

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
