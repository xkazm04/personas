// Synthetic tape for the Activity band's Decision Center strip
// (monitorRailSurfaces.tsx). Fixture CODE, no personal data. It reuses the
// Board's simulation tape (monitorBoardTapes.mjs) rather than inventing a
// second fleet, and adds the decision sources the strip and the Gates peek
// read: the one pending-counts round-trip and Athena's pending approvals
// (the Gates chip's own rows). Everything else the roster reads answers empty.
//
//   monitor/rail        the Board's simulation shell, the strip's Gates chip
//                       pressed so its peek is open with three rows.
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
  const decisionCalls = [
    { cmd: 'dev_tools_pending_counts', response: counts },
    { cmd: 'companion_list_pending_approvals', response: approvals },
  ];

  return {
    builders: {
      'monitor/rail': () => {
        const tape = board['monitor/board/sim']();
        return {
          ...tape,
          module: 'monitor/rail',
          note: 'Synthetic: the test build simulation fleet, plus decision counts and three companion approvals for the Gates peek.',
          calls: [...tape.calls, ...decisionCalls],
        };
      },
    },
  };
}
