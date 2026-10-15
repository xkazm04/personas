// Synthetic tapes for the mandate-lanes WP6 surfaces (mandateWp6Surfaces.tsx).
// Fixture CODE, no personal data.
//
//   decision-center/mandate-wp6   the live deck (the WP5 card tape) plus a
//                                 signed mandate whose use asks a re-read
//                                 (`mandate-reread:ch-personas` in Sign) and
//                                 the claim's met-when (`goal_met_when`)
//   monitor/mandate-wp6/*         the real Monitor (the WP4 lanes tape) plus
//                                 the mandate page's Scopes payload and the
//                                 orphanage's clusters

import { mandateCardsTapes } from './mandateCardsTapes.mjs';
import { mandateLanesTapes } from './mandateLanesTapes.mjs';

const REREAD = {
  code: 'dominant', asks: 7, acts: 38, spendPct: 40, mergesSinceRead: 0,
  leadScope: 'idea.accept', leadAbsorbs: 5, keptAtActs: 14,
  suggest: { action: 'widen', scope: 'idea.accept' },
};

const ITEM = (id, kind, title) => ({ itemId: `${kind}:${id}`, itemKind: kind, title });

function scopes() {
  return {
    charterId: 'ch-personas', signed: true, asks: 6,
    rows: [
      { scope: 'idea.accept', held: false, acts: 0, absorbs: 3, absorbed: [ITEM('d1', 'idea', 'Cache the lanes snapshot per tick'), ITEM('d2', 'idea', 'Fold the act ticker into the dock'), ITEM('d3', 'idea', 'Name the stewards in the badge')], arms: false },
      { scope: 'idea.reject', held: true, acts: 4, absorbs: 0, absorbed: [], arms: false },
      { scope: 'question.answer', held: false, acts: 0, absorbs: 1, absorbed: [ITEM('q1', 'question', 'Which port does the dev server use?')], arms: false },
      { scope: 'review.info', held: true, acts: 9, absorbs: 0, absorbed: [], arms: false },
      { scope: 'incident.triage', held: false, acts: 2, absorbs: 1, absorbed: [ITEM('i3', 'incident', 'Flaky e2e on Windows')], arms: false },
      { scope: 'report.read', held: true, acts: 23, absorbs: 0, absorbed: [], arms: false },
      { scope: 'council.attach', held: false, acts: 0, absorbs: 0, absorbed: [], arms: false },
      { scope: 'dispatch', held: false, acts: 0, absorbs: 2, absorbed: [ITEM('r1', 'dispatch', 'Run the lane-peek fix on the desktop build'), ITEM('r2', 'dispatch', 'Run the updater retry patch')], arms: true },
    ],
    // A council-ready merge still reaches Accept, so the router absorbs none of them.
    merge: { policy: 'never', widenTo: 'gate-green+council-ready', narrowTo: null, absorbs: 0, absorbed: [] },
    spend: { capUsd: 120, usedUsd: 47.5, widenToUsd: 150, narrowToUsd: 115, absorbs: 0, absorbed: [] },
    failedSources: [],
  };
}

function orphans(ago) {
  const cluster = (projectId, projectName, items, recent, kinds, why, steward, archived, oldestDays) => ({
    projectId, projectName, items, recent, kinds, itemIds: [], oldestAt: ago(oldestDays * 1440), newestAt: ago(30),
    why, steward, archived,
  });
  return {
    perCard: 3.4,
    unassigned: 2,
    failedSources: [],
    clusters: [
      cluster('dp-adamant', 'Adamant', 33, 12, [{ kind: 'idea', count: 31 }, { kind: 'review', count: 2 }], 'large', null, 0, 17),
      cluster('dp-scratch', 'scratch', 4, 3, [{ kind: 'idea', count: 4 }], 'growing',
        { personaId: 'am-scratch', name: 'App Master scratch', source: 'app-master' }, 6, 3),
      cluster('dp-notes', 'notes', 2, 0, [{ kind: 'idea', count: 2 }], null, null, 0, 13),
    ],
  };
}

export function mandateWp6Tapes({ RECORDED_AT, PERSONAS }) {
  const cards = mandateCardsTapes({ RECORDED_AT, PERSONAS }).builders['decision-center/mandate-cards']();
  const snap = cards.calls.find((c) => c.cmd === 'decision_lanes_snapshot').response;
  const mandates = cards.calls.find((c) => c.cmd === 'mandate_list').response.map((s) => ({
    ...s,
    reread: s.charterId === 'ch-personas' ? REREAD : null,
    origin: null,
    envelope: s.charterId === 'ch-personas' ? { ...s.envelope, keptAtActs: 14 } : s.envelope,
  }));
  const deckCalls = [
    {
      cmd: 'decision_lanes_snapshot',
      response: {
        ...snap,
        items: [...snap.items, {
          itemId: 'mandate-reread:ch-personas', itemKind: 'mandate', lane: 'sign', clause: 'none',
          charterId: 'ch-personas', coalesceKey: 'ch-personas:sign:reread', irreversible: null, projectId: 'proj-harness',
        }],
      },
    },
    { cmd: 'mandate_list', response: mandates },
    {
      cmd: 'goal_met_when',
      response: { goalId: 'goal-1', charterId: null, unreadable: false, metWhen: { uat: 'A first run finishes on a fresh install', kpiId: 'kpi-act', council: 'lite' } },
    },
  ];

  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const lanes = mandateLanesTapes({ RECORDED_AT }).builders['monitor/mandate-lanes']();
  const laneMandates = lanes.calls.find((c) => c.cmd === 'mandate_list').response.map((s) => ({ ...s, reread: null, origin: null }));
  const monitorCalls = [
    { cmd: 'mandate_list', response: laneMandates },
    { cmd: 'mandate_get', response: laneMandates[0] },
    { cmd: 'mandate_scopes', response: scopes() },
    { cmd: 'orphan_clusters', response: orphans(ago) },
  ];
  const monitor = (module) => () => ({
    ...lanes,
    module,
    note: `${lanes.note} Plus WP6: the personas mandate's Scopes payload and three orphan clusters (large, growing, quiet).`,
    calls: [...lanes.calls.filter((c) => !monitorCalls.some((x) => x.cmd === c.cmd)), ...monitorCalls],
  });

  return {
    builders: {
      'decision-center/mandate-wp6': () => ({
        ...cards,
        module: 'decision-center/mandate-wp6',
        note: `${cards.note} Plus WP6: a re-read of the signed personas mandate in Sign, and the claim's met-when.`,
        calls: [...cards.calls.filter((c) => !deckCalls.some((x) => x.cmd === c.cmd)), ...deckCalls],
      }),
      'monitor/mandate-wp6/scopes': monitor('monitor/mandate-wp6/scopes'),
      'monitor/mandate-wp6/orphans': monitor('monitor/mandate-wp6/orphans'),
    },
  };
}
