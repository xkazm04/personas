// The onboarding report: one Markdown file per machine, per day, per peer, written from the
// persisted state only (so it can be re-rendered after a crash without touching the network).
// File: <meshDir>/onboard-<YYYY-MM-DD>-<peer8>.md

import fs from 'node:fs';
import path from 'node:path';
import { short8 } from './client.mjs';
import { meshDir } from './state.mjs';
import { TEST_IDS } from './tests.mjs';

const TITLES = {
  t1_ping: 'Ping probe (provoked capability)',
  t2_snapshot: 'Snapshot freshness',
  t3_toggle: 'Agent toggle round trip',
  t4_queue_move: 'Queue move',
  t5_fleet_push: 'Fleet commit + push + branch delete',
  t6_kill_wake: 'Session kill / wake',
  t7_cli_mail: 'CLI mail echo',
};

/** Local calendar date, YYYY-MM-DD. */
export function localDate(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function reportPath(state, dir = meshDir(), ms = Date.now()) {
  return path.join(dir, `onboard-${localDate(ms)}-${short8(state.peerId)}.md`);
}

const cell = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const verdictText = (v) => (v ? `${v.outcome}${v.stalledAt ? ` at \`${v.stalledAt}\`` : ''}` : 'not run');

export function renderReport(state, ms = Date.now()) {
  const run = state.run || (state.history && state.history[state.history.length - 1]) || null;
  const lines = [];
  lines.push(`# Mesh onboarding report - ${localDate(ms)}`);
  lines.push('');
  lines.push(`- This device: \`${state.selfPeerId || 'unknown'}\``);
  lines.push(`- Peer: **${cell(state.displayName || 'unnamed')}** \`${state.peerId}\``);
  lines.push(`- Role: ${state.role || 'unknown'} (the lower peerId initiates)`);
  lines.push(`- Paired: ${state.steps.paired ? new Date(state.steps.paired).toISOString() : 'no'}`);
  if (state.preflight) {
    const red = (state.preflight.failing || []).map((c) => c.id);
    const warn = (state.preflight.warnings || []).map((c) => c.id);
    lines.push(`- Preflight: ${red.length ? `red (${red.join(', ')})` : 'green'}${warn.length ? `; warnings: ${warn.join(', ')}` : ''}; app ${state.preflight.appVersion || 'unknown'}`);
  }
  lines.push('');
  if (!run) {
    lines.push('No test run recorded yet.');
    return `${lines.join('\n')}\n`;
  }
  lines.push(`## Mutual tests (run \`${run.runId || 'not agreed'}\`)`);
  lines.push('');
  if (run.aborted) {
    lines.push(`**Run aborted at \`${run.aborted.step}\`:** ${cell(run.aborted.detail)}`);
    lines.push('');
  }
  const ids = run.effective || run.requested || TEST_IDS;
  const tally = { passed: 0, failed: 0, skipped: 0 };
  lines.push('| Test | Result | This side | Peer side |');
  lines.push('|---|---|---|---|');
  for (const id of ids) {
    const r = run.tests[id] || {};
    const outcome = r.combined ? r.combined.outcome : 'not run';
    if (tally[outcome] !== undefined) tally[outcome] += 1;
    lines.push(`| ${id} ${TITLES[id] ? `- ${TITLES[id]}` : ''} | **${outcome}** | ${cell(verdictText(r.local))} | ${cell(verdictText(r.peer))} |`);
  }
  lines.push('');
  lines.push(`Totals: ${tally.passed} passed, ${tally.failed} failed, ${tally.skipped} skipped. A test passes only when BOTH sides passed it.`);
  lines.push('');
  lines.push('## Details');
  lines.push('');
  for (const id of ids) {
    const r = run.tests[id];
    if (!r) continue;
    lines.push(`### ${id}`);
    lines.push(`- This side: ${verdictText(r.local)} - ${cell(r.local && r.local.detail)}`);
    lines.push(`- Peer side: ${verdictText(r.peer)} - ${cell(r.peer && r.peer.detail)}`);
    if (r.probe && !r.probe.recorded) lines.push(`- Probe verdict NOT recorded in the app: ${cell(r.probe.error)}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function writeReport(state, dir = meshDir(), ms = Date.now()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = reportPath(state, dir, ms);
  fs.writeFileSync(file, renderReport(state, ms));
  return file;
}
