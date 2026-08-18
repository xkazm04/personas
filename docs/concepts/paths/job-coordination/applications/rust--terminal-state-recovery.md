---
layer: application
subject: job-coordination
technique: terminal-state-recovery
stack: rust
---

# Terminal-state recovery in the Rust boot sequence

The repo runs four independent boot/mid-flight recovery passes over four job
tables, and together they span the technique's whole spectrum — the
per-class verdict form, the park form, the corroborated age-expiry form,
and the blanket wholesale fail the technique exists to displace. All four
are dispatched from startup in `src-tauri/src/lib.rs` (`:815`, `:842`,
`:909`).

## The strong form: verdicts per class

`ExecutionEngine::recover_stale_executions` + `requeue_persisted_executions`
(`src-tauri/src/engine/mod.rs:703`, `:748`) split the survivors by state
class and give each its own fate:

- `running` → **fail with reason** ("App restarted while execution was
  running") — the executor subprocess is provably dead, the slot must be
  freed.
- `queued` → **preserved and resumed**: the row *is* the durable queue
  (status, persona, use case, input all persisted), and each row is
  re-admitted through the normal `start_execution` door — not by flipping
  status, so admission limits still apply. Per-row best effort: a row whose
  persona no longer exists is failed with its own distinct reason instead
  of blocking the batch; a row the queue refuses stays `queued` for the
  next boot, which makes the sweep idempotent and crash-safe mid-recovery.

The doc comment (`mod.rs:697-702`) preserves the history: this function
*used to* fail `queued` rows too — the "P1 never-lose-a-queued-execution
gap" — i.e. the repo measurably migrated from the wholesale form to the
per-class form and wrote down why.

## The park form: paused survives boot

`n8n_sessions::recover_interrupted_sessions`
(`src-tauri/db/src/repos/resources/n8n_sessions.rs:167-209`) fails sessions
in the live classes (`transforming`, `analyzing`, `interrupted`) with an
*actionable* reason ("App closed during transform -- click Retry to
resume") — but explicitly **preserves `awaiting_answers`**: "they have
persisted questions and can resume without re-running the transform." A
paused job was not executing; the restart proved nothing about it. This is
the park verdict, verbatim.

It also demonstrates the registry-reconciliation obligation: the function
returns the `transform_id`s it re-verdicted "so the caller can clear
in-memory job state (dead cancellation tokens, expired status channels)" —
the sweep repairs both stores, rows and memory, in one startup sequence.

## The corroborated age expiry

`build_sessions::expire_stale_non_terminal`
(`src-tauri/db/src/repos/core/build_sessions.rs:308-339`) expires
non-terminal build sessions only when **both** hold: no activity for 24h
(`STALE_SESSION_MIN_AGE_HOURS`, `:282`) *and* the owning persona's
lifecycle has left `draft` — independent corroboration that the work is
orphaned, sparing a draft's legitimately parked `awaiting_input` session at
any age. The sweep reuses `cancelled` instead of minting `expired`, and the
comment (`:296-301`) records exactly why: the escape-hatch transition makes
the bulk sweep legal for every row, and a new terminal state would have to
be added to every scattered `phase NOT IN (…)` literal — the recorded
vocabulary-reuse compromise, with the one-authority bill it measures.

## The bad form, still live

`teams::recover_interrupted_pipeline_runs`
(`src-tauri/db/src/repos/resources/teams.rs:724-738`) is the blanket
wholesale fail: one `UPDATE … SET status='failed' … WHERE status IN
('running','awaiting_approval')`. It stamps a single generic reason across
both classes and — the technique's precise objection — **destroys
`awaiting_approval`**, a paused state holding a human-review question that
was not running and needed no repair. Registered as deviation
`#w8-pipeline-dag` in `docs/concepts/golden-path-deferred-fixes.md`.

Its own doc comment (`:714-723`) documents the deadlock that motivates
reachability: before this sweep existed, an orphaned `running` row meant
`execute_team` refused new runs, `delete_team` refused deletion, and
`cancel_pipeline` only flipped an in-memory registry flag "whose key is
gone after restart" — a team permanently wedged with no in-app remedy. The
guards keyed off live states; the unreachable state deadlocked every one
of them.
