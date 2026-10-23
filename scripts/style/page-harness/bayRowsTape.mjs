#!/usr/bin/env node
// The bay-rows tape (spark mandate-lanes, WP11 phase C): the persona-card
// variants tape (`personaCardVariantsTape.mjs`, every persona state, the
// sessions in their bays, a queue of four) plus three sessions this device
// sent to Studio Desktop (`list_remote_sessions`), so every row kind a bay can
// draw is on one board: persona lines, session lines, a device's session
// lines (in an "On Studio Desktop" bay, and in the peer bay when the board is
// scoped to that device) and the peer's queue rungs.
//
//   running      Bake the lighting pass, mirrored 10 s ago
//   needs you    Review the shader diff, awaiting input
//   finished     Upscale the trailer frames, job completed
//
// No project on this tape has a git remote, so the three land in the
// device's own bay (`remote/remoteBoardModel` `byDevice`), as they would for a
// repository only Studio has.
//
//   node scripts/style/page-harness/bayRowsTape.mjs <out.json>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPersonaCardVariantsTape } from './personaCardVariantsTape.mjs';
import { RECORDED_AT } from './synthetic-tapes.mjs';

const T0 = Date.parse(RECORDED_AT);
const STUDIO = 'fixture-studio-7c1e9a04';

function remote(i, title, state, jobStatus, minutes) {
  return {
    jobId: `rj-${i}`, sessionId: `rs-${i}`, peerId: STUDIO, peerDisplayName: 'Studio Desktop',
    projectId: 'studio-render', projectLabel: 'render', githubUrl: '', title, state, stateReason: null,
    mode: 'headless', createdAtMs: T0 - minutes * 60_000, lastActivityMs: T0 - 20_000, mirrorAtMs: T0 - 10_000,
    jobStatus, receipt: null,
  };
}

export function buildBayRowsTape() {
  const base = buildPersonaCardVariantsTape();
  const remotes = [
    remote(1, 'Bake the lighting pass', 'running', 'running', 18),
    remote(2, 'Review the shader diff', 'awaiting_input', 'running', 42),
    remote(3, 'Upscale the trailer frames', 'finished', 'completed', 95),
  ];
  return {
    ...base,
    note: `${base.note} Plus three sessions sent to Studio Desktop (bayRowsTape.mjs): running, awaiting input, finished.`,
    calls: [...base.calls.filter((c) => c.cmd !== 'list_remote_sessions'), { cmd: 'list_remote_sessions', response: remotes }],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/bay-rows.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildBayRowsTape(), null, 2));
  console.log(`wrote ${out}`);
}
