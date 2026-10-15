#!/usr/bin/env node
// The mandate lanes on the "one roof" fleet (spark mandate-lanes, design pass A):
// WP8's roof tape (`monitorRoofTape.mjs`: the real Classic fleet, its bays, the
// usage and schedule plates) plus the mandate reads of `mandateLanesTapes.mjs`,
// with seven charters so the Stewards plate has to cap its list. One tape for
// BOTH decision surfaces, so a crop of the Chips state and of the Lanes state
// differ only by what the setting changes:
//   node scripts/style/page-harness/mandateRoofTape.mjs tmp/style-tapes/mandate-roof.json
//   node scripts/style/shoot.mjs --module monitor/classic --tape tmp/style-tapes/mandate-roof.json \
//     --reduced-motion --settle 3000 --out <dir> --label chips
//   node scripts/style/shoot.mjs --module monitor/mandate-lanes/ticker --tape tmp/style-tapes/mandate-roof.json \
//     --reduced-motion --settle 5000 --out <dir> --label lanes
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMonitorRoofTape } from './monitorRoofTape.mjs';
import { mandateLanesTapes } from './mandateLanesTapes.mjs';
import { RECORDED_AT } from './synthetic-tapes.mjs';

const T0 = Date.parse(RECORDED_AT);
const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

// Three more charters on projects with no bay, so the plate shows its cap.
const EXTRA = [
  ['ch-billing', 'dp-billing', 'billing', 'Invoices reconcile nightly', 'App Master · billing', 'active', 2, 1, 60, 12.4, 9, 1],
  ['ch-infra', 'dp-infra', 'infra', 'Keep CI green', 'App Master · infra', 'active', 2, 1, 80, 71.9, 22, 0],
  ['ch-growth', 'dp-growth', 'growth', 'Weekly growth digest', 'App Master · growth', 'active', 1, 0, null, 2.1, 3, 0],
];

export function buildMandateRoofTape() {
  const roof = buildMonitorRoofTape();
  const lanes = mandateLanesTapes({ RECORDED_AT }).builders['monitor/mandate-lanes']();
  const MANDATE_CMDS = ['decision_lanes_snapshot', 'mandate_list', 'mandate_get', 'charter_acts_list', 'dev_tools_pending_counts', 'dev_tools_get_autopilot_mode'];
  const mandateCalls = lanes.calls.filter((c) => MANDATE_CMDS.includes(c.cmd));
  const list = mandateCalls.find((c) => c.cmd === 'mandate_list');
  const snap = mandateCalls.find((c) => c.cmd === 'decision_lanes_snapshot');
  for (const [charterId, projectId, projectName, title, steward, status, rung, version, budget, spend, acts, asks] of EXTRA) {
    list.response = [...list.response, {
      charterId, title, projectId, projectName, stewardPersonaId: `st-${charterId}`, stewardName: steward, status,
      scopeRung: rung, source: 'app_master', updatedAt: ago(120),
      envelope: { decideScopes: [], mergePolicy: 'never', budgetMonthlyUsd: budget, envelopeVersion: version, keptAtActs: null },
      load: { spendUsedUsd: spend, budgetUsd: budget, actsCount: acts, openAsks: asks },
    }];
    snap.response = { ...snap.response, charters: [...snap.response.charters, { charterId, projectId, status, envelopeVersion: version, held: 0 }] };
  }
  // One calm bay: research's draft is signed from the Sign lane, but its card is
  // not tied to the bay's project, so the research bay shows a calm (dark) mandate.
  snap.response = {
    ...snap.response,
    items: snap.response.items.map((x) => (x.itemId === 'mandate:ch-research' ? { ...x, projectId: null } : x)),
  };
  return {
    ...roof,
    note: `${roof.note} Plus the mandate lanes (mandateLanesTapes.mjs) with seven charters (mandateRoofTape.mjs).`,
    calls: [...roof.calls.filter((c) => !MANDATE_CMDS.includes(c.cmd)), ...mandateCalls],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/mandate-roof.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildMandateRoofTape(), null, 2));
  console.log(`wrote ${out}`);
}
