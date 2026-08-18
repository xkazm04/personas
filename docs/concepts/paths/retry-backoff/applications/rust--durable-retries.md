---
layer: application
subject: retry-backoff
technique: durable-retries
stack: rust
---

# Durable retries in the Personas healing engine (Rust)

How this repo realizes the durable-retries technique — and one production
counter-example that demonstrates the technique's central warning.

## 1. The durable retry-at schedule, from a provider-stated reset window

When a run fails on a provider usage-limit **window** (the rolling ~5h cap),
healing does not compute a ladder — it schedules a retry at the *parsed reset
time*. The chain:

- `error_taxonomy.rs` distinguishes `UsageLimitScope::Window` ("resets on its
  own — eligible for a scheduled retry at the reset time") from
  `UsageLimitScope::Weekly` ("too far out to auto-retry — the run stays failed
  and a healing issue is created"), carrying `resets_at` parsed from the
  provider message (`src-tauri/core/src/error_taxonomy.rs:60-83`). This is the
  technique's "stated times have a horizon" rule as a two-variant enum.
- The schedule lives in the `scheduled_retries` table
  (`src-tauri/db/src/repos/execution/scheduled_retries.rs`): PK =
  `execution_id` (work identity, one pending retry per failed execution),
  `retry_at` RFC-3339, `reason` tag. The module doc states the durability
  argument verbatim: "A multi-hour in-memory sleep would not survive an app
  restart."
- Live data (2026-08-16 census of the operator's database) showed 20
  usage-limit retries with measured gaps of 5.0–13.7 hours — schedules that
  outlived multiple app sessions.

## 2. Drain discipline: claim-by-delete, budget re-read at dispatch

`drain_due_scheduled_retries` (`src-tauri/src/engine/mod.rs:1589-1660`) is the
reconciliation-loop half, and it makes three technique decisions explicitly:

1. **Claim by consuming**: the row is deleted *before* dispatch — the comment
   says why: "a retry that fails to spawn must not re-fire on every subsequent
   tick." At-most-once per due moment, chosen and stated.
2. **Budget re-read at drain time**: it loads the execution row and checks the
   *current* `retry_count` against `healing::MAX_RETRY_COUNT`, dropping the
   retry if the budget was exhausted since the row was written — never trusting
   the state persisted with the schedule.
3. **The reason tag drives resume-vs-fresh**: `api_error_resume` retries resume
   the prior session; usage-limit retries restart fresh; a missing session id
   degrades to fresh with a log line.

Attempt count lives on the execution row (`persona_executions.retry_count`,
lineage via `retry_of_execution_id`), not in a parallel in-memory counter —
attempt six after a restart is still attempt six.

## 3. The counter-example: a durable ladder with no third number

`src-tauri/src/engine/oauth_refresh.rs` persists its refresh-failure ladder in
the credential row (`oauth_refresh_fail_count`, `oauth_refresh_backoff_until`,
written atomically by `increment_refresh_backoff_atomic`) with schedule
`REFRESH_BACKOFF_STEPS = [15m, 1h, 4h, 24h]` (`oauth_refresh.rs:51-53`). The
mechanism is the best-built persisted backoff in the tree — restart-proof,
transactionally incremented, cleared on success.

And it has **no attempt cap and no terminal state**. The step index saturates
(`credential_ledger.rs` clamps to the last rung); the count does not. The
2026-08-16 census found two live credentials at failure counts 49 and 21 —
months of 24-hour retries against revoked tokens — stopped, eventually, not by
any decision of the retry subsystem but by `STALENESS_CEILING_SECS` (a 7-day
eligibility filter in the refresh selector, `oauth_refresh.rs:49`) silently
excluding their input, while the `needs_reauth` terminal flag sat set and
unread by the loop. This is the technique's core warning made flesh:
**durability and boundedness are the same design step**, and an ending imposed
by a neighboring filter is orphanhood, not termination.

## What to copy, what to improve

Copy: the Window/Weekly horizon split at classification time; the row-as-timer
with work identity as PK; claim-by-delete before dispatch; budget re-read at
drain; the reason tag selecting the continuation mode.

Improve: give the OAuth ladder its third number — a max attempt count whose
exhaustion writes a terminal state the refresh selector actually honors (it
already exists: `needs_reauth`), plus a healing issue so the ending is
reported. Also note for metric hygiene: ~30 of the 98 live
`retry_of_execution_id` rows point at *completed* parents (continuations
borrowing the retry lineage, `incident_continuation.rs`), which pollutes every
retry metric keyed on that relation — the retry-observability technique's
"lineage must contain only retries" rule names this exact shape.
