#!/usr/bin/env node
// The mandate drawer on the "one roof" fleet (spark mandate-lanes, design pass
// B): WP8's roof tape (`monitorRoofTape.mjs`, the real Classic fleet and its
// bays) plus every mandate read the drawer makes - the lanes snapshot, the
// mandates, the act log (`mandateLanesTapes.mjs`), the Scopes payload and the
// orphan clusters (`mandateWp6Tapes.mjs`) - with three more charters, so the
// register is read at a fleet's size, and the stewards as real personas (an
// App Master and Athena), so each row shows the face the app would.
//
// Not a registry module: one tape per drawer module, written to a directory.
//   node scripts/style/page-harness/mandateDrawerBTape.mjs tmp/style-tapes/mandate-drawer-b
//   node scripts/style/shoot.mjs --module monitor/mandate-lanes/register \
//     --tape tmp/style-tapes/mandate-drawer-b/monitor__mandate-lanes__register.json \
//     --reduced-motion --settle 2500 --out <dir> --label register
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMonitorRoofTape } from './monitorRoofTape.mjs';
import { buildSyntheticTape, RECORDED_AT } from './synthetic-tapes.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const T0 = Date.parse(RECORDED_AT);
const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

export const MODULES = [
  'monitor/mandate-lanes/register',
  'monitor/mandate-lanes/page',
  'monitor/mandate-wp6/scopes',
  'monitor/mandate-wp6/orphans',
];

// [charterId, projectId, projectName, title, steward, status, rung, version, budget, spend, acts, asks]
const EXTRA = [
  ['ch-billing', 'dp-billing', 'billing', 'Invoices reconcile nightly', 'App Master · billing', 'active', 2, 1, 60, 12.4, 9, 1],
  ['ch-infra', 'dp-infra', 'infra', 'Keep CI green', 'App Master · infra', 'active', 2, 1, 80, 71.9, 22, 0],
  ['ch-growth', 'dp-growth', 'growth', 'Weekly growth digest', 'App Master · growth', 'active', 1, 0, null, 2.1, 3, 0],
];

const STEWARDS = [
  { id: 'st-app-master', name: 'App Master', icon: 'agent-icon:code', color: '#06b6d4' },
  { id: 'st-athena', name: 'Athena', icon: 'agent-icon:research', color: '#a855f7' },
];

export function buildMandateDrawerTape(module) {
  const roof = buildMonitorRoofTape();
  const drawer = buildSyntheticTape('monitor/mandate-wp6/scopes', REPO);
  const own = new Set(drawer.calls.map((c) => c.cmd));
  const calls = [...roof.calls.filter((c) => !own.has(c.cmd)), ...drawer.calls].map((c) => {
    if (c.cmd === 'list_personas') {
      const like = c.response[0];
      return { ...c, response: [...c.response, ...STEWARDS.map((s) => ({ ...like, ...s, home_team_id: null }))] };
    }
    if (c.cmd !== 'mandate_list') return c;
    const extra = EXTRA.map(([charterId, projectId, projectName, title, steward, status, rung, version, budget, spend, acts, asks]) => ({
      ...c.response[0], charterId, projectId, projectName, title, stewardName: steward, status, scopeRung: rung, updatedAt: ago(120),
      envelope: { decideScopes: version ? ['report.read'] : [], mergePolicy: 'never', budgetMonthlyUsd: budget, envelopeVersion: version, keptAtActs: null },
      load: { spendUsedUsd: spend, budgetUsd: budget, actsCount: acts, openAsks: asks },
    }));
    const response = [...c.response, ...extra].map((s) => ({
      ...s, stewardPersonaId: s.stewardName === 'Athena' ? 'st-athena' : 'st-app-master',
    }));
    return { ...c, response };
  });
  return {
    ...drawer,
    module,
    note: `${roof.note} Plus the mandate drawer's reads (mandateLanesTapes.mjs, mandateWp6Tapes.mjs), seven charters, and an App Master and Athena as the stewards (mandateDrawerBTape.mjs).`,
    calls,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/mandate-drawer-b');
  mkdirSync(out, { recursive: true });
  for (const module of MODULES) {
    const file = join(out, `${module.replaceAll('/', '__')}.json`);
    writeFileSync(file, JSON.stringify(buildMandateDrawerTape(module), null, 2));
    console.log(`wrote ${file}`);
  }
}
