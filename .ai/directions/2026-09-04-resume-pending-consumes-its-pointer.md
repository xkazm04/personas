---
subject: software-engineering/job-coordination
project: personas
raised_by: intake pi-01 (peer comparison, earendil-works/pi @ 92d8e2d1)
source: librarian/sources/2026-09-04-pi-agent-toolkit.md
technique: job-coordination/in-flight-is-a-position
stage: boot re-admission — `src-tauri/src/engine/execution.rs::requeue_persisted_executions`
size: 3 files / ~90 lines / S
status: proposed
kind: coverage
---

# `resume_pending` writes a resume pointer that nothing reads

## The defect, in two code sites

`2026-09-02-restart-class-recovery` built the right thing. The classifier
refuses to declare a verdict it did not observe, and it writes a **third
position value** — the record says not just *queued* or *done* but *this run
was mid-flight and here is what we know about it*:

- `src-tauri/db/src/repos/execution/restart_recovery.rs:145-155` — a `running`
  row started within `RESUME_WINDOW_SECS` (30 min) classifies `ResumePending`.
- `restart_recovery.rs:146-147` — `RestartSweep.resume_pending` is documented
  as *"Now `queued`: the existing re-admission path will pick these up."*
- The row keeps `recovery_state='resume_pending'`, `restart_count+1`, **and**
  its `claude_session_id`, which was persisted mid-stream with a retry at
  `src-tauri/src/engine/runner/mod.rs:2439` precisely so it would survive.

The consumer never learned about it. `requeue_persisted_executions`
(`src-tauri/src/engine/execution.rs:563`) selects on status alone via
`exec_repo::get_queued_only`, and passes `continuation: None`
(`execution.rs:618`) under this comment:

> *"continuation = None: a queued row had not yet started a CLI session, so
> there is nothing to resume — it runs fresh."*

That sentence is **true for the population it was written for and false for the
one the classifier added.** Its own doc comment enumerates the four fields it
reconstructs — `status='queued'`, `persona_id`, `use_case_id`, `input_data`
(`execution.rs:551-555`) — and `recovery_state` and `claude_session_id` are not
among them, even though the same comment records that this function *"Runs
AFTER `Self::classify_stale_executions`"*.

So the two populations are merged at the door by the one field they share, and
the distinction the classifier paid a migration to record is discarded one
function later.

## Why it matters here specifically

A re-admitted run starts a **fresh CLI session** and replays the whole prompt.
Every tool call in it executes again, and personas has **no tool-level
idempotency** — `tool_call_id` is read at
`src-tauri/src/engine/http_engine/tools.rs:270-274`, defaulted to `""` and
echoed back at `:301`, never stored and never compared; both audit tables mint
a fresh UUID per row. The 401 refresh-and-retry at
`src-tauri/src/engine/tool_runner.rs:275-320` re-executes with no idempotency
key by design.

The consequence is concrete: a persona whose run was interrupted 5 minutes in,
after sending mail or writing to a connector, is re-admitted and sends it
again. That is the `honestly non-idempotent` case, and the record already
contains everything needed to avoid it.

## What to build

1. **Carry the two fields to the door.** `get_queued_only` returns rows that
   already have the columns; surface `recovery_state` and `claude_session_id`
   on the struct the re-admission loop reads.
2. **Branch on the position value, not the status.** Where
   `recovery_state == "resume_pending"` and a `claude_session_id` is present,
   pass `Continuation::SessionResume(id)` (`src-tauri/core/src/types.rs:303` —
   the variant already exists and is already used by the healing path at
   `execution.rs:1528`). Everything else keeps `None`.
3. **Correct the comment to name both populations**, so the next reader is not
   told the false half again.

## The open question the owner should settle, not the implementer

Resuming a CLI session that died *inside* a tool call moves the replay decision
into Claude Code's own durability, which personas does not control. Two honest
options, and this proposal deliberately does not choose:

- **Resume** — accepts whatever the CLI's transcript replay does, and is
  strictly better than today for the common case (interrupted between turns).
- **Resume, but only when the last stream frame was not a `tool_use`** — a
  narrower rule that needs one more durable fact than the row currently
  carries, and is therefore a bigger change than this one.

Shipping (1)–(3) is an improvement under either answer; the second option is a
follow-up, not a blocker.

## Measurable

**For a `resume_pending` row holding a `claude_session_id`, does re-admission
pass a continuation?** Today: never (`continuation: None`, unconditional).
After: exactly for that class. Secondary, and the one that matters
operationally: **count of tool calls re-executed per recovered run** — today
equal to the whole run's tool count, after the change zero for a clean
between-turn interruption.

## Gate

`npm run check` plus `cargo test --workspace --features desktop`. Note the
instrument gap honestly: **`src-tauri/src/engine/execution.rs` is 2,795 lines
with zero `#[cfg(test)]`**, the local Rust lane runs `--lib` only so a test
added there would not run locally at all, and `MockProtocol`
(`src-tauri/engine/src/protocol.rs:166`) is unfinished stubs — so there is no
existing seam that can drive this path without a real LLM. The first honest
step is therefore a **repository-level test of the classifier→re-admission
contract** (pure: given a row in each class, assert which continuation the
selection produces), not an end-to-end one.

## Falsifier

If `resume_pending` rows in the field turn out to be dominated by runs that had
*not* yet emitted `system/init` — i.e. no `claude_session_id` was ever bound —
then the class is mostly unresumable in practice and this change buys little.
That is checkable in one query before building:
`SELECT COUNT(*) FROM persona_executions WHERE recovery_state='resume_pending'
AND claude_session_id IS NOT NULL;`. Run it first.

Note that `recovery_state` and `restart_count` currently appear nowhere in
`src/` or `bindings/`, and `list_unresolved_recoveries` /
`count_legacy_restart_failures` have zero call sites — so nobody can see these
rows today. Surfacing them is arguably the cheaper first move.
