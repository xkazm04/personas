#!/usr/bin/env node
// PreToolUse guard: refuse to start a second concurrent cargo build/test.
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
// DESIGN: stateless. It inspects live processes rather than maintaining a
// lockfile, because a lockfile needs a release path and a crashed run would
// leave a stale lock that blocks everything (this repo already has a documented
// habit of guards that outlive their subject).
//
// FAIL-OPEN, LOUDLY. If process enumeration fails we allow the command and say
// so on stderr. That is a deliberate exception to this repo's "a gate that
// no-ops is worse than no gate" rule: the cost of a false block is a developer
// who cannot compile at all, while the cost of a false allow is the CPU spike
// this guard merely mitigates. The warning makes the degraded state visible
// instead of silent — which is the part that actually matters.
//
// Override for a deliberate parallel run: set CARGO_GUARD=off.
import { execFileSync } from 'node:child_process';

const RE_HEAVY = /\bcargo\s+(?:\+\S+\s+)?(test|build|check|clippy|bench)\b/;
/** Ignore a process younger than this: cargo often re-execs itself. */
const MIN_AGE_MS = 5_000;

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
if (process.env.CARGO_GUARD === 'off') process.exit(0);
// npm scripts that wrap cargo are the sanctioned entry points; still guarded,
// but a guard that blocked `npm run tauri:dev` would be intolerable.
if (/\btauri\s+(dev|build)\b|\btauri:dev\b/.test(command)) process.exit(0);

let running = [];
try {
  // Get-CimInstance, not Get-Process. Naming an absent process makes
  // Get-Process error (and -ErrorAction SilentlyContinue still exits non-zero),
  // which silently dropped this guard into its own degraded path the first time
  // it ran — rustc happened not to be running. .StartTime also throws
  // AccessDenied on processes we do not own. CIM has neither problem.
  //
  // Only `cargo` is matched, deliberately. rustc spawns constantly during any
  // build, so matching it would block nearly every command mid-compile.
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='SilentlyContinue'; " +
      "$p = Get-CimInstance Win32_Process -Filter \"Name='cargo.exe'\" | " +
      "Select-Object ProcessId,Name,CreationDate; " +
      "if ($null -eq $p) { '[]' } else { ,@($p) | ConvertTo-Json -Compress -Depth 3 }; " +
      "exit 0",
    ],
    { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const parsed = JSON.parse((out || '[]').trim() || '[]');
  running = (Array.isArray(parsed) ? parsed : [parsed])
    .filter(Boolean)
    .map((p) => ({ Id: p.ProcessId, ProcessName: p.Name, StartTime: p.CreationDate }));
} catch (err) {
  console.error(
    `[cargo-guard] DEGRADED: could not enumerate processes (${err?.message ?? err}). ` +
      `Allowing the command unchecked — a concurrent cargo run will NOT be caught.`,
  );
  process.exit(0);
}

const now = Date.now();
const heavy = running.filter((p) => {
  if (!p?.Id) return false;
  // PowerShell serialises StartTime as /Date(ms)/ or an ISO string.
  const raw = typeof p.StartTime === 'string' ? p.StartTime : p.StartTime?.value;
  const started = raw ? Date.parse(String(raw).replace(/^\/Date\((\d+)\)\/$/, (_, ms) => new Date(+ms).toISOString())) : NaN;
  return Number.isNaN(started) ? true : now - started > MIN_AGE_MS;
});

if (heavy.length === 0) process.exit(0);

const list = heavy
  .map((p) => `  PID ${p.Id} ${p.ProcessName}${p.StartTime ? ` (since ${p.StartTime})` : ''}`)
  .join('\n');

console.error(
  `[cargo-guard] BLOCKED — a cargo build/test is already running:\n${list}\n\n` +
    `Two concurrent cargo runs on this repo saturate every core: the personas-db\n` +
    `suite alone rebuilds the full migration chain 576 times (see\n` +
    `docs/concepts/golden-paths/boot-migration-step.md).\n\n` +
    `Options:\n` +
    `  - wait for it to finish, then retry\n` +
    `  - narrow your run:  cargo test -p <crate> <filter>\n` +
    `  - stop the other:   Stop-Process -Id ${heavy[0].Id}\n` +
    `  - override once:    CARGO_GUARD=off <your command>`,
);
process.exit(2); // exit 2 = block the tool call and show stderr to the agent
