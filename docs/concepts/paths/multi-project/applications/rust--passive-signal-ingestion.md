---
layer: application
subject: multi-project
technique: passive-signal-ingestion
stack: rust
---

# Rust — the project-tracking pulse engine

The reference implementation of
[passive-signal-ingestion](../techniques/passive-signal-ingestion.md) is the
engine's project-tracking subsystem: `src-tauri/src/engine/project_tracking/`.
Its module doc is the technique in one sentence: "absorbs CLI activity (git
commits, active-runs ledger entries, optional Obsidian notes), keeps a capped
raw event log, and runs an hourly consolidator … that produces a stable
per-project 'pulse' — narrative + 3-5 named directions + 0-3 tensions"
(`mod.rs:1-8`).

## Watchers over exhaust, read-only, per-source

- **`watchers/git.rs`** — spawns the user's own `git log --since=<iso>
  --no-merges` (no library dependency; one process per project per tick) and
  parses commits into `EventPayload::Commit` events. A hard
  `MAX_COMMITS_PER_POLL = 500` cap protects the downstream prompt budget,
  and hitting the cap *warns* — a truncated read is named, not silent.
- **`watchers/ledger.rs`** — the parallel-session active-runs ledger.
- **`watchers/obsidian.rs`** — the notes vault, gated per subscription.

All three are strictly read-only over artifacts the projects produce anyway
— the technique's "exhaust-only" contract. What each project exposes is a
per-project subscription row (`subscription.rs`: `watch_git`,
`watch_active_runs`, `watch_obsidian`, `enabled`, `last_pulse_at`), owned by
the plugin UI and *read* by the engine each tick — configuration and
ingestion cleanly split, with the ownership table written out in
`mod.rs:10-18`.

## Baseline cadence + announced acceleration, debounced

- **`scheduler.rs`** — the 1h tick (`TICK_INTERVAL`, "hardcoded per the
  locked design decision"). Each tick short-circuits on the master enable
  flag, runs leader-only under multi-driver orchestration (a follower would
  duplicate consolidator events), polls each enabled subscription with
  `since = last_pulse_at ?? now-24h`, and **isolates failures per project**
  — "failures inside one project's watcher pass are logged and skipped;
  they don't break the tick for other projects" (`run_tick`, lines 91-99).
  Event pruning (7 days) runs once per tick — the raw log names its reaper.
- **`push.rs`** — the announced lane: `POST /project-tracking/cli-event` on
  the loopback-only local server (plus an in-process helper for hooks that
  already live in the app). A CLI that just shipped something asks the
  consolidator to run *now* — and a per-project `DEBOUNCE_INTERVAL` of 300s
  "caps out-of-cadence runs at one per 5 minutes so a hot session can't
  starve the LLM budget" (`push.rs:5-8`). This is the debounce guard the
  technique requires on any announced lane, with the budget it protects
  named in the comment.

## Consolidation into a continuous, cost-accounted pulse

`consolidator.rs` makes the digestion model-assisted deliberately: a
one-shot small-model CLI call, 90s timeout, chosen because "the 'carry
forward / replace / retire' reasoning over directions matters more here
than raw speed" (`consolidator.rs:40-43`) — the technique's *continuity*
property is literally the model-selection rationale. The output envelope is
parsed tolerantly (missing arrays default), and the result upserts one
`PulseRow` per (project, day) — `pulse.rs` — carrying `narrative_md`,
`directions`, `tensions`, per-source counts (`commit_count`, `run_count`,
`note_count`) **and `tokens_in` / `tokens_out`**: the pulse records what
its own production cost, the technique's cost-accounting clause as two
columns. A successful upsert emits `project-tracking://pulse-updated`, and
consumers (the companion brain, chat context) read pulse rows — the digest,
never the raw exhaust.

## Deviations visible from here

- **Unwatched is spelled as quiet past the log line.** Every watcher
  failure path — binary missing, non-zero exit, unreadable vault — returns
  `Ok(vec![])` with a `tracing::warn` (`watchers/git.rs:51-70`). Nothing
  durable records "could not observe," so a project whose repository became
  unreadable renders exactly like a genuinely idle one on every surface
  that reads the pulse. The technique demands three outcomes
  (observed-changes / observed-quiet / could-not-observe) with the third as
  durable, surfaced state; the implementation has two plus a log.
- **The tracking registry is a second registry.** Subscriptions hang off
  `companion_known_project` while the Factory/passport surfaces key off
  `dev_projects` — two project identity spaces in one app, with the push
  endpoint resolving projects *by path* at the boundary. The subject's
  golden path prescribes one registry; at minimum the id↔id mapping should
  be explicit rather than path-mediated (a re-cloned project at a new path
  silently stops matching its announcements).
- **Cadence is baseline-only.** Acceleration exists only on the announced
  lane; there is no probe-based fast lane or decay — a busy project that
  never announces still waits for the hour.
