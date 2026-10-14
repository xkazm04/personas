// Synthetic tapes for the Activity board under the `lanes` decision surface
// (mandateLanesSurfaces.tsx). Fixture CODE, no personal data.
//
// On top of the Classic tape (monitorActivityTapes.mjs: the 30-persona fleet,
// 10 sessions, 3 dev projects tied to bays) this answers the mandate reads:
// the lanes snapshot (cards in every operator lane, a stop breach, orphans,
// held items), four mandates in each state the Stewards plate paints (asking,
// quiet, draft, suspended), their act log (router filing, steward and
// operator acts, a final act, a reverted one and its revert), the counts and
// each project's autopilot mode.

import { monitorActivityTapes } from './monitorActivityTapes.mjs';

const CHARTERS = [
  // [charterId, projectId, projectName, title, steward, status, rung, version, scopes, budget, spend, acts, asks]
  ['ch-personas', 'dp-personas', 'personas', 'Keep the desktop app shippable', 'App Master · personas', 'active', 3, 2, ['report.read', 'review.info', 'idea.reject'], 120, 47.5, 38, 2],
  ['ch-docs', 'dp-docs', 'docs', 'Docs follow every release', 'App Master · docs', 'active', 2, 0, [], null, 3.2, 4, 0],
  ['ch-research', 'dp-research', 'research', 'Benchmark the new routers', 'App Master · research', 'draft', 1, 0, [], 40, null, 0, 0],
  ['ch-legal', 'dp-legal', 'legal', 'Contract review backlog', 'Athena', 'suspended', 2, 1, ['report.read'], 25, 24.1, 12, 1],
];

const ITEMS = [
  // [itemId, kind, lane, clause, charterId, projectId]
  ['incident:i1', 'incident', 'breach', 'stop', 'ch-personas', 'dp-personas'],
  ['review:r1', 'review', 'breach', 'risk', 'ch-personas', 'dp-personas'],
  ['review:r2', 'review', 'breach', 'unsigned', 'ch-docs', 'dp-docs'],
  ['idea:d1', 'idea', 'breach', 'unsigned', 'ch-docs', 'dp-docs'],
  ['mandate:ch-research', 'mandate', 'sign', 'none', 'ch-research', 'dp-research'],
  ['goal:g1', 'goal', 'accept', 'none', 'ch-personas', 'dp-personas'],
  ['report:p1', 'report', 'accept', 'none', 'ch-docs', 'dp-docs'],
  ['report:p2', 'report', 'evidence', 'none', 'ch-personas', 'dp-personas'],
  ['idea:o1', 'idea', 'orphan', 'none', null, 'dp-scratch'],
  ['idea:o2', 'idea', 'orphan', 'none', null, 'dp-scratch'],
  ['policy:x1', 'policy', 'orphan', 'none', null, null],
  ['review:h1', 'review', 'held', 'none', 'ch-legal', 'dp-legal'],
  ['review:h2', 'review', 'held', 'none', 'ch-research', 'dp-research'],
];

export function mandateLanesTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const base = monitorActivityTapes({ RECORDED_AT }).builders['monitor/classic'];

  const mandates = CHARTERS.map(([charterId, projectId, projectName, title, steward, status, rung, version, scopes, budget, spend, acts, asks]) => ({
    charterId, title, projectId, projectName, stewardPersonaId: `st-${charterId}`, stewardName: steward, status,
    scopeRung: rung, source: 'app_master', updatedAt: ago(90),
    envelope: { decideScopes: scopes, mergePolicy: 'never', budgetMonthlyUsd: budget, envelopeVersion: version, keptAtActs: null },
    load: { spendUsedUsd: spend, budgetUsd: budget, actsCount: acts, openAsks: asks },
  }));
  const held = (id) => ITEMS.filter((x) => x[2] === 'held' && x[4] === id).length;
  const snapshot = {
    items: ITEMS.map(([itemId, itemKind, lane, clause, charterId, projectId]) => ({
      itemId, itemKind, lane, clause, charterId, coalesceKey: `${charterId ?? 'orphan'}:${lane}:${clause}`,
      irreversible: null, projectId,
    })),
    charters: CHARTERS.map(([charterId, projectId, , , , status, , version]) => ({
      charterId, projectId, status, envelopeVersion: version, held: held(charterId),
    })),
    failedSources: [],
    generatedAt: RECORDED_AT,
  };
  const act = (id, minutes, over) => ({
    id, charterId: 'ch-personas', envelopeVersion: 2, itemKind: 'report', itemId: `report:${id}`, verdict: 'read',
    actor: 'router', scope: 'report.read', reversible: true, costUsd: null, shownJson: null, envChange: null,
    revertedAt: null, revertActId: null, originDevice: null, createdAt: ago(minutes), ...over,
  });
  const acts = [
    act('a1', 4, {}),
    act('a2', 18, { itemKind: 'review', itemId: 'review:q7', verdict: 'approved', scope: 'review.info' }),
    act('a3', 33, { actor: 'steward', itemKind: 'idea', itemId: 'idea:k2', verdict: 'rejected', scope: 'idea.reject' }),
    act('a4', 52, { actor: 'operator', itemKind: 'mandate', itemId: 'mandate:ch-personas', verdict: 'amended', scope: null, reversible: false }),
    act('a5', 75, { revertedAt: ago(70), revertActId: 'a6' }),
    act('a6', 70, { actor: 'operator', itemKind: 'act.revert', itemId: 'a5', verdict: 'reverted', scope: null }),
    act('a7', 140, { actor: 'operator', itemKind: 'mandate', itemId: 'mandate:ch-personas', verdict: 'signed', scope: null, envelopeVersion: 1, reversible: false }),
  ];
  const pending = {
    goalAcceptance: 1, manualReviews: 2, ideas: 3, policyProposals: 1, promotionProposals: 0, openIncidents: 1,
    blockingIncidents: 1, unreadReports: 2, companionApprovals: 0, councilDecidable: 0, decisionTotal: 11, total: 11,
  };
  const calls = [
    { cmd: 'decision_lanes_snapshot', response: snapshot },
    { cmd: 'mandate_list', response: mandates },
    { cmd: 'charter_acts_list', response: acts },
    { cmd: 'dev_tools_pending_counts', response: pending },
    { cmd: 'dev_tools_get_autopilot_mode', response: 'full' },
  ];
  const tape = (module) => () => {
    const t = base();
    return {
      ...t,
      module,
      note: `${t.note} Plus the mandate lanes: a lanes snapshot (stop breach, sign, accept, orphans, held), four mandates (asking, quiet, draft, suspended) and an act log with a final and a reverted act.`,
      calls: [...t.calls.filter((c) => !calls.some((x) => x.cmd === c.cmd)), ...calls],
    };
  };
  return {
    builders: {
      'monitor/mandate-lanes': tape('monitor/mandate-lanes'),
      'monitor/mandate-lanes/register': tape('monitor/mandate-lanes/register'),
      'monitor/mandate-lanes/page': tape('monitor/mandate-lanes/page'),
    },
  };
}
