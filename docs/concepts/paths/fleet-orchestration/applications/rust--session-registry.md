---
layer: application
subject: fleet-orchestration
technique: session-registry
stack: rust
---

# Rust — the Fleet session registry

The reference implementation of [session-registry](../techniques/session-registry.md)
(with [lifecycle-signals](../techniques/lifecycle-signals.md) and
[durable-fleet-state](../techniques/durable-fleet-state.md) grafted onto the same
spine) is the Fleet plugin's backend: `src-tauri/src/commands/fleet/`.

## The one registry and its closed vocabulary

- **`registry.rs`** — one process-wide `FleetRegistry` holds every tracked Claude
  Code session, keyed by an internal UUID v4 minted at spawn (`FleetSession.id`,
  `types.rs:141`). The runtime's own conversation id (`claude_session_id`) is a
  *field*, bound later when the `SessionStart` hook fires; the child PID is another
  field, `None` after exit. Identity, join keys, and process facts are exactly the
  three separate things the technique prescribes.
- **`types.rs:25-55`** — the closed vocabulary: `Spawning · Running · AwaitingInput ·
  Idle · Stale · Finished · Hibernated · Exited`, one enum, exported to the frontend
  via ts-rs so both sides derive from a single definition. `state_to_token` /
  `token_to_state` (`types.rs:65-97`) are the wire/persistence round-trip; an
  unknown persisted token yields `None` so a row written by a newer build is
  *skipped rather than silently mislabelled* — the vocabulary law applied to
  forward compatibility. The doc comment on `state_to_token` names the reason:
  four independent emitters (hooks, staleness ticker, transcript watcher,
  headless reader) all need the token, and a token that drifts between lanes
  "would silently split the frontend's state machine."
- **Lane is a mode, not a second machine**: `FleetSessionMode { Interactive,
  Headless }` (`types.rs:124-130`) — a PTY-driven TUI session and a headless
  stream-json session share the state machine, the transcript, and the hooks; a
  headless conversation can be woken interactively. The golden path's
  "drive medium is a mode" paragraph is this, verbatim in the field.

## Transitions: guarded methods, not poked fields

Writers cannot touch `state` directly; they call named, individually-guarded
registry methods that validate the edge inside the lock: `mark_exited`
(`registry.rs:1047`), `mark_alive`, `revive_to_running_on_activity`,
`mark_finished` (`registry.rs:1323` — parks `Finished` with the declared summary in
`state_reason`), `hibernate(id, require_resting)` (`registry.rs:1147` — re-validates
Idle/Stale *inside* the lock so an eviction pass can never sleep a session a hook
just revived), `doze`. Even the escape hatch `set_state_direct` (`registry.rs:858`,
sole caller the headless reader at `headless.rs:307`) refuses to resurrect
`Exited`/`Hibernated` and returns `true` only on a real change so the caller emits
exactly one event per transition. The "door" here is distributed across named
methods rather than one transition function — but every method enforces edge
legality and terminal-state finality, which is the property the technique actually
demands.

## Signals first, sweeper second — with provenance kept separate

- **`hooks.rs`** — five lifecycle hooks POSTed by the sessions themselves
  (`SessionStart`, `Notification` → AwaitingInput, `Stop` → Idle, `PreToolUse` →
  Running, `SessionEnd`), received on an HTTP router; bodies are parsed
  opportunistically and never 500 (a hook failure must not spray errors into the
  operator's terminal).
- **`stale.rs`** — the gap-filling ticker (30s cadence). It keeps *three*
  provenance-separated recency facts per session — `last_activity_ms` (any
  signal), `last_pty_output_ms` (raw bytes), `last_grew_ms` (real transcript
  growth by size polling, "not hook timing or mtime touches") — and derives
  different verdicts from each: flat-logs ⇒ `Stale` at 6 min; *total* PTY silence
  ⇒ frozen-process verdict at 2 min (claude redraws continuously, so silence is
  conclusive); transcript growth past a baseline snapshotted on the first
  AwaitingInput tick ⇒ the await was spurious, revive to `Running`. Dev-runner
  sessions get an 8× stall multiplier (`DEV_SESSION_STALL_MULTIPLIER`) because
  their healthy state is a silent multi-minute compile — the workload-calibrated
  budget from the technique, with the incident that earned it in the comment.

## The durable mirror

**`persist.rs`** — writes piggyback the two existing emit points so "nothing gets
a private write path that could drift"; the actual DB write runs on one dedicated
thread fed by a channel so "a DB stall can never wedge the PTY"; persistence is
explicitly best-effort (a miss logs a warning, never fails the fleet). `rehydrate`
(`persist.rs:200`) restores rows as *dozing tombstones* — reusing the existing
doze/wake state instead of minting a recovery state — and `recover_after_restart`
(`persist.rs:263`) force-parks mid-task orphans to `AwaitingInput` while
*refusing* to auto-kill-and-resume, because matching a process to a session by
cwd alone is ambiguous when several share a directory. Exited rows older than 24h
are pruned at boot (`EXITED_RETENTION_MS`) — the mirror names its reaper.

## Deviations visible from here

- Wake (`commands.rs:190-236`) mints a **new** registry id for the resumed
  session and deletes the old row, compensating with `adopt_lineage`
  (created-at + name inheritance) and a debug-log line linking old id to new.
  The durable identity that survives is the conversation id, not the registry
  key — the technique prescribes one identity end to end.
- The mirror's best-effort contract means even terminal transitions can be
  lost in a crash window; the technique wants terminal transitions flushed
  non-lossily.
