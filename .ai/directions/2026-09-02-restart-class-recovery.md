---
subject: software-engineering/session-continuation
project: personas
raised_by: intake intake-hermes-0902 (peer comparison)
source: librarian/sources/2026-09-02-hermes-agent.md
stage: boot reconciliation — `src-tauri/src/boot/recovery.rs` and `src-tauri/src/engine/execution.rs::recover_stale_executions`
size: 5 files / ~450 lines / M
status: proposed
---

## Why the scope implies it

`.ai/manifest.yaml:97` — personas exists to "run local AI agent personas over
wrapped CLIs, local-first storage, one operator per install". Every word of that
argues for this. A wrapped CLI runs in a child process; a desktop app is closed,
force-quit, updated and crashed by the person using it; local-first means the
only record of the interrupted work is the row on this machine. So an app
restart mid-execution is the **normal** case, not the exceptional one — and
personas currently answers it by declaring a failure it never observed.

`src-tauri/src/engine/execution.rs:500-528` marks every `running` row `Failed`
with `"App restarted while execution was running"`. The repo's own golden path
measured the consequence: `docs/concepts/golden-paths/os-process-reconciliation.md:306`
— *"`recover_stale_executions` declares failure it did not observe. **74 of
2,188 executions** carry its marker. No liveness check, no `unproven` state, no
user surface."* — and it counted **five** blind-fail sweeps against **one**
classify sweep (`recover_after_restart`), noting that the classify pass is the
newest. §2(c) of that same document already states the prescription: *"At boot,
do not declare — classify. Rows whose process cannot be proven alive are
**unproven**, not failed."* The prescription is written. The engine path has not
adopted it.

Two things already exist that make this cheap. `queued` rows are *already*
re-admitted from the durable row (`execution.rs:530` — "the runnable context is
reconstructed from the DB"), so the re-admission machinery is built and tested.
And `src-tauri/src/boot/recovery.rs:33` already defers the whole sweep to a live
leadership lease, so the "is another instance actually running this?" question
has an answer. What is missing is the state between `running` and `failed`, and
the counter that stops a run which crashes the app every time it resumes.

## What the first context contains

**The module.** `src-tauri/src/boot/recovery.rs` grows a classification step,
and `src-tauri/src/engine/execution.rs::recover_stale_executions` is replaced by
`classify_stale_executions`:

- **A third value.** `ExecutionState::Unproven` (or a nullable
  `recovery_state` column if the enum is load-bearing elsewhere — the golden
  path notes `ExecutionState::TERMINAL`/`::ACTIVE` already have zero production
  callers, so widening the enum is not free). An `unproven` row is not a
  failure, not a success, and not runnable; it is a row the user is told about.
- **A re-admission mark, cleared on success not on attempt.** A row touched
  recently enough to be plausibly mid-flight is marked for one re-admission. The
  mark survives the re-admission and is cleared only when a turn *completes* —
  clearing it at resume time loses the retry, which is precisely the mistake the
  peer names.
- **A restart counter with a terminal state.** A durable per-execution count of
  consecutive re-admissions. At three, the row becomes terminal `unproven` with
  a reason, and stops being re-admitted forever. A run that kills the app on
  every resume must terminate itself rather than terminating the app.
- **A clean-shutdown marker.** Written on graceful exit, checked at boot: a
  graceful restart skips the sweep entirely, so a normal quit does not
  manufacture a class of rows that only crashes should produce. This is also the
  ordering rule from the peer's drain contract — flip the state, confirm it is
  durable, only then tear down.
- **A user surface.** `unproven` rows appear where the operator already looks
  (`overview-incidents` / the execution list), with resume and discard actions.
  The golden path's §2(e) requires this: reconciliation cannot be complete, so
  the residue must reach a human.

**The boundary — what it must NOT absorb.**

- **PID identity and process reconciliation.** That is
  `os-process-reconciliation`'s leaf and it stays there. This context asks only
  "what state should a row be in when its process cannot be proven alive?" — it
  does not add a pid column, does not call `sysinfo`, and does not kill anything.
  §7.1 of that golden path is explicit that the one pid column in 244 tables has
  never held a value; nothing here changes that.
- **Fleet PTY sessions.** `src-tauri/src/commands/fleet/persist.rs:263-299`
  already parks recovered sessions with a human-readable reason and refuses to
  auto-kill. It is the good answer in this repo and is the model, not the target.
- **The other four blind-fail sweeps.** `recover_interrupted_pipeline_runs`
  (`src-tauri/db/src/repos/resources/teams.rs:724`),
  `recover_interrupted_lab_runs`, and `persona_jobs::recover_orphans`
  (`persona_jobs.rs:257`) have the same shape and should follow — but not in the
  first context. One sweep, one classification, one surface, measured, then the
  pattern spreads.
- **Failure-identity stall detection.** Stopping a run because the *same
  failure signature* keeps recurring is a different mechanism keyed on a
  different observable. A crash-restart produces no signature; that is exactly
  why a restart counter is needed alongside, not instead of.
- **The leadership lease.** `boot/recovery.rs:33` already answers "is another
  instance live?". This context runs after that check and does not touch it.

## The measurable

1. **Work recovered.** Of the executions that today carry the
   `"App restarted while execution was running"` marker, the share that complete
   successfully on a single re-admission. The 2026-08-17 backup holds 74 such
   rows against 2,188 executions (3.4%) and is the replay corpus. Test **T1** in
   the comparison study is this measurement; the direction pays off if the share
   is materially above zero and the retry does not storm.
2. **Rows in a state nobody chose.** Count of `failed` rows whose
   `error_message` is the restart marker. Target after: **zero** — every such
   row is `unproven` and either resumed or discarded by a person.
3. **Poison runs contained.** Max consecutive re-admissions observed per
   execution id. If the escalation is doing its job this is bounded at 3; test
   **T2** measures whether any row would ever reach it.

## What would make this wrong

- **If nothing recovers.** If the T1 replay shows that re-admitted executions
  fail again at close to 100% — because the input data is stale, the connector
  token has rotated, or the child's session id is gone — then `unproven` is a
  nicer word for `failed` and the whole direction reduces to a wording change
  plus a UI surface. The honest outcome then is the surface alone: keep the
  hard fail, tell the user which runs were interrupted, and stop.
- **If the escalation counter can never fire.** If T2 shows no execution ever
  reaches two consecutive restarts, the counter and its terminal state are dead
  code, and the design should ship without them. A counter that has never
  incremented is a `VALID_HOOKS` entry with no fire site.
- **If widening `ExecutionState` breaks readers.** The enum crosses to
  TypeScript via ts-rs and is read by the execution list, the inspector, the
  replay sandbox and the lab. If a third non-terminal value forces edits in more
  than a handful of places, the nullable `recovery_state` column is the right
  shape and the enum should be left alone — and if *neither* is cheap, that is
  evidence the state machine is load-bearing in ways this proposal underestimated.
- **If the clean-shutdown marker is unreliable on Windows.** The marker is only
  as good as the exit path that writes it. `RunEvent::Exit` does not fire on
  SIGKILL, power loss, or a Windows force-quit
  (`os-process-reconciliation.md` §8.4), which is fine — those are the crashes
  this is for. But if the marker also fails to be written on an *ordinary* quit,
  every normal restart manufactures `unproven` rows, and the feature becomes
  noise the operator learns to dismiss. That is the failure mode to watch for in
  the first two weeks.
