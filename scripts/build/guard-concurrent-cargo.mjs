#!/usr/bin/env node
// PreToolUse hook: make a second concurrent cargo build/test WAIT for the first.
//
// WHY THIS EXISTS (2026-08-13). Two agents ran `cargo test -p personas-db`
// against the same crate at the same time. One test binary alone burned 1,380
// CPU-seconds and the machine became unusable. The cost is structural: 576
// fixture call sites each run the FULL migration chain (initial schema + 124
// run_steps + 378 ddl_step calls + 3 seeds) into a temp FILE, and cargo's
// default --test-threads is the core count, so N chains execute concurrently.
// Two such runs saturate every core.
//
// The failure was not a missing convention — it was that nothing stood between
// the intent and the command. This is that thing. It intercepts the Bash tool
// call itself, so it fires no matter which script or agent issues it.
//
// IT USED TO REFUSE, AND NOW IT QUEUES (2026-10-07). Exit 2 blocked the tool
// call outright, which meant a parallel agent session did not merely slow down
// on a race — it FAILED ITS GATE, and the operator had to re-run the whole
// thing. Waiting costs wall time; refusing costs a run. So the holder is now
// polled every 2 s, with one line every 15 s naming it, and the command is
// admitted the moment the slot frees. The wait has NO TIMEOUT: a timeout that
// then admitted the command would reintroduce exactly the overlap this exists
// to prevent, and one that refused would be the old failure with extra steps.
//
// THE UNBOUNDED WAIT IS ONLY AS LONG AS THE HOOK'S REGISTERED TIMEOUT.
// .claude/settings.json registers this hook with "timeout": 20, and the harness
// kills a hook that outlives it — so as registered today the queue here is
// really "wait up to 20 s, then the Bash call proceeds anyway", which is the
// timeout-then-admit shape the operator rejected. Raising that timeout is a
// settings change, not a change to this file; until it is raised, the only
// queue with no ceiling is the one in cargo-run.mjs, which runs inside the
// build process and nothing kills. Measured 2026-10-07 (settings.json:20).
//
// DESIGN: stateless, and the queue depends on that. It inspects live processes
// rather than maintaining a lockfile, because a lockfile needs a release path
// and a crashed run would leave a stale lock that blocks everything (this repo
// already has a documented habit of guards that outlive their subject). With no
// lock there is nothing to go stale: a cargo that dies — cleanly, by Ctrl-C or
// by panic — frees the queue by ceasing to exist. An unbounded wait is only
// safe because of that property; do not add a lockfile.
//
// The poll, the process enumeration and the 15 s announcement all live in
// scripts/build/cargo-run.mjs, which every cargo this repo *launches* goes
// through. Same queue, one implementation: this hook covers the cargo commands
// nothing in the repo launched (an agent typing `cargo test` into Bash), and
// cargo-run covers the ones it did. The old PowerShell/Get-CimInstance
// enumeration here was replaced by that module's per-image `tasklist` — same
// answer, and no powershell.exe startup on a 2 s poll loop. Its MIN_AGE_MS
// "ignore a process younger than 5 s" rule went with it: it existed so a cargo
// that was about to re-exec itself could not cause a false BLOCK, and a false
// wait of two seconds is not a failure worth a start-time lookup.
//
// rustc now counts as a holder too, which the refusing version deliberately
// avoided ("rustc spawns constantly during any build, so matching it would
// block nearly every command mid-compile"). That reasoning was about BLOCKING.
// A command that waits for the rustc in front of it is behaving correctly —
// that overlap is the thing being prevented.
//
// FAIL-OPEN, LOUDLY. If the payload is unreadable or process enumeration fails
// we allow the command and say so on stderr. That is a deliberate exception to
// this repo's "a gate that no-ops is worse than no gate" rule: the cost of a
// false block is a developer who cannot compile at all, while the cost of a
// false allow is the CPU spike this guard merely mitigates. The warning makes
// the degraded state visible instead of silent — which is the part that
// actually matters.
//
// Override for a deliberate parallel run: CARGO_GUARD=off (or CARGO_FULL_SEND=1,
// which also turns off the throttle in cargo-run.mjs).
import { envFlag, waitForCargoSlot } from './cargo-run.mjs';

const RE_HEAVY = /\bcargo\s+(?:\+\S+\s+)?(test|build|check|clippy|bench)\b/;

let payload = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) payload += chunk;

// An empty payload is NOT "this isn't a cargo command" — it means the guard
// never saw the command at all, and silently allowing on that basis is the
// blind-gate pattern this repo keeps finding. Say so out loud. (Caught by this
// script's own self-test: piping from PowerShell delivered nothing, and the
// first version exited 0 without a word.)
if (!payload.trim()) {
  console.error(
    '[cargo-guard] DEGRADED: no hook payload on stdin — the command was not inspected. ' +
      'If you are testing this script by hand, pipe a JSON payload into it.',
  );
  process.exit(0);
}

let command = '';
try {
  const input = JSON.parse(payload);
  command = input?.tool_input?.command ?? '';
} catch (err) {
  console.error(`[cargo-guard] DEGRADED: unparseable hook payload (${err?.message ?? err}).`);
  process.exit(0);
}

if (!command || !RE_HEAVY.test(command)) process.exit(0);
// An empty value is absent, so `CARGO_GUARD=` does not disable anything.
if (envFlag('CARGO_GUARD') && /^(off|0|false|no)$/i.test(process.env.CARGO_GUARD.trim())) process.exit(0);
if (envFlag('CARGO_FULL_SEND')) process.exit(0);
// npm scripts that wrap cargo are the sanctioned entry points, and they go
// through cargo-run.mjs, which runs this same queue with a status line and a
// job cap. Waiting here as well would only move the wait earlier and print it
// twice.
if (/\btauri\s+(dev|build)\b|\btauri:dev\b/.test(command)) process.exit(0);

// Never exit 2 from here again. "degraded" (the process table could not be
// read) and "free" both admit the command; "aborted" is the operator pressing
// Ctrl-C through the hook, which is not a block either — 130 is a non-blocking
// error that shows the reason and lets the tool call proceed.
const { state } = waitForCargoSlot({ label: 'cargo-guard' });
process.exit(state === 'aborted' ? 130 : 0);
