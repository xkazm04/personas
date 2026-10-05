#!/usr/bin/env node
// /appmaster - the headless App Master CLI. Subcommands print ONE JSON document on stdout.
// Exit 0 ok, 2 refused by a brake or a gate ({refused: "<reason>", ...}), 1 error (stderr).
//
//   status   [--project p] [--text]
//   context  --project p
//   decide   --project p --wake <wakeId> --file <decision.json>
//   dispatch --run <runId>
//   watch    [--project p]
//   settle   --run <runId> [--retry]
//   release  --run <runId> --reason <text> [--kill]
//   say      --project p --file <msg.md> | --text <message>
//   asks     [--project p]
//   answer   --ask <askId> --choice <label> --notes <text>
//   outbox   list|replay [--dry-run] [--project p]
//   limit    set|clear|show [--reason <text>] [--resets <iso>]
//   onboard  --project p --brief <brief.json> [--force]
//
// The table below is the ONLY place a subcommand is bound to its implementation. Each handler
// is `async (args) => object` where args = { _: positionals after the subcommand, flags }.
// Imports are lazy so a stub in one package never breaks another package's command.

import { EXIT, Refusal } from './lib/contract.mjs';

export const COMMANDS = {
  status:   ['./lib/digest.mjs', 'cmdStatus'],      // WP1
  context:  ['./lib/context.mjs', 'cmdContext'],    // WP1
  decide:   ['./lib/decision.mjs', 'cmdDecide'],    // WP1
  dispatch: ['./lib/worker.mjs', 'cmdDispatch'],    // WP2
  watch:    ['./lib/worker.mjs', 'cmdWatch'],       // WP2
  settle:   ['./lib/merge.mjs', 'cmdSettle'],       // WP2
  release:  ['./lib/worker.mjs', 'cmdRelease'],     // WP2
  say:      ['./lib/asks.mjs', 'cmdSay'],           // WP1
  asks:     ['./lib/asks.mjs', 'cmdAsks'],          // WP1
  answer:   ['./lib/asks.mjs', 'cmdAnswer'],        // WP1
  outbox:   ['./lib/outbox.mjs', 'cmdOutbox'],      // WP1
  limit:    ['./lib/limits.mjs', 'cmdLimit'],       // WP2
  onboard:  ['./lib/onboard.mjs', 'cmdOnboard'],    // WP1
};

export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out.flags[a.slice(2)] = true;
      else { out.flags[a.slice(2)] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export async function run(argv) {
  const [sub, ...rest] = argv;
  if (!sub || !COMMANDS[sub]) {
    console.error(`usage: appmaster.mjs <${Object.keys(COMMANDS).join('|')}> [flags]`);
    return EXIT.ERROR;
  }
  const [file, fn] = COMMANDS[sub];
  try {
    const mod = await import(file);
    const result = await mod[fn](parseArgs(rest));
    if (result && typeof result === 'object' && 'text' in result && result.__text) console.log(result.text);
    else console.log(JSON.stringify(result ?? { ok: true }, null, 2));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof Refusal) { console.log(JSON.stringify({ refused: e.reason, ...e.extra }, null, 2)); return EXIT.REFUSED; }
    console.error(`[appmaster ${sub}] ${e.message || e}`);
    return EXIT.ERROR;
  }
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await run(process.argv.slice(2));
}
