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

// The act log, in the shapes the writers really store: the router's verdict
// tokens with the title it was shown (`mandate_sweep.rs` `shown`), envelope
// acts with no shown_json, a revert carrying the reverted act's verdict, a
// router review approval recorded final.
const shown = (itemKind, title) => JSON.stringify({ itemKind, itemId: `${itemKind}:x`, title, lane: 'evidence', clause: 'none' });
function actLog(ago) {
  const act = (id, minutes, over) => ({
    id, charterId: 'ch-personas', envelopeVersion: 2, itemKind: 'report', itemId: `report:${id}`, verdict: 'filed as evidence',
    actor: 'router', scope: 'report.read', reversible: true, costUsd: null, shownJson: null, envChange: null,
    revertedAt: null, revertActId: null, originDevice: null, createdAt: ago(minutes), ...over,
  });
  return [
    act('o1', 2, { actor: 'operator', itemKind: 'mandate', itemId: 'ch-personas', verdict: 'merge-policy-set', scope: null }),
    act('a1', 4, { shownJson: shown('report', 'Nightly gate report, desktop build') }),
    act('a8', 5, { shownJson: shown('report', 'Bundle size audit') }),
    act('a9', 6, { shownJson: shown('report', 'Dependency drift scan') }),
    act('a2', 18, { itemKind: 'review', itemId: 'review:q7', verdict: 'approved', scope: 'review.info', reversible: false, shownJson: shown('review', 'Release notes wording') }),
    act('a3', 33, { actor: 'steward', itemKind: 'idea', itemId: 'idea:k2', verdict: 'rejected', scope: 'idea.reject', shownJson: shown('idea', 'Rewrite the updater in Go') }),
    act('a6', 70, { actor: 'operator', itemKind: 'act.revert', itemId: 'a5', verdict: 'reverted', scope: null, reversible: false, shownJson: JSON.stringify({ revertedAct: 'a5', verdict: 'filed as evidence' }) }),
    act('a5', 75, { revertedAt: ago(70), revertActId: 'a6', shownJson: shown('report', 'Flaky test triage, week 41') }),
    act('a7', 140, { actor: 'operator', itemKind: 'mandate', itemId: 'ch-personas', verdict: 'signed', scope: null, envelopeVersion: 1 }),
  ];
}

/**
 * The rows the roster reads for the cards the snapshot routes to an operator
 * lane, with the SAME ids (`review:r1` is review row `r1`): the lane button
 * counts the snapshot, the peek lists roster rows joined to it, so a snapshot
 * entry with no row behind it is a count the peek cannot show (residue item 1:
 * "Breach 4" over "Nothing waiting here" was this gap, not a code bug).
 * Shapes are the ts-rs bindings' (ManualReview page, DevIdea, AuditIncident,
 * PendingAcceptanceGoal, PersonaReport).
 */
export const CARD_CMDS = [
  'list_manual_reviews_page', 'dev_tools_triage_ideas', 'list_audit_incidents',
  'dev_tools_list_pending_acceptance', 'list_unread_reports',
];
function cardRows(ago) {
  const review = (id, personaId, title, description, severity, minutes) => ({
    id, execution_id: null, persona_id: personaId, title, description, severity, context_data: null,
    suggested_actions: null, status: 'pending', reviewer_notes: null, resolved_at: null, created_at: ago(minutes),
    updated_at: ago(minutes), use_case_id: null, assignment_id: null, step_id: null,
  });
  const idea = {
    id: 'd1', project_id: 'dp-docs', context_id: null, scan_type: 'docs', category: 'maintenance',
    title: 'Generate the CLI reference from the command registry',
    description: 'The CLI page is written by hand and drifted twice this month. Generating it from the registry keeps it true.',
    reasoning: 'Raised by the docs scan after the second drift.', status: 'pending', effort: 3, impact: 6, risk: 2,
    priority: null, provider: 'claude', model: 'opus', rejection_reason: null, origin: 'scan', use_case_id: null,
    evidence: null, dedup_key: null, goal_id: null, verify_state: null, verify_checked_at: null, verify_evidence: null,
    plan: null, completeness: null, created_at: ago(300), updated_at: ago(300),
  };
  const incident = {
    id: 'i1', sourceTable: 'tool_execution_audit_log', sourceId: 'src-i1', dedupKey: 'audit:i1', personaId: 'p-board-2',
    personaName: 'Incident Scribe', executionId: 'exec-i1', severity: 'critical', kind: 'credential_expired',
    title: 'Release Noter: GitHub token expired', detail: 'Three runs in a row failed with 401 from the GitHub connector.',
    status: 'open', acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolutionNote: null, continuedAt: null,
    createdAt: ago(40),
  };
  const goal = {
    goal_id: 'g1', title: 'Crash-free sessions above 99.5%', summary: 'The updater fix shipped; the last 14 days read 99.7%.',
    project_id: 'dp-personas', project_name: 'personas', team_id: null, team_name: null, kpi_id: null, kpi_name: null,
    kpi_unit: null, kpi_current: null, kpi_target: null, kpi_baseline: null, kpi_direction: null, completed_at: ago(200),
  };
  const report = (id, title, minutes) => ({
    id, persona_id: 'p-board-4', execution_id: `exec-${id}`, title, content: `# ${title}\n\nNothing failed this week.`,
    content_type: 'markdown', priority: 'normal', is_read: false, metadata: null, created_at: ago(minutes), read_at: null,
    thread_id: null, use_case_id: null,
  });
  return [
    { cmd: 'list_manual_reviews_page', response: { rows: [
      review('r1', 'p-board-0', 'Ship the vault export format change?', 'The 1.1 export drops the legacy field.', 'high', 25),
      review('r2', 'p-board-3', 'Publish the docs for the new CLI?', 'The reference page is regenerated.', 'low', 90),
    ], hasMore: false, nextCursor: null } },
    { cmd: 'dev_tools_triage_ideas', response: { ideas: [idea], cursor: null, hasMore: false, counts: { pending: 1, accepted: 0, rejected: 0 } } },
    { cmd: 'list_audit_incidents', response: [incident] },
    { cmd: 'dev_tools_list_pending_acceptance', response: [goal] },
    { cmd: 'list_unread_reports', response: [report('p1', 'Docs release digest, week 41', 60), report('p2', 'Nightly gate report', 15)] },
  ];
}

/** The router filings the ticker variants push on `charter-act-recorded`, oldest first (createdAt is set at push time). */
export const TICKER_ACTS = ['a9', 'a8', 'a1'].map((id, i) => ({
  id, charterId: 'ch-personas', envelopeVersion: 2, itemKind: 'report', itemId: `report:${id}`, verdict: 'filed as evidence',
  actor: 'router', scope: 'report.read', reversible: true, costUsd: null, shownJson: null, envChange: null,
  revertedAt: null, revertActId: null, originDevice: null, createdAt: new Date(Date.UTC(2026, 9, 15, 10, 0, i * 20)).toISOString(),
}));

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
  const acts = actLog(ago);
  const pending = {
    goalAcceptance: 1, manualReviews: 2, ideas: 3, policyProposals: 1, promotionProposals: 0, openIncidents: 1,
    blockingIncidents: 1, unreadReports: 2, companionApprovals: 0, councilDecidable: 0, decisionTotal: 11, total: 11,
  };
  const calls = [
    { cmd: 'decision_lanes_snapshot', response: snapshot },
    { cmd: 'mandate_list', response: mandates },
    { cmd: 'mandate_get', response: mandates[0] },
    { cmd: 'charter_acts_list', response: acts },
    { cmd: 'dev_tools_pending_counts', response: pending },
    { cmd: 'dev_tools_get_autopilot_mode', response: 'full' },
    ...cardRows(ago),
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
      'monitor/mandate-lanes/ticker': tape('monitor/mandate-lanes/ticker'),
      'monitor/mandate-lanes/ticker/log': tape('monitor/mandate-lanes/ticker/log'),
    },
  };
}
