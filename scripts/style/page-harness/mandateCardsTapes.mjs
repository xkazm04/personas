// Synthetic tape for the mandate-lane card shapes in the live Decision Deck
// (mandateCardsSurfaces.tsx, spark mandate-lanes WP5). Fixture CODE, no
// personal data.
//
// On top of the deck's own tape (decisionDeckTapes.mjs: approvals, incidents,
// ideas, reports, a council at the gate, a team thread) this answers the
// mandate reads: a lanes snapshot that routes those rows into Breach (a scope
// breach with a second item behind it, a stop, two valves), Sign (a draft
// mandate), Accept (a goal claim, a report, the council) and Talk; two
// mandates (one signed and active, one draft); the active one's act log for
// the claim's audit; the draft's refusal classes; one goal awaiting acceptance.

import { decisionDeckTapes } from './decisionDeckTapes.mjs';

const ROUTES = [
  // [itemId, lane, clause, charterId, coalesceKey, irreversible]
  ['idea:idea-1', 'breach', 'scope', 'ch-personas', 'ch-personas:breach:scope', null],
  ['idea:idea-2', 'breach', 'scope', 'ch-personas', 'ch-personas:breach:scope', null],
  ['incident:inc-1', 'breach', 'stop', 'ch-personas', 'ch-personas:breach:stop', null],
  ['approval:ap-1', 'breach', 'valve', null, 'approval:ap-1', 'outbound-message'],
  ['approval:ap-2', 'breach', 'valve', null, 'approval:ap-2', 'deletion'],
  ['incident:inc-2', 'held', 'none', 'ch-research', 'ch-research:held:none', null],
  ['mandate:ch-research', 'sign', 'none', 'ch-research', 'ch-research:sign:none', null],
  ['goal:goal-1', 'accept', 'none', 'ch-personas', 'ch-personas:accept:none', null],
  ['report:rep-md', 'accept', 'none', 'ch-personas', 'ch-personas:accept:none', null],
  ['council:cs-1', 'accept', 'none', 'ch-personas', 'ch-personas:accept:none', null],
];

export function mandateCardsTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const deck = decisionDeckTapes({ RECORDED_AT, PERSONAS }).builders['decision-center/deck']();

  const mandate = (charterId, projectId, projectName, title, steward, status, version, scopes, budget, spend, acts) => ({
    charterId, title, projectId, projectName, stewardPersonaId: `st-${charterId}`, stewardName: steward, status,
    scopeRung: 3, source: 'app_master', updatedAt: ago(90),
    envelope: { decideScopes: scopes, mergePolicy: 'never', budgetMonthlyUsd: budget, envelopeVersion: version, keptAtActs: null },
    load: { spendUsedUsd: spend, budgetUsd: budget, actsCount: acts, openAsks: 1 },
  });
  const mandates = [
    mandate('ch-personas', 'proj-harness', 'Personas', 'Keep the desktop app shippable', 'App Master · Personas', 'active', 2, ['report.read', 'review.info'], 120, 47.5, 38),
    mandate('ch-research', 'proj-research', 'Research', 'Benchmark the new routers', 'App Master · Research', 'draft', 0, [], 40, null, 0),
  ];

  const snapshot = {
    items: ROUTES.map(([itemId, lane, clause, charterId, coalesceKey, irreversible]) => ({
      itemId, itemKind: itemId.split(':')[0], lane, clause, charterId, coalesceKey, irreversible,
      projectId: charterId === 'ch-research' ? 'proj-research' : charterId ? 'proj-harness' : null,
    })),
    charters: [
      { charterId: 'ch-personas', projectId: 'proj-harness', status: 'active', envelopeVersion: 2, held: 0 },
      { charterId: 'ch-research', projectId: 'proj-research', status: 'draft', envelopeVersion: 0, held: 4 },
    ],
    failedSources: [],
    generatedAt: RECORDED_AT,
  };

  const shown = (kind, title) => JSON.stringify({ itemKind: kind, itemId: `${kind}:x`, title, lane: 'evidence', clause: 'none' });
  const act = (id, minutes, over) => ({
    id, charterId: 'ch-personas', envelopeVersion: 2, itemKind: 'report', itemId: `report:${id}`, verdict: 'filed as evidence',
    actor: 'router', scope: 'report.read', reversible: true, costUsd: null, shownJson: null, envChange: null,
    revertedAt: null, revertActId: null, originDevice: null, createdAt: ago(minutes), ...over,
  });
  const acts = [
    act('a1', 4, { shownJson: shown('report', 'Nightly gate report, desktop build') }),
    act('a2', 18, { itemKind: 'review', itemId: 'review:q7', verdict: 'approved', scope: 'review.info', reversible: false, shownJson: shown('review', 'Release notes wording') }),
    act('a3', 33, { actor: 'steward', itemKind: 'idea', itemId: 'idea:k2', verdict: 'rejected', scope: 'idea.reject', shownJson: shown('idea', 'Rewrite the updater in Go') }),
    act('a4', 51, { shownJson: shown('report', 'Bundle size audit') }),
    act('a5', 75, { actor: 'steward', itemKind: 'incident', itemId: 'incident:z1', verdict: 'acknowledged', scope: 'incident.triage', shownJson: shown('incident', 'Flaky e2e on Windows') }),
    act('a6', 140, { actor: 'operator', itemKind: 'mandate', itemId: 'ch-personas', verdict: 'signed', scope: null, envelopeVersion: 1 }),
  ];

  const goal = {
    goal_id: 'goal-1', title: 'Activation reaches 50% for new installs',
    summary: 'The onboarding tour now ends on a first run instead of the settings page. The team reports activation at 52% over the last 14 days.',
    project_id: 'proj-harness', project_name: 'Personas', team_id: 'team-growth', team_name: 'Growth team',
    kpi_id: 'kpi-act', kpi_name: 'Activation, 14 days', kpi_unit: '%', kpi_current: 52, kpi_target: 50, kpi_baseline: 31,
    kpi_direction: 'up', completed_at: ago(300),
  };

  const charter = {
    id: 'ch-research', personaId: 'st-ch-research', title: 'Benchmark the new routers', domain: 'research', outcomes: [], objectives: [],
    scopeRung: 3, refusalClasses: ['custom:production-deploys', 'custom:payments'], approvalGates: [], owner: null, cadence: null,
    tenure: null, status: 'draft', source: 'app_master', connectors: [], procedure: null, spec: null, createdAt: ago(600), updatedAt: ago(90),
  };

  const calls = [
    { cmd: 'decision_lanes_snapshot', response: snapshot },
    { cmd: 'mandate_list', response: mandates },
    { cmd: 'charter_acts_list', response: acts },
    { cmd: 'list_persona_responsibilities', response: [charter] },
    { cmd: 'dev_tools_list_pending_acceptance', response: [goal] },
    // Sources the lane deck's roster also reads, answered empty: nothing of theirs is routed here.
    { cmd: 'list_manual_reviews_page', response: { rows: [], nextCursor: null, hasMore: false } },
    { cmd: 'policy_tuning_list', response: [] },
    { cmd: 'evolution_list_promotion_proposals', response: [] },
    { cmd: 'get_persona_summaries', response: [] },
    { cmd: 'list_persona_channel', response: [] },
    { cmd: 'dev_tools_undispatched_ideas', response: [] },
    { cmd: 'count_team_channel_kinds', response: { step: 0, event: 0, memory: 0, message: 5, deliberation: 0, slack: 0 } },
  ];

  return {
    builders: {
      'decision-center/mandate-cards': () => ({
        ...deck,
        module: 'decision-center/mandate-cards',
        note: `${deck.note} Plus the mandate lanes: a snapshot routing them into Breach (scope with one behind it, stop, two valves), Sign (a draft mandate), Accept (goal claim, report, council) and Talk; one signed and one draft mandate; an act log; refusal classes; one goal awaiting acceptance.`,
        calls: [...deck.calls.filter((c) => !calls.some((x) => x.cmd === c.cmd)), ...calls],
      }),
    },
  };
}
