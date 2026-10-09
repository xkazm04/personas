// Synthetic tapes for Lifecycle excellence wave 9, the Overseer cockpit
// (lifecycleSurfaces.tsx, overseerSurfaces.tsx). Built ON the collar tape
// (lifecycleTapes.mjs), whose snapshot already carries the Overseer's goal with
// every item state once and whose calls answer the Send preview
// (`dev_tools_lifecycle_send_preview`, every group present) and
// `companions_status` (the Overseer on). Fixture CODE, no personal data.
//
//   plugins/lifecycle/overseer-off     the collar with the Overseer switched off: the header's warning chip
//   plugins/lifecycle/overseer-folded  every Overseer item closed: the goal panel starts folded, no rail badge
//   companions/overseer/empty-scope    Overseer > Reviews with no agent in scope and three watched pipelines
//                                      (one never sent): the pipelines render under the empty scope
//   companions/overseer/scorecard      the same pipelines under a scope of two agents
//   companions/overseer/watched        the Watched pipelines section alone (its cards in the shot)
//
// The Send preview is shot on the collar with
//   --steps "click=[data-testid=lc-overseer-send];wait=700"
import { lifecycleTapes } from './lifecycleTapes.mjs';

export function lifecycleOverseerTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const iso = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const base = lifecycleTapes({ RECORDED_AT });
  const { GOAL, companionsStatus, snapshot, tape } = base;

  function overseerOff() {
    const t = tape('plugins/lifecycle/overseer-off', 'Synthetic: the collar with the Overseer switched off.', snapshot());
    t.calls = t.calls.map((c) => (c.cmd === 'companions_status' ? { ...c, response: companionsStatus(false) } : c));
    return t;
  }

  function folded() {
    const closed = GOAL.items.map((i) => (i.status === 'accepted'
      ? { ...i, status: 'delivered', verifyState: 'cleared', updatedAt: iso(45) }
      : i));
    return tape('plugins/lifecycle/overseer-folded', 'Synthetic: every Overseer item closed or set aside; the goal panel starts folded.',
      snapshot({ goal: { ...GOAL, openItems: 0, items: closed } }));
  }

  // --- Overseer > Reviews -------------------------------------------------
  const BEFORE = ['frame', 'recall', 'isolate', 'sync'];
  const rail = (verdicts) => Object.entries(verdicts).map(([stepId, health]) => ({
    stepId, phase: BEFORE.includes(stepId) ? 'before' : 'after', label: null, health,
  }));
  const goal = (id, total, green, instructed, openItems) => ({
    goalId: id, measurableTotal: total, measurableGreen: green, instructed, openItems, items: [],
  });
  const WATCHED = [
    {
      projectId: 'p-atlas', projectName: 'Atlas Web', goal: goal('goal-1', 8, 3, 2, 2), lastMeasuredAt: iso(30),
      steps: rail({ frame: 'instructed', recall: 'instructed', isolate: 'green', sync: 'unmeasured', gate: 'amber', tests: 'amber', docs: 'green', commit: 'stale', land: 'red', record: 'green' }),
    },
    {
      projectId: 'p-beacon', projectName: 'Beacon API', goal: goal('goal-2', 8, 7, 2, 1), lastMeasuredAt: iso(60 * 5),
      steps: rail({ frame: 'instructed', recall: 'instructed', isolate: 'green', sync: 'green', gate: 'green', tests: 'amber', docs: 'green', commit: 'green', land: 'green', record: 'green' }),
    },
    {
      projectId: 'p-comet', projectName: 'Comet Docs', goal: null, lastMeasuredAt: null,
      steps: rail({ frame: 'instructed', recall: 'instructed', isolate: 'unmeasured', sync: 'unmeasured', gate: 'unmeasured', tests: 'unmeasured', docs: 'stale', commit: 'unmeasured', land: 'unmeasured', record: 'unmeasured' }),
    },
  ];

  const ROLLUP = {
    periodDays: 30, totalExecutions: 184, assessedExecutions: 160, valueDelivered: 112, partial: 26, preconditionFailed: 9,
    noInputAvailable: 6, unknown: 7, valueDeliveredRate: 0.7, totalCostUsd: 41.3, costPerValueDelivered: 0.37,
    models: [{ model: 'claude-sonnet', executions: 140, costUsd: 30.1, valueDelivered: 92 }, { model: 'claude-haiku', executions: 44, costUsd: 11.2, valueDelivered: 20 }],
  };
  const roster = (personaId, name, score, rate, runs, reviewedMin) => ({
    personaId, name, icon: null, color: '#06b6d4', latestScore: score, scoreTrend: [score - 1, score, score],
    valueDeliveredRate: rate, totalExecutions: runs, lastReviewedAt: iso(reviewedMin), latestReviewUnscored: false,
  });
  const portfolio = (inScope) => ({
    rollup: ROLLUP,
    roster: inScope ? [roster('p-triage', 'Inbox Triage', 7, 0.74, 96, 60 * 20), roster('p-release', 'Release Notes Writer', 5, 0.58, 88, 60 * 30)] : [],
    scoreDistribution: inScope ? [{ score: 5, count: 1 }, { score: 7, count: 1 }] : [],
    inScope: inScope ? 2 : 0, reviewed: inScope ? 2 : 0, unreviewed: 0, avgScore: inScope ? 6 : null, periodDays: 30,
  });
  const page = (module, note, inScope) => ({
    version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note,
    calls: [
      { cmd: 'get_director_portfolio', response: portfolio(inScope) },
      { cmd: 'list_director_verdicts', response: [] },
      { cmd: 'get_director_brain_enabled', response: false },
      { cmd: 'dev_tools_overseer_watched_pipelines', response: WATCHED },
      { cmd: 'list_projects', response: [] },
      { cmd: 'companions_status', response: companionsStatus(true) },
    ],
  });

  return {
    WATCHED,
    builders: {
      'plugins/lifecycle/overseer-off': overseerOff,
      'plugins/lifecycle/overseer-folded': folded,
      'companions/overseer/empty-scope': () => page('companions/overseer/empty-scope',
        'Synthetic: no agent in the coaching scope; three watched pipelines, one never sent.', false),
      'companions/overseer/scorecard': () => page('companions/overseer/scorecard',
        'Synthetic: two agents in scope; three watched pipelines, one never sent.', true),
      'companions/overseer/watched': () => page('companions/overseer/watched',
        'Synthetic: the Watched pipelines section alone; three pipelines, one never sent.', true),
    },
  };
}
