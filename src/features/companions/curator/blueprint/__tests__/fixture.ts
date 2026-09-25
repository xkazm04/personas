/**
 * A plan, small enough to reason about, shaped exactly like the real DTO.
 *
 * Built by hand rather than copied from a run so a test can state the ONE
 * thing it is about: a bundle where demand was never read, beside a bundle
 * where it was, beside a quiet tail.
 */
import type { CuratorPlan } from '@/lib/bindings/CuratorPlan';
import type { CuratorPlanItem } from '@/lib/bindings/CuratorPlanItem';
import type { CuratorReason } from '@/lib/bindings/CuratorReason';

export const DEVIATION: CuratorReason = {
  code: 'deviation',
  weight: 56,
  detail: '14–28 consumer deviation(s)',
};
export const THIN: CuratorReason = {
  code: 'thin_techniques',
  weight: 4,
  detail: '3 techniques (design floor is 4)',
};

export function item(over: Partial<CuratorPlanItem> = {}): CuratorPlanItem {
  return {
    id: 'software-engineering/agent-memory',
    planRunId: 'plan-1',
    subjectId: 'software-engineering/agent-memory',
    domain: 'software-engineering',
    at: 'llm-agent/prompt-and-context/agent-memory',
    points: 56,
    reasons: [DEVIATION],
    dominantReason: 'deviation',
    engine: 'conform',
    techniques: 27,
    applications: 27,
    stacks: ['rust'],
    demandKnown: true,
    demand: { consults: 6, deviations: 14, deviationsSummed: 28, gone: 0, goneSummed: 0, contributors: 2 },
    lastSwept: '2026-09-07',
    registryDryStreak: 0,
    suppressedBySaturation: false,
    hasAppliedRow: true,
    state: 'dispatched',
    declinedReason: null,
    dispatchedRunId: null,
    evidenceRef: null,
    updatedAt: '2026-09-23T07:40:00Z',
    ...over,
  };
}

export function plan(over: Partial<CuratorPlan> = {}): CuratorPlan {
  return {
    run: {
      id: 'plan-1',
      createdAt: '2026-09-23T07:40:00Z',
      scanGeneratedAt: '2026-09-22T22:39:52.343Z',
      registryHeadSha: 'cc01b2b8',
      corpus: {
        generatedAt: '2026-09-22T22:39:52.343Z',
        today: '2026-09-23',
        subjects: 6,
        techniques: 3274,
        applications: 1825,
        domains: 2,
        demandKnownForAnyBundle: true,
        appliedSubjects: null,
        expiredApplications: 0,
        atRiskApplications: 4,
        driftUnknown: 505,
        drift: 77,
        // 301 of 1,825 applications carry no clock, so `expired: 0` is a
        // measured zero over a subset and unmeasurable over the rest.
        noClockApplications: 301,
        demandKnownDomains: ['software-engineering'],
      },
      consumers: {
        generatedAt: '2026-09-22T22:39:52.343Z',
        mapsStale: true,
        projects: [
          { slug: 'personas', contexts: 215, pairs: 1765, weak: 12, evaluated: 179, deviations: 122, staleVerdicts: 147, state: 'STALE', orphaned: 0 },
        ],
        totals: { projects: 1, pairs: 1765, evaluated: 179, weak: 12, staleVerdicts: 147, staleProjects: 1, orphaned: 0 },
        problems: [],
      },
      policy: {
        levelResearch: 'L1',
        levelForge: 'L0',
        levelConform: 'L3',
        levelSweep: 'L1',
        dailyBudgetUsd: null,
        dailyRunCap: 12,
        dailyCommitCap: null,
        quietHours: null,
        backpressureN: 8,
        workerCap: 1,
      },
      itemCount: 2,
      supersededBy: null,
    },
    items: [
      item(),
      // A bundle whose demand was never read: channels 1 and 7 are UNKNOWN
      // here, and a zero on them would be a lie.
      item({
        id: 'localization/czech',
        subjectId: 'localization/czech',
        domain: 'localization',
        at: 'european/czech',
        points: 4,
        reasons: [THIN],
        dominantReason: 'thin_techniques',
        techniques: 3,
        demandKnown: false,
        demand: null,
        state: 'planned',
      }),
    ],
    quiet: [
      { domain: 'software-engineering', subjects: 3, demandKnown: true },
      { domain: 'localization', subjects: 1, demandKnown: false },
    ],
    ...over,
  };
}
