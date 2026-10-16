#!/usr/bin/env node
// The bay-polish tape (spark mandate-lanes, polish P1 "the bays"): the
// bay-rows tape (`bayRowsTape.mjs`: every persona state, sessions beside
// personas in their bays, a queue of four, a device's sessions) plus the two
// cases the owner named after the live look:
//
//   running + needs you   Pulse Reader (Research bay) runs AND holds 3 unread
//                         reports: the need glyph is amber, the rest of the
//                         line (edge, lamp, run glyph, sweep) is the run tone
//   App Master's CLIs     "App Master research" (Research bay) dispatched two
//                         CLI builders through the headless /appmaster skill,
//                         shaped exactly as the live FireTV rows are: the
//                         fleet door's label `fleet-door:app_master:cli-master:<slug>`,
//                         origin `app_master`, no persona id, and a cwd in the
//                         skill's own worktree root (never the project's repo
//                         path) - which is why they used to land in Ungrouped
//
//   node scripts/style/page-harness/bayPolishTape.mjs <out.json>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBayRowsTape } from './bayRowsTape.mjs';
import { RECORDED_AT } from './synthetic-tapes.mjs';

const T0 = Date.parse(RECORDED_AT);
const MASTER = 'p-board-master';
const WORKTREES = '/home/op/.personas/headless-masters/worktrees/research';

function masterSession(base, id, title, state, minutes) {
  return {
    ...base,
    id, claudeSessionId: `${id}-claude`, cwd: `${WORKTREES}/${id.slice(-8)}`, projectLabel: id.slice(-8),
    name: null, title, mode: 'headless', state, createdAtMs: T0 - minutes * 60_000,
    lastActivityMs: T0 - 30_000, lastPtyOutputMs: T0 - 30_000, lastGrewMs: T0 - 30_000,
    exitCode: null, stateReason: null, staleKind: null, queueRank: null, queuedAtMs: null, notBeforeMs: null,
    origin: 'app_master', personaId: null, runLabel: 'fleet-door:app_master:cli-master:research', runId: null,
    contestId: null, contestProjectId: null, remoteJobId: null, originPeerId: null,
  };
}

export function buildBayPolishTape() {
  const base = buildBayRowsTape();
  const swap = (calls, cmd, response) => [...calls.filter((c) => c.cmd !== cmd), { cmd, response }];
  const get = (cmd) => base.calls.find((c) => c.cmd === cmd).response;

  const personas = get('list_personas');
  const master = {
    ...personas.find((p) => p.id === 'p-board-15'),
    id: MASTER, name: 'App Master research', icon: 'agent-icon:compass', color: '#8b5cf6', home_team_id: 't-research',
  };
  let calls = swap(base.calls, 'list_personas', [...personas, master]);
  calls = swap(calls, 'get_unread_report_counts_by_persona', { ...get('get_unread_report_counts_by_persona'), 'p-board-15': 3 });

  const fleet = get('fleet_list_sessions');
  const one = fleet.sessions[0];
  calls = swap(calls, 'fleet_list_sessions', {
    ...fleet,
    sessions: [
      ...fleet.sessions,
      masterSession(one, 'am-cli-b3b1192c', 'Wire the ingest retries into the nightly job', 'running', 9),
      masterSession(one, 'am-cli-856ee620', 'Draft the source-quality rubric', 'running', 4),
    ],
  });
  return {
    ...base,
    note: `${base.note} Plus a running persona that needs you and an App Master's two CLI builders (bayPolishTape.mjs).`,
    calls,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/bay-polish.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildBayPolishTape(), null, 2));
  console.log(`wrote ${out}`);
}
