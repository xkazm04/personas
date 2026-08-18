---
layer: application
subject: subprocess-lifecycle
technique: concurrency-and-slots
stack: rust
---

# Concurrency and slots across the Personas host

This app is the technique's charter case: one desktop host running many
`claude` children at once — persona executions, fleet terminal sessions,
companion calls, dev servers — plus *sibling host instances* (parallel CLI
agent sessions) spawning onto the same machine. Three layers of the standard
are implemented in three different places, each shaped by what its children
cost to lose.

## Layer 1 — admission-side caps: the execution queue

`ConcurrencyTracker` (`src-tauri/engine/src/queue.rs:73-100`) is the bounded
scheduler for persona executions, with the technique's full layered-cap
stack:

- **Global cap** — `global_max_concurrent` (`:83`), checked by
  `has_global_capacity` (`:156-158`); "an execution needs both per-persona
  AND global capacity to run" (`:81`).
- **Per-tenant cap** — per-persona `max_concurrent`, snapshotted at enqueue
  time (`persona_max_concurrent`, `:45-47`) so drain decisions need no DB
  lookup; `has_capacity` (`:214-219`).
- **Bounded queue with backpressure** — `AdmitResult` (`:56-63`) is a closed
  three-way outcome: `Running`, `Queued { position }`, or
  `QueueFull { max_depth }` — refusal is visible, exactly the
  backlog-is-also-a-resource rule.
- **Composed admission gates** — admission also consults a quota cooldown
  (`quota_cooldown_until`, `:84-92`, armed reactively when a run fails
  against a provider rate limit, never shortened by a later failure,
  `:170-179`) and a resource-pressure gate (`resource_throttled`, `:93-99`)
  set by the governor below.

`resource_governor.rs` (`src-tauri/src/engine/resource_governor.rs`) drives
the pressure gate with hysteresis and *asymmetric* watermarks — CPU pauses
at 70% / resumes below 55%, memory at 85% / 70% — with the rationale in the
module doc (`:13-16`): high RAM occupancy is often healthy cache warmth
while the OOM kill lives near 95%, so memory's bar is higher than CPU's. It
skips the first, invalid sample (`:46-49`) and logs every gate transition
(`:57-71`). "Running executions are NEVER interrupted — only NEW admissions
defer" (`:10-11`).

## Layer 2 — eviction-side cap: the fleet live-slot scheduler

Fleet sessions invert the posture, and the code states why. The cap
(`MAX_LIVE_SESSIONS`, `src-tauri/src/commands/fleet/stale.rs:141-162`) turns
the fleet into "N tracked conversations, ≤max live processes" — overflow
Idle/Stale sessions are *hibernated* (transcripts persist; Wake resumes), so
the newcomer spawns immediately and an idle child pays. The policy is a
pure, unit-tested function, `live_slot_evictions` (`stale.rs:1325-1344`):
process-backed rows only (`has_pid` — hooks-only external rows neither hold
nor free a slot), resumable only (`has_cc_id`), oldest-idle first, never
more than the overflow. Running/AwaitingInput/Spawning are untouchable —
"evicting working sessions would lose in-flight work, which the
never-lose-work rule forbids" (`:1322-1324`) — making it a declared **soft
cap** (`:146-147`). `free_slot_for_spawn` (`:1393-1415`) pre-frees a slot at
spawn/wake time by evaluating the policy at `cap − 1`, and eviction
re-validates state inside the hibernate lock (`:1370-1372`) so a session
that went live between snapshot and act is never slept — the TOCTOU guard
the technique's "enforced, not assumed" clause demands.

## Layer 3 — machine-scoped exclusion across host instances

`scripts/build/guard-concurrent-cargo.mjs` serializes heavyweight compiles
across *independent agent sessions* sharing the checkout — a resource no
in-process scheduler can see. Its two design decisions are the technique's
closing argument in miniature:

- **Stateless by choice** (`:16-19`): "it inspects live processes rather
  than maintaining a lockfile, because a lockfile needs a release path and a
  crashed run would leave a stale lock that blocks everything." The gate
  observes the population itself — the ground truth cannot go stale.
- **Fail-open, loudly** (`:21-26`): if enumeration fails it allows the
  command and says so on stderr — a false block halts all compilation, a
  false allow merely risks the CPU spike. Every degraded path prints
  `DEGRADED`, including the empty-stdin case (`:44-50`), which the script's
  own self-test caught silently exiting 0 — "the blind-gate pattern this
  repo keeps finding."

It also applies the young-process grace (`MIN_AGE_MS`, `:33` — cargo
re-execs itself) and blocks with actionable options plus an explicit
override env (`:116-127`).

## Disjoint ownership, and the gap

Per-run scratch isolation matches the matrix: `CliProcessDriver::spawn_temp`
mints a UUID-named private temp dir per child and deletes it at `finish`
(`src-tauri/engine/src/cli_process.rs:529-544`, `:702-713`); run identity
keys each child's activity and output attribution
(`process_activity.rs` — the serde comment documents the exact shared-key
collapse the technique forbids, concurrent runs folding into one
`"execution"` entry). **Gap worth naming:** the three cap layers count
three different populations (tracker entries, fleet sessions with pids, OS
processes named `cargo`), and no reconciliation pass compares any ledger
against the real process table — the slot-leak detector the technique's
observability section calls for does not exist here; the legacy corpus
audit of process reconciliation found the app persists almost no child PIDs
at all, so a post-crash ledger-vs-population comparison has nothing to read.
