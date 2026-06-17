# Fabro-lessons — deferred findings (implementation-ready specs)

From the `/research` fabro↔personas comparison (2026-06-16). Findings F2–F5, F7,
F8, F10, F18, F21 (and their UIs) shipped on `worktree-fabro-lessons`. The two
items below were deferred because each touches a **sensitive or deep integration
path** and is better done with fresh context. Both are designed against personas'
actual architecture and are ready to implement.

Parent plan: [`docs/plans/fabro-lessons-implementation.md`](../plans/fabro-lessons-implementation.md).

---

## F8 — verification command as a *second* fix-loop trigger

### Intent
F7's quality-gate fix-loop (`engine/fix_loop.rs`, wired in `engine/mod.rs::handle_execution_result`)
currently re-enters a persona only when an **output assertion** fails. The F8
primitive — `engine::verification_command::run_verification` — runs a real check
(tests/lint/typecheck) and returns `{passed, exit_code, output_tail}`, but is
**not yet wired to anything** (it carries `#[allow(dead_code)]` on its module
declaration in `engine/mod.rs`). The goal: when a fix-loop-enabled persona
declares a `verification_command`, run it post-success and feed its failure into
the same fix-loop, so the agent re-enters on a *failed check* too — not just a
failed assertion.

### The blocker (why it was deferred)
`handle_execution_result(pool, app, exec_id, persona_id, …, result, …)`
(`src-tauri/src/engine/mod.rs` ~line 1929) is where the fix-loop triggers, but it
**does not have the execution's working directory**. The dir (`exec_dir`) is
computed *inside* `run_execution` (`engine/runner/mod.rs` ~line 995, from
`exec_worktree`) and is **not deterministically derivable** from `persona_id`. The
verification command must run in that dir, so the dir has to be plumbed out.

### Implementation steps
1. **Plumb the working dir onto `ExecutionResult`.**
   - Add `pub working_dir: Option<String>` to `ExecutionResult` (`engine/types.rs`).
   - In `run_execution` (`engine/runner/mod.rs`), set it from `exec_dir` at every
     `ExecutionResult` construction site (success + the error/early-return paths
     at ~466, ~1546, ~1801, and the main success path ~2851). Use `None` where
     `exec_dir` isn't established yet.
2. **Broaden the trigger.** In `handle_execution_result`, the fix-loop is gated by
   `if result.success { if let Some(summary) = assertion_downgrade { … } }`.
   Change it so `maybe_run_fix_loop` is called on **every** `result.success`
   (assertion downgrade becomes one of possibly two failure sources), passing the
   `assertion_downgrade`'s first critical failure (if any) **and**
   `result.working_dir.as_deref()`.
3. **Run the verification gate inside `maybe_run_fix_loop`.**
   - Read a `verification_command` `PersonaParameter` off the persona (same
     parse pattern as `fix_loop::FixLoopConfig::from_persona_parameters`).
   - If present and a `working_dir` was provided, call
     `engine::verification_command::run_verification(Path::new(dir), &cmd, Duration::from_secs(N))`.
   - If `!result.passed`, push a failure string built from `output_tail` onto the
     `failures` vec (alongside the assertion failure, if any).
   - If the combined `failures` is empty → `decide` returns `Stop` (gate passed),
     so the existing early-return logic still holds.
4. **Remove `#[allow(dead_code)]`** on the `verification_command` module decl in
   `engine/mod.rs` once it has a caller.

### Safety (preserve the F7 posture)
- Still **opt-in** (`fix_loop_enabled`, default off) and **bounded**
  (`max_fix_attempts` + the failure-signature breaker). The verification command
  only runs for fix-loop-enabled personas.
- The command is **operator-authored** (a persona parameter) → trusted input; it
  inherits the host env like any dev tool (this is already how
  `run_verification` behaves).
- For a non-dev persona with no meaningful repo, `working_dir` is just the
  persona's `exec_dir`; a verification command there is the operator's choice.

### Anchors
- `engine/verification_command.rs` (the primitive, already shipped + tested)
- `engine/fix_loop.rs::{FixLoopConfig, decide, build_fix_prompt}`
- `engine/mod.rs::{handle_execution_result, maybe_run_fix_loop}`
- `engine/types.rs::ExecutionResult`, `engine/runner/mod.rs` (exec_dir ~995)

### Effort / risk
Medium. The risk is the `ExecutionResult` field addition (a widely-constructed
struct) + editing the sensitive completion handler. Do per-site, `cargo check`
after each, and keep the trigger change minimal.

---

## F20 — durable event log + seq + replay + `Unknown` forward-compat variant

### Intent
Tauri `EXECUTION_EVENT`s are fire-and-forget: a missed event (window reload, HMR)
leaves a gap, and the `execute_persona_inner` non-blocking footgun means output
isn't ready when the event arrives. Give every structured execution event a
durable, monotonic `seq` in a per-execution log so the inspector can **replay**
and read **authoritative** state; add an `Unknown` variant so an older frontend
doesn't crash on a newer event type.

### Why it's the heaviest / most sensitive
It appends to the runner's **live stream-event loop** (`engine/runner/mod.rs`
~line 2071, the `StreamLineType → StructuredExecutionEvent` match) — code that
runs for *every* execution; a mistake there affects all runs. It also requires
**lockstep** edits across the documented event quad (see `.claude/codebase-stack.md`
§ "Two parallel stream channels"):
1. `engine/types.rs::StructuredExecutionEvent` (Rust enum)
2. `src/lib/types/terminalEvents.ts` (hand-maintained TS union)
3. `src/lib/eventRegistry.ts::ExecutionEventPayload` (hand-maintained TS union)
4. `src/hooks/execution/useStructuredStream.ts` (dispatch)

### Implementation steps
1. **Migration** (`db/migrations/incremental.rs`, idempotent `run_step`, mirror
   the F5 `dev_run_checkpoints` step):
   ```sql
   CREATE TABLE IF NOT EXISTS execution_event_log (
       execution_id TEXT NOT NULL,
       seq          INTEGER NOT NULL,
       event_json   TEXT NOT NULL,
       created_at   TEXT NOT NULL,
       PRIMARY KEY (execution_id, seq)
   );
   ```
2. **Repo** (`db/repos/execution/event_log.rs`):
   - `append(pool, execution_id, seq, &event_json)`.
   - `list_from(pool, execution_id, since_seq, limit) -> Vec<row>` (returns
     `limit + 1` so the caller can compute `has_more`, fabro-style).
3. **Per-execution seq + append at the funnel.** In `run_execution`, carry a
   `seq: u64` counter in the per-execution state (next to where structured events
   are emitted ~2071). For each emitted `StructuredExecutionEvent`, after emitting
   the Tauri event, `append(pool, execution_id, seq, json)` and `seq += 1`.
   **Best-effort** — a log write must never block or fail the stream (`let _ = …`).
4. **Command** (`commands/execution/…`): `get_execution_events(execution_id,
   since_seq, limit) -> Vec<EventLogRow>` for replay/paging.
5. **`Unknown` forward-compat variant.** The crash risk is on the **frontend**
   (it deserializes events). Add an `Unknown` catch-all to the TS discriminated
   unions (#2, #3) and have `useStructuredStream` (#4) ignore unknown `type`s
   gracefully instead of throwing. Add `StructuredExecutionEvent::Unknown` (Rust,
   #1) for symmetry when the backend reads the log back.
6. **Frontend replay.** On inspector mount, call `get_execution_events(id, 0,
   N)` to rebuild state; treat live Tauri events as **invalidation hints** and
   read authoritative state from the log/query (this also fixes the
   `execute_persona_inner` non-blocking footgun).

### Safety
- The seq counter is **per-execution** (in the runner's execution context), not
  global.
- The append is **best-effort** and must be cheap (a single prepared insert);
  never `?`-propagate it into the stream path.
- Ship in two commits: (a) the `Unknown` variant + frontend graceful-ignore
  (low-risk, high forward-compat value), then (b) the durable log + replay
  (heavier). (a) is independently valuable and de-risks (b).

### Anchors
- `engine/runner/mod.rs` (~2071, the structured-event match + emit)
- `engine/types.rs::StructuredExecutionEvent`
- `src/lib/types/terminalEvents.ts`, `src/lib/eventRegistry.ts`,
  `src/hooks/execution/useStructuredStream.ts`
- `db/migrations/incremental.rs`, `db/repos/execution/`

### Effort / risk
High. Touches the live stream loop + 4 lockstep files + a migration. The `Unknown`
variant half (steps 5) is the safe, high-value slice to land first.

---

## Also noted (smaller, lower priority)
- **F8/F20 aside — verification gate for non-dev personas:** if F8 lands, a
  per-persona `verification_command` parameter needs a small UI in the persona
  editor (currently command/parameter-only).
- **F2 redaction toggle UI:** the `REDACT_TRACES_ENABLED` setting is honored at
  startup but has no settings toggle yet (default-on; flip via the setting).
- **F18 storage:** `prune_storage` deletes execution rows only; associated log
  files on disk are not reclaimed (a `df`-style logs category + log-file cleanup
  is a follow-up).
