// Synthetic tape for the Breach card's head lines and mandate states
// (breachStatesSurfaces.tsx, spark mandate-lanes WP5P). Fixture CODE, no
// personal data.
//
// The WP5 card tape (mandateCardsTapes.mjs) with its own lanes snapshot and
// mandates, so one Breach item sits on each mandate state the card must tell
// apart:
//   idea:idea-1     scope breach on a SIGNED active mandate (Personas, v2)
//   idea:idea-2     an idea on an UNSIGNED active mandate (Ascent, v0)
//   incident:inc-1  a stop on the signed mandate (the item decides itself)
//   incident:inc-2  a risk with NO charter on a known project (Kiro Garden)
// and the project list, so the no-mandate card names its project.

import { mandateCardsTapes } from './mandateCardsTapes.mjs';

const ROUTES = [
  // [itemId, lane, clause, charterId, projectId]
  ['idea:idea-1', 'breach', 'scope', 'ch-personas', 'proj-harness'],
  ['idea:idea-2', 'breach', 'unsigned', 'ch-ascent', 'proj-ascent'],
  ['incident:inc-1', 'breach', 'stop', 'ch-personas', 'proj-harness'],
  ['incident:inc-2', 'breach', 'risk', null, 'proj-garden'],
];

export function breachStatesTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const cards = mandateCardsTapes({ RECORDED_AT, PERSONAS }).builders['decision-center/mandate-cards']();

  const mandate = (charterId, projectId, projectName, title, version, scopes) => ({
    charterId, title, projectId, projectName, stewardPersonaId: `st-${charterId}`, stewardName: `App Master · ${projectName}`,
    status: 'active', scopeRung: 3, source: 'app_master', updatedAt: ago(90),
    envelope: { decideScopes: scopes, mergePolicy: 'never', budgetMonthlyUsd: 120, envelopeVersion: version, keptAtActs: null },
    load: { spendUsedUsd: 47.5, budgetUsd: 120, actsCount: version > 0 ? 38 : 0, openAsks: 1 },
  });
  const mandates = [
    mandate('ch-personas', 'proj-harness', 'Personas', 'Keep the desktop app shippable', 2, ['report.read', 'review.info']),
    mandate('ch-ascent', 'proj-ascent', 'Ascent', 'Ship the onboarding rework', 0, []),
  ];
  const snapshot = {
    items: ROUTES.map(([itemId, lane, clause, charterId, projectId]) => ({
      itemId, itemKind: itemId.split(':')[0], lane, clause, charterId, projectId,
      coalesceKey: charterId ? `${charterId}:${lane}:${clause}` : itemId, irreversible: null,
    })),
    charters: [
      { charterId: 'ch-personas', projectId: 'proj-harness', status: 'active', envelopeVersion: 2, held: 0 },
      { charterId: 'ch-ascent', projectId: 'proj-ascent', status: 'active', envelopeVersion: 0, held: 0 },
    ],
    failedSources: [],
    generatedAt: RECORDED_AT,
  };
  const project = (id, name) => ({ id, name, root_path: `C:/work/${name}`, status: 'active', created_at: ago(9000), updated_at: ago(90) });
  const projects = [project('proj-harness', 'Personas'), project('proj-ascent', 'Ascent'), project('proj-garden', 'Kiro Garden')];

  const calls = [
    { cmd: 'decision_lanes_snapshot', response: snapshot },
    { cmd: 'mandate_list', response: mandates },
    { cmd: 'dev_tools_list_projects', response: projects },
  ];
  return {
    builders: {
      'decision-center/breach-states': () => ({
        ...cards,
        module: 'decision-center/breach-states',
        note: `${cards.note} Breach states: a scope breach on a signed mandate, an idea on an unsigned mandate, a stop, and a risk with no mandate on a known project.`,
        calls: [...cards.calls.filter((c) => !calls.some((x) => x.cmd === c.cmd)), ...calls],
      }),
    },
  };
}
