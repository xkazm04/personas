// Synthetic tape for the Activity band's Decision Center strip
// (monitorRailSurfaces.tsx). Fixture CODE, no personal data. It reuses the
// Board's simulation tape (monitorBoardTapes.mjs) rather than inventing a
// second fleet, and adds the decision sources the strip and the Gates peek
// read: the one pending-counts round-trip, Athena's pending approvals and the
// lanes snapshot that routes them to Breach. Everything else answers empty.
//
//   monitor/rail        the Board's simulation shell, the strip's Breach lane
//                       pressed so its peek is open on three rows (the Gates
//                       chip until the mandate-lanes cutover, WP10).
//
// `monitor/rail/kinds` (the retired DecisionDock's row, alone) went with the
// dock on 2026-10-06 (decision-center spark A3).

import { monitorBoardTapes } from './monitorBoardTapes.mjs';

export function monitorRailTapes({ RECORDED_AT }) {
  const board = monitorBoardTapes({ RECORDED_AT }).builders;
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

  const counts = {
    goalAcceptance: 1, manualReviews: 0, ideas: 7, policyProposals: 1, promotionProposals: 1,
    openIncidents: 3, blockingIncidents: 1, unreadReports: 4, companionApprovals: 3,
    councilDecidable: 1, decisionTotal: 0, total: 0,
  };
  const approval = (id, action, rationale, minutes) => ({
    id, action, rationale, paramsJson: '{}', humanReviewId: null, createdAt: ago(minutes),
  });
  const approvals = [
    approval('ap-1', 'write_fact', 'You said the staging deploys move to Thursdays.', 12),
    approval('ap-2', 'create_goal', 'The retry budget keeps coming up in three teams.', 47),
    approval('ap-3', 'dispatch_persona', 'The Docs team asked for a release note draft.', 180),
  ];
  // The lanes snapshot the Breach button counts and its peek joins rows to:
  // Athena's approvals are never delegated, so all three are Breach crossings
  // (`UNSIGNED_LANE` in mandate_router.rs), with the same ids the roster gives
  // their rows (`approval:<id>`). Without it the press opened an empty peek.
  const snapshot = {
    items: approvals.map((a) => ({
      itemId: `approval:${a.id}`, itemKind: 'approval', lane: 'breach', clause: 'unsigned', charterId: null,
      coalesceKey: `orphan:breach:unsigned`, irreversible: null, projectId: null,
    })),
    charters: [],
    failedSources: [],
    generatedAt: RECORDED_AT,
  };
  const decisionCalls = [
    { cmd: 'dev_tools_pending_counts', response: counts },
    { cmd: 'companion_list_pending_approvals', response: approvals },
    { cmd: 'decision_lanes_snapshot', response: snapshot },
  ];

  return {
    builders: {
      'monitor/rail': () => {
        const tape = board['monitor/board/sim']();
        return {
          ...tape,
          module: 'monitor/rail',
          note: 'Synthetic: the test build simulation fleet, plus decision counts, three companion approvals and the lanes snapshot that puts them in the Breach peek.',
          calls: [...tape.calls, ...decisionCalls],
        };
      },
    },
  };
}
