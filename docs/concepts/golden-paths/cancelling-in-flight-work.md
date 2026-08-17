# Golden path — Cancelling in-flight work

> Situation node: `backend-runtime/background-work/cancelling-in-flight-work` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `cf14b9832`. Ground-truth sweep: all **963**
> `src-tauri/**/*.rs` files walked by the census runner; `ActiveProcessRegistry`
> (`lib.rs:100-365`), `process_session.rs` (673 lines), `background_job.rs`'s cancel
> surface, `ExecutionEngine::cancel_execution` / `force_cancel_all_for_persona`,
> `BuildSessionManager::cancel_session`, `webbuild/devserver.rs` (322 lines) and all
> **36** `cancel_*` / `stop_*` / `abort_*` public entry points read; every one of the
> **35** `.spawn()` sites and all **15** `.kill_on_drop(true)` sites classified by
> hand; all **18** `impl Drop` blocks enumerated; on the client, **26** real Stop
> affordances, **14** `AbortController` constructions and all **5**
> `useCorrelatedCliStream` consumers read individually over 4,829 `.ts` + 2,104
> `.tsx` files. Corpus totals cite [`shared-facts.json`](../shared-facts.json).
> Every number below came from reading source, not estimation.
> This leaf is **two-sided**: the Stop affordance and the backend teardown are one
> act. Both halves and the contract between them are stated.
> **Deviations** is a fix backlog; it migrates to `violating` cells on ingest.

**Adjacent leaves — cross-reference, do not absorb.**
[`long-running-job-progress.md`](./long-running-job-progress.md) owns *registration
and readback*: `BackgroundJobManager`, the four sweeping accessors, the durable-row /
in-memory fusion, boot recovery, and the `JobHandle` proposal that would own the
terminal write. **This path is the stop half of that same handle** and defers to it on
everything about how a job is registered and read. Where the two overlap — the status
vocabulary, `ffmpeg.rs`'s `"encoding"` literal, `evict_stale` — that path states the
progress consequence and this one states the cancellation consequence; neither
restates the other.
[`polling-loop.md`](./polling-loop.md) owns cadence, including the cadence of a
post-cancel confirm poll.
[`backend-to-frontend-events.md`](./backend-to-frontend-events.md) owns the emit
transport; this path owns only the rule that a cancel event is an invalidation
signal, never the proof.

---

## Principle

*Three sentences, no repo path, no primitive name, no count — the layer a sibling
repo on another stack can adopt as-is. Each clause carries its warrant, per the
[portability test](../research/portability-test.md)'s finding that unmarked local
calibration is what gets a whole document discarded.*

> **(physics)** Stopping is not one act but three, and all three have to be
> reachable from the thing the user pressed: refuse to start more, interrupt what
> is already running, and record that it stopped. **(physics)** Whatever the work
> spawned outlives the abstraction you cancelled unless its lifetime was bound to
> that abstraction at creation time — cancelling a caller does not stop a callee
> it merely started. **(ergonomics)** A stop is finished when a reader arriving
> afterwards sees the stopped state, so the surface must confirm from that reader
> rather than infer it from the call returning.
>
> *Scale condition:* clause 2 starts paying at the first spawned child or detached
> task; clause 3 at the first surface that can remount mid-operation. Below that, a
> flag and an optimistic UI flip are honest.
> *Local calibration (do not port):* everything below this block.

---

## Trigger

- "Add a Stop button to this" / "the user needs to be able to abort it"
- "It says cancelled but it's still running" / "the CPU is still pegged after I hit Stop"
- "Cancel doesn't do anything the second time" / "it cancelled the wrong run"
- "The job stays *running* forever once you cancel it"
- "We're still being billed for a run the user stopped"
- "Delete this thing while a scan is writing to it"

If you are about to write a `#[tauri::command] pub fn cancel_*`, a
`token.cancel()`, a `flag.store(true, Ordering::Release)`, a `tokio::select!` whose
first arm is `_ = cancel.cancelled()`, an `onStop` handler, or a
`setIsRunning(false)` next to an unawaited `invoke` — you are in this situation.

## The one way

**Make the stop reachable, make it total, make it provable.** *Reachable:* register
the run through the one registry its cancel command already reads — never a second
map; if the run is a job family, that registry is `BackgroundJobManager` and the
cancel path is `cancel_or_preempt` (`background_job.rs:430`), which also closes the
start-then-cancel race by pre-inserting a cancelled entry. *Total:* the cancel handler
does five things in this order and none of them is optional —
(1) flip the flag/token, (2) write the durable terminal state **conditionally**, so it
cannot clobber a `completed` the worker already wrote (`persist_status_if_running`,
`engine/persist.rs:109`, which returns `bool`), (3) kill the child **tree** by PID
(`engine::kill_process`, `engine/mod.rs:1698`), not `child.kill()`, which on Windows is
`TerminateProcess` on one PID and orphans every grandchild, (4) give the worker a
bounded grace window to settle its metrics and then re-kill anything it spawned during
that window (`engine/mod.rs:1263-1288` — the only correct grace window in the repo),
(5) run the same teardown the success path runs, because RAII does not fire for work
you killed from outside. *Provable:* every layer returns whether it actually stopped
something — `cancel_execution` returns `bool`, `request_build_interrupt` returns
`bool`, `persist_status_if_running` returns `bool` — and the client **awaits the
cancel and then re-reads the snapshot until the status leaves `running`**
(`useN8nWizardTransformHandlers.ts:80-105`, the only client in the repo that does
this), rather than flipping local state and hoping. Bind every spawned child's
lifetime at creation with `.kill_on_drop(true)` **and** register its PID, because
`kill_on_drop` reaches only the immediate child and a dropped `JoinHandle` does not
abort its task at all (`engine/background.rs:908-920` states this in the repo's own
words). And when the work is a `tokio::process::Command`, drain **both** pipes
concurrently before you wait on it, or your kill will land on a process already
deadlocked on a full stderr buffer.

## Mandated primitives

**Server**

- **`src-tauri/src/lib.rs:118` — `ActiveProcessRegistry`.** The one registry for CLI-backed runs. Two shapes, both already built: *single-process domains* (`begin_run:160` — atomically cancels the previous run, hands back its PID to kill, and installs a fresh flag; `try_begin:187` — check-and-install under one lock, documented as the fix for a real `get_id`-then-`set_id` race), and *multi-run domains* (`register_run:282` / `cancel_run:294` / `take_run_pid:322` / `unregister_run:308`, keyed `"{domain}\0{run_id}"`).
- **`src-tauri/src/lib.rs:355` — `RunGuard`.** `register_run_guarded(domain, run_id) -> (Arc<AtomicBool>, RunGuard)`. Move the guard into the `tokio::spawn` block; `Drop` unregisters on normal exit *and* on panic. Used at 6 sites (`lab.rs:120,317,455,704`, `tests.rs:75`, `management_api.rs:1024,1094`).
- **`src-tauri/src/engine/process_session.rs:164` — `ProcessContext`.** `register(&registry, domain, run_id)` → `is_cancelled()` / `cancelled_flag()` / `set_pid()` / `take_pid()` / `request_cancel()`, with `Drop` unregistering (`:241`). **This is the right primitive and it has zero production call sites** (see Deviations S1) — reach for it before you hand-roll a fifth registry.
- **`src-tauri/src/engine/mod.rs:1698` — `kill_process(pid)`.** `pub(crate)`. Windows `taskkill /F /T /PID` (tree), POSIX `kill -9`. The only tree-kill you should call; 16 call sites.
- **`src-tauri/src/background_job.rs:430` — `cancel_or_preempt`.** Cancels a live job **or** pre-inserts an already-cancelled entry when the job id has not been registered yet, so a Stop that beats the spawn is not lost. 6 call sites (`revitalize.rs:601`, `reviews.rs:988`, `query_debug.rs:262`, `schema_proposal.rs:162`, `nl_query.rs:154`, `job_state.rs:169`). Prefer it over `cancel` (`:419`) in every command reachable from a button.
- **`src-tauri/engine/src/execution_engine/persist.rs:109` — `persist_status_if_running`.** Conditional terminal write with retry/backoff, returning `bool` "applied". Its sibling `persist_status_if_not_final:138` is what the worker uses. Together they are the CAS that stops a cancel and a completion from overwriting each other.
- **`.kill_on_drop(true)`** on every `tokio::process::Command` before `.spawn()`. 15 sites; the doctrine is written at `companion/brain/oneshot.rs:50-59`, `companion/session.rs:2276-2283` (*"without kill_on_drop tokio DETACHES it and claude keeps running unattended (a real zombie seen live)"*) and `engine/src/cli_process.rs:584-589`. It is necessary and **not sufficient** — `engine/mod.rs:389-395` states why: *"kill_on_drop terminates only the immediate process, not the descendant tree."*
- **`src-tauri/src/engine/build_session/runner.rs:129` — `SessionExecDir`.** The only `impl Drop` in the tree that removes files. Copy it for any cancellable work that creates a directory.
- **`src-tauri/src/webbuild/devserver.rs:218` — `kill_tree` + `:266` `pid_is_node`.** The best teardown in the repo: tree-kill, then `start_kill()` on the handle, plus a PID-liveness check before killing so a recycled PID can't take down an unrelated process. Currently module-private (see Gaps 2).

**Client**

- **`invokeWithTimeout`** from `@/lib/tauriInvoke` — mandatory for the cancel call too. Only **3** of ~40 cancel-shaped commands use it today (`api/agents/buildSession.ts:91`, `api/webbuild.ts:20,24`); the rest use bare `invoke`, so a wedged cancel hangs the button forever.
- **`src/features/templates/sub_n8n/hooks/useN8nWizardTransformHandlers.ts:80-105`** — the confirm loop. `await cancel…` → poll the snapshot up to 6 × 250ms until `status` leaves `running`/`awaiting_answers` → on failure, surface *"Unable to confirm transform cancellation"* instead of claiming success. There is no shared hook for this yet; this is the shape to extract (Gaps 6).
- **`src/features/plugins/fleet/FleetDebugLogFooterPill.tsx:22-51`** — the Stop *button*. `busy` state, re-entrancy guard, `disabled={busy}`, and label/`title`/`aria-label` all from `t.*`. 2 of 26 Stop affordances do this.
- **`feedback/ConfirmDialog`** for destructive stops (a stop that discards minutes of paid work is destructive). **0** Stop paths use it today.
- **`display/Tooltip`, `buttons/AsyncButton`** — `AsyncButton` already owns the pending state a Stop button needs; see [`inline-busy-state.md`](./inline-busy-state.md).

## Steps

1. **Decide what "stopped" means for this work, and write it down as a status.** Three outcomes are distinguishable and only one of them is `failed`: the user stopped it (`cancelled`), it broke and you know why (`failed`), it took its worker down without a word (see brainiac's `dead`, Convergence 1). Do not reuse `failed` for a user stop — 9 sites do, and the UI then has to string-match `"Cancelled by user"` to tell them apart.
2. **Register the run in the registry its cancel command reads.** `ProcessContext::register(&state.process_registry, domain, &run_id)` for CLI-backed runs; `JOBS.insert_running(id, token, extra)?` for a job family. **Do not create a new `LazyLock<Mutex<HashMap<_, CancellationToken>>>`.** If you think you need one, you need `ProcessContext`.
3. **If the id can repeat, guard the identity.** A registry entry keyed by a client-supplied id must survive a second run under the same id. The repo has solved this four independent times: a monotonic handle (`ocr/mod.rs:56,73-80`), a generation counter (`build_session/mod.rs:78-93`, `companion/session.rs` `AUTONOMOUS_GENS`), self-comparison against the registry's current id (`recipes/mod.rs:76-88`), and cancel-the-previous-on-install (`ActiveProcessRegistry::begin_run:160`). Pick one; do not write a bare `map.remove(&id)` (Deviations S3).
4. **Spawn with the lifetime bound.** `.kill_on_drop(true)` **before** `.spawn()`, then `ctx.set_pid(child.id())` immediately. Both. The first covers future-drop; the second covers the descendant tree.
5. **Drain both pipes concurrently before waiting.** Two `tokio::spawn` drains, or `tokio::join!`, or `wait_with_output()`. Reference: `setup.rs:200-223`. A child blocked on a full stderr pipe is a child your kill has to fight.
6. **Check the flag at every boundary where the cost changes** — after PID registration (closes the spawn race: `runner/mod.rs:1822-1875`), before prompt delivery, before each chunk of a batch. Not in a busy loop.
7. **Write the cancel handler as the five ordered acts.** flag → conditional durable write → tree-kill by PID → bounded grace window with a re-kill → shared teardown. Copy `engine/mod.rs:1203-1298` literally; it is the only complete one.
8. **Run the *same* cleanup the success path runs.** Every early return on a cancel branch must reach the same finalizer. If that is hard, it is because the finalizer is a function call instead of a `Drop` guard — make it a guard (`SessionExecDir`).
9. **Return whether you stopped anything.** `-> Result<bool, AppError>`, not `Result<(), AppError>`. A cancel that cannot fail is a cancel whose failure the UI cannot show. **And then stop** — the registry owns unregistration via `Drop`, the manager owns eviction, the boot pass owns the rows you never got to.
10. **Client: put the button in a busy state, await, then confirm.** `disabled` + a `stopping` label while the promise is in flight; then re-read the snapshot until the status leaves `running` (up to a small bounded number of tries) before you flip local state. On failure, say *"couldn't confirm it stopped"* — never a success toast.
11. **Client: unmounting is not cancelling.** Detaching listeners leaves the backend running, which is usually correct (a long build should survive navigation). If it is *not* correct for this surface, cancel explicitly in the unmount effect — `DriveOcrDrawer.tsx:74-76` is the only site in `src/` that does.

### Prefer a type over a gate

Asked directly: **could a stop path be made impossible to get wrong?** Yes, and the
missing type is smaller than the one [`long-running-job-progress.md`](./long-running-job-progress.md)
proposes — it is a *field*, not a redesign.

**What is broken today is that the cancel channel is optional and the kill is a free
function.** `JobEntry.cancel_token` is `Option<CancellationToken>`
(`background_job.rs:62`), and `set_status` (`:258`) creates entries with
`jobs.entry(id).or_default()` — so calling `set_status` on an unknown or evicted id
*resurrects a registered job with no cancel path at all*. That is not hypothetical:
`ffmpeg.rs:589` writes the out-of-vocabulary status `"encoding"`, `evict_stale:154`
retains only entries whose status is literally `"running"`, so a 40-minute export is
deleted from the registry the moment any second export calls `insert_running` —
**taking its cancel token with it**. `artist_cancel_export` (`ffmpeg.rs:924-931`) then
finds no token, silently skips the cancel, resurrects the entry as `"failed" /
"Cancelled by user"`, and **returns `Ok(true)`**. The UI is told the export stopped;
ffmpeg encodes to completion. One optional field plus one `or_default()` produce a
Stop button that is a lie.

**Where the boundary is** (the job-progress path asks this leaf to settle it): the
`"encoding"` literal is a *status-vocabulary* defect and belongs to that path's
`JobStatus` enum. What belongs **here** is the consequence that survives the enum fix:
even with a correct vocabulary, `cancel_token: Option<_>` and a resurrecting
`set_status` mean "registered" and "cancellable" are different states. Fix the enum and
this still breaks. So:

**Three shapes, in escalating order:**

1. **`cancel_token: CancellationToken`, not `Option`.** Every constructor already has
   one; the `Option` exists only to let `Default` compile for `or_default()`. Make the
   field non-optional and `set_status` take `&mut JobEntry` from a real lookup instead
   of `entry().or_default()`, and "a registered job you cannot cancel" stops being
   representable. This is a ~20-line change.
2. **`insert_running` returns a `JobHandle<E>` that owns both the cancel channel and
   the terminal write** — the shape [`long-running-job-progress.md`](./long-running-job-progress.md)
   proposes for progress. This leaf adds one requirement to that proposal: **the handle
   must also own child-process registration** (`handle.track_child(&child)` setting
   `kill_on_drop` and recording the PID in the same call), so that "spawned a child
   this stop path cannot reach" is a compile-time impossibility rather than the 21
   hand-checked spawn sites it is today. A spawn site that cannot exist without a
   registered cancel path is the whole answer to this leaf.
3. **`cancel` returns what it did.** `pub fn cancel(&self, ..) -> Result<CancelOutcome, AppError>`
   where `CancelOutcome` is `{ Signalled, AlreadyTerminal, NotFound }`, `#[must_use]`.
   Today `BackgroundJobManager::cancel` returns `Result<(), AppError>` and is `Ok(())`
   whether it signalled a token or found nothing — which is exactly why
   `artist_cancel_export` can honestly write `Ok(true)`. Make the outcome a value and
   the six commands that currently discard it stop compiling. The precedent is in-repo
   and three-deep: `persist_status_if_running -> bool`, `cancel_execution -> bool`,
   `request_build_interrupt -> bool`.

**And a fourth, cheapest of all:** promote `webbuild/devserver.rs:218` `kill_tree` +
`:266` `pid_is_node` into `engine::kill_process` and delete the four duplicates. There
is no type here, but there is a single name, and the four copies have already
diverged — two send `SIGKILL`, two send `SIGTERM` with no escalation.

**Propose the type as the fix; the §9 census rule is the ratchet that holds the line
until it lands.**

## The contract (client ↔ server)

Six rules bind the halves. Every one is violated somewhere in this repo.

1. **A cancel command answers whether it cancelled.** `Result<bool, _>` at minimum.
   `cancel_execution:591` and `dev_tools_cancel_kpi_scan:608` do; `cancel_db_query:261`,
   `cancel_credential_design:114`, `cancel_automation_design:346`,
   `cancel_workflow_job:132` and `BackgroundJobManager::cancel` do not — they are
   `Result<(), _>` and unconditionally `Ok`. `artist_cancel_export:924` is worse: it
   hardcodes `Ok(true)`.
2. **The client awaits, then confirms; it never asserts.** The cancel resolving means
   the request was accepted, not that the work stopped. Only a re-read of the same
   snapshot the progress UI uses proves it. 1 of 26 client Stop paths does this;
   4 mutate local state *before* the invoke.
3. **A cancel event is an invalidation signal, not the proof.** Same rule as
   [`long-running-job-progress.md`](./long-running-job-progress.md) contract rule 2.
   There is no dedicated cancellation event in the repo and there should not be —
   cancellation rides the family's existing status event and the client re-reads.
4. **The terminal state a cancel writes must be conditional.** A cancel racing a
   completion must not overwrite it. `persist_status_if_running` is the mechanism;
   `dev_tools_cancel_kpi_scan:617` and `dev_tools_cancel_task_execution:870` write
   unconditionally and can stamp `error` / `cancelled` over a row the worker already
   finished.
5. **The stop vocabulary crosses IPC, so it is shared or it is a bug.** `status_tokens`
   in `en.json` carries `cancelled` for exactly three categories (`execution`, `build`,
   `remote_job`). `automation`, `dev` and `test` have `pending/running/completed/failed`
   and no `cancelled` — so `tokenLabel(t, 'dev', 'cancelled')` falls through to the raw
   English token (`tokenMaps.ts:34-50`) in all 14 locales. Meanwhile the manager's own
   `cancel()` writes `"failed"`, so half the app's cancels are labelled *Failed*.
6. **What the stop leaves behind is part of the stop.** Temp dirs, worktrees, branches,
   PID-file locks and the registry entry itself are the cancel path's responsibility,
   because no destructor runs in a process you killed. `ExecutionWorkspace` leaks a git
   worktree *and* a `personas/exec/<id>` branch on every cancelled isolated execution
   (Deviations T4).

## Anti-patterns

- **A cancel wired to a different registry than the spawn.** The repo has **eight** distinct cancellation registries (Deviations S1). A `cancel_run("test", id)` against a run registered under `"lab"` is a silent no-op that keeps burning. Nothing catches it: both calls compile, both return, neither logs.
- **`child.kill()` as the whole teardown on Windows.** 25 sites. `tokio::process::Child::kill` is `TerminateProcess` on one PID; `claude` alone spawns MCP servers, `npx` and browsers. `artist/mod.rs:783-789` is the sharpest case — the comment acknowledges the child has subprocesses and still kills only the parent.
- **`.spawn()` without `.kill_on_drop(true)`.** 21 of 35 spawn sites. When a `tokio::select!` cancel arm wins, a `timeout` fires, or a `JoinHandle` is aborted, the owning future is *dropped* — and tokio detaches the child rather than killing it. `ffmpeg.rs:961` is the marquee: cancelling a media export drops the future, ffmpeg encodes to completion, and the job reports `failed / "Export cancelled"`.
- **Assuming a dropped `JoinHandle` aborts its task.** It does not, and the repo says so in its own bug-fix comment: `engine/background.rs:908-920` — *"Dropping `subscription_handles`' JoinHandles does not abort the underlying tasks, so any loop spawned under the previous generation is still alive and ticking."* 107 `tokio::spawn` sites, 14 retained handles, 7 `.abort()` calls.
- **A cancel token in a map keyed by a caller-supplied id, removed unconditionally.** `db_schema.rs:30-34` (`deregister_query`) and `vector_kb.rs:786-789` both `map.remove(&id)` with no identity check, so run #1 finishing deletes run #2's live token and run #2 becomes permanently uncancellable. `ocr/mod.rs:73-80` shows the fix in 8 lines.
- **A domain-wide cancel command that takes no id.** `cancel_recipe_execution` (`recipes/crud.rs:249`) takes no execution id at all — it calls `take_id("recipe_execution")` and cancels whatever is currently active. Same for `cancel_credential_design`, `cancel_credential_negotiation`, `cancel_automation_design`, `cancel_auto_cred_browser`, `cancel_setup_install`. Correct only while the domain is provably single-flight, and nothing enforces that.
- **Cancelling and then not waiting.** `vector_kb.rs:203-204` cancels the ingest token, does a single `tokio::task::yield_now().await`, and then drops the vector index and DELETEs three tables. One yield is not an acknowledgement; the ingest task can still be mid-write.
- **A "grace window" without a re-kill.** `engine/mod.rs:1263-1288` is the only place that gets this right: after the 5s window it re-checks `child_pids` because *"the task may have spawned a new child process during the grace period (e.g. chain retry)"*. Every other kill-then-wait (`fix_pass.rs:284-287`, `athena_reaction.rs:634-635`) waits without re-checking.
- **`SIGTERM` with no `SIGKILL` escalation.** `auto_cred_browser.rs:1600` and `ai_artifact_flow.rs:582` send `libc::kill(pid, SIGTERM)` and never follow up. A `claude` that ignores SIGTERM is never killed. There are **zero** kill→wait→SIGKILL ladders in the codebase.
- **Piping stderr and not reading it.** `engine/memory_reflection.rs:338` pipes stderr and never takes it; only stdout is read (`:377`). A child that fills the ~4KB stderr buffer blocks forever, and the only escape is the timeout at `:384`. The hazard is documented seven times elsewhere in the repo (`engine/src/cli_process.rs:565-567` is the canonical statement) — three lines below a comment praising `kill_on_drop`.
- **A cancel path that skips the success path's cleanup.** `ExecutionWorkspace::finalize()` (`dev_tools/workspace.rs:690`) is called from exactly one place — the normal-completion tail (`runner/mod.rs:2973`). All three cancel early-returns (`:1640`, `:1831`, `:1922`) return before it, and `ExecutionWorkspace` has no `impl Drop`.
- **Optimistic UI that toasts success before the call.** `CompetitionCard.tsx:140-152` sets `optimisticCancelled`, calls `processEnded(...)`, fires a **success toast**, and refreshes — *then* calls `cancelCompetition()` unawaited. A backend failure produces a second, contradictory error toast on top of the success one.
- **Clearing local state before the invoke.** `useBuildSession.ts:482-510` aborts, bumps the generation, nulls every ref and calls `resetBuildSession()` — then awaits `cancelBuildSession()`. If the cancel throws, the UI is already in a state that says it worked. 4 sites do this.
- **A Stop button with no busy state.** 24 of 26. `TerminalHeader.tsx:104-112` — the main execution Stop — has no `disabled`, no spinner, no pending label, and a hardcoded English `Stop`. Double-clicking it fires two cancels.
- **`silentCatch` on a cancel.** ~14 sites. A cancel that failed is precisely the thing the user must be told about, because they will walk away believing it stopped.
- **`reset()` as a stop.** `useCorrelatedCliStream.cleanup()` (`:64-69`) only calls the `UnlistenFn`s — it never invokes anything. `useBackgroundPreview.ts:90` and `useN8nTest.ts` expose only reset, so their "stop" detaches the UI from a CLI process that runs to completion.

## Evidence

- **`src-tauri/src/engine/mod.rs:1203-1298` (`ExecutionEngine::cancel_execution`) — copy this one.** The complete stop in seven numbered steps: `:1215` drop a still-queued run out of the queue (a cancel that arrives before the start is a different act); `:1238` set the flag so the worker writes `cancelled`-with-metrics rather than `failed`; `:1244` `persist_status_if_running` as a safety net that cannot clobber a terminal state; `:1257` `kill_process(pid)` — *"to stop API credit consumption"*; `:1263` a 5-second grace window on the `JoinHandle` **with a second kill for any child spawned inside it**; `:1290`/`:1295` tracker and flag cleanup. Returns `bool`. `force_cancel_all_for_persona:1307` is the no-grace variant for when rows are about to be CASCADE-deleted.
- **`src-tauri/src/engine/build_session/mod.rs:366-400` (`cancel_session`) — the multi-domain stop.** One session's work spans two registry domains (`build_session` and `build_session_oneshot`, because post-draft work outlives the CLI); the cancel flips the handle flag, cancels *both* domains, tree-kills the PID, and writes `BuildPhase::Cancelled`. Its doc comment names the concurrency contract and why the frontend's `Promise.allSettled` fan-out is safe.
- **`src-tauri/src/commands/recipes/mod.rs:1-110` — the two-sided contract, written down.** A state diagram, a terminal-state table with the exact `status`/`result`/`error` triple for each outcome, and §"Cancellation race" spelling out the resolution: the cancel takes the registry id and emits immediately; the running task compares `get_id()` against its own `task_id` and exits silently if they differ, so *"the frontend sees exactly one terminal event per execution."* Also the model for documenting a deliberate gap: `:88-95` states that `track_pid: false` means the child is **not** killed on cancel, gives the reason, and names the flag to flip if that ever stops being acceptable. Every cancel path should be this legible.
- **`src-tauri/src/commands/ocr/mod.rs:38-95` — the reused-id guard in 8 lines.** `OCR_CANCEL_HANDLE_SEQ` (a monotonic `AtomicU64`) pairs every registration with a unique handle; `deregister_cancel_token:73` removes the entry **only if the stored handle is its own**, so a finishing run cannot evict a newer same-id run's live token. `CancelGuard:87` makes it RAII. The 45-line doc comment above it is the best statement of the hazard in the repo.
- **`src-tauri/src/lib.rs:160-196` (`begin_run` / `try_begin`).** Two different correct answers to "a second start arrived": displace-and-cancel-the-old (`begin_run`) and refuse-the-new (`try_begin`). `try_begin`'s comment cites the real bug it fixed — a `get_id()`-then-`set_id()` pair racing across an `.await` so both starts passed the guard.
- **`src-tauri/src/webbuild/devserver.rs:149-159, 218-237, 244-290` — the best teardown.** `stop()` = `kill_tree(pid)` then `start_kill()` on the handle. `kill_tree`'s doc comment is the clearest statement of the tree problem: *"On Windows `bun` spawns a `next`/node child, so a bare kill orphans the server — use `taskkill /T`."* `clear_stale_next_lock` + `pid_is_node` add the two things nothing else has: recovery from a kill that never ran (the app was force-quit), and a PID-liveness check so a recycled PID can't kill a bystander.
- **`src-tauri/src/engine/runner/mod.rs:1822-1875` — the cancellation checkpoint.** Checks the flag *immediately after PID registration*, with the comment explaining the exact race it closes (*"if the user cancelled during spawn, the flag is set but the process couldn't be killed"*), then does the full teardown: kill, unregister PID, close logger, emit, durable `Cancelled` write with `duration_ms`. This is the shape — and it is also Deviation T4, because it is the one thing it *doesn't* do that matters.
- **`src-tauri/src/commands/infrastructure/setup.rs:167-230` — both pipes, plus a three-way select.** Two `tokio::spawn` drains, `kill_on_drop(true)` with the reason written down (*"JoinHandle::abort while a child is stuck"*), and a `tokio::select!` over wait / timeout / cancel.
- **`src-tauri/src/engine/build_session/runner.rs:109-146` (`SessionExecDir`).** The only `impl Drop` that removes files; its doc comment names the cancel case explicitly. The template for Deviation T4's fix.
- **`src/features/templates/sub_n8n/hooks/useN8nWizardTransformHandlers.ts:80-105` — the client counterpart, and the only correct one.** `await cancelN8nTransform(id)` → up to 6 × 250ms polls of `getN8nTransformSnapshot` → break when the status leaves `running`/`awaiting_answers` → **on failure dispatch `'Unable to confirm transform cancellation. Please wait and try again.'`** rather than a success state. 1 of 26.
- **`src/features/plugins/fleet/FleetDebugLogFooterPill.tsx:22-51` — the Stop button.** `busy` state + re-entrancy guard + `disabled={busy}`, with `title`, `aria-label` and the visible label all resolved through `t.plugins.fleet.*`.
- **`src/features/plugins/dev-tools/sub_runner/AutoRunBanner.tsx:62` — event-as-invalidation on the stop path.** `await cancelAutoRun(...)` then `rehydrate()`; the banner's truth is always the backend's.
- **`src/features/plugins/drive/ocr/DriveOcrDrawer.tsx:74-76`** — the only unmount effect in `src/` that cancels backend work, with a comment naming the route-change case.

## Deviations found

### Server — the registries

**S1 — eight distinct cancellation mechanisms; the one designed for the job has zero users.**

| # | Mechanism | Where | Reach |
|---|---|---|---|
| 1 | `ActiveProcessRegistry` — `Arc<AtomicBool>` + PID, two sub-shapes | `lib.rs:118-350` | ~14 domains (design, review, test, pipeline, setup, recipe_execution/generation/versioning, negotiation, credential_design, automation_design, auto_cred, build_session, build_session_oneshot) |
| 2 | `BackgroundJobManager<E>` per-entry `Option<CancellationToken>` | `background_job.rs:62` | 19 static managers |
| 3 | `ExecutionEngine`'s three parallel maps — `cancelled_flags` / `child_pids` / `tasks` | `engine/mod.rs` | all persona executions |
| 4 | `BuildSessionManager.sessions[..].cancel_flag` + `generation` | `build_session/mod.rs:60-97` | build sessions |
| 5 | module-local `LazyLock<Mutex<HashMap<_, CancellationToken>>>` | `ocr/mod.rs:50`, `db_schema.rs:16` | 2 |
| 6 | `AppState.kb_ingest_jobs` — `tokio::Mutex<HashMap<kb_id, Token>>` | `lib.rs:449` | KB ingest (`ml`) |
| 7 | generation counters (cancel by bumping, no token to lose) | `companion/session.rs` `AUTONOMOUS_GENS`, `background.rs:919`, `HandleDropGuard` | autonomy chains, scheduler loops, session handles |
| 8 | channel / killer handles | `orchestration/mcp/pending.rs:132` (oneshot resolve), `fleet/headless.rs:59` `PidKiller`, `webbuild::DevServerRegistry` | MCP requests, Fleet sessions, dev servers |

**`ProcessContext` (`process_session.rs:164`) — the primitive built to unify #1 — has zero production call sites.** Its only references are its own module doc, its own tests (`:629,642,652,666`), and the `#[allow(dead_code)]` on `:163` that silences the compiler about it. Mechanisms 5 and 6 are exactly what it was written to prevent.

**S2 — 5 of 36 cancel entry points cannot report failure, and one lies.** `artist_cancel_export` (`ffmpeg.rs:924-931`) hardcodes `Ok(true)` after a `cancel()` that returns `Ok(())` whether or not a token existed. `cancel_db_query:261`, `cancel_credential_design:114`, `cancel_credential_negotiation:111`, `cancel_automation_design:346`, `cancel_workflow_job:132` return `Result<(), _>`. The honest ones — `cancel_execution`, `dev_tools_cancel_kpi_scan`, `dev_tools_cancel_task_execution`, `cancel_pipeline`, `request_build_interrupt` — all return `bool`, and no client checks it (Deviation C2).

**S3 — 2 unguarded token maps lose the newer run's token.** `db_schema.rs:30-34` and `vector_kb.rs:786-789`. `db_schema.rs:22-24` even *has* the displacement half (`if let Some(old) = map.insert(..) { old.cancel(); }`) and is missing only the identity check on removal. `vector_kb.rs` keys by `kb_id`, not job id, so two ingests of one KB collide by construction.

**S4 — 6 cancel commands take no id.** `cancel_recipe_execution`, `cancel_recipe_generation`, `cancel_recipe_versioning`, `cancel_credential_design`, `cancel_credential_negotiation`, `cancel_automation_design`, `cancel_auto_cred_browser`, `cancel_setup_install` all cancel "whatever is active in this domain". Single-flight is enforced for some (`try_begin`) and merely assumed for others.

**S5 — `vector_kb.rs:195-205` cancels then proceeds after one `yield_now()`.** `delete_knowledge_base` removes the token, cancels it, yields once, then drops the vector index and DELETEs `kb_chunks` / `kb_documents` / `knowledge_bases`. The comment calls it *"a brief yield to let the cancelled task observe the token"*. There is no acknowledgement channel.

**S6 — two unconditional durable writes on the cancel path.** `dev_tools_cancel_kpi_scan:617` writes `update_scan(status = "error", error = "Cancelled by user")` and `dev_tools_cancel_task_execution:870` writes `update_task(status = "cancelled")`, neither guarded by "still running". A cancel that lands one tick after the worker finished overwrites a real result.

**S7 — three spellings of a stop.** `BackgroundJobManager::cancel:419` writes status `"failed"` with error `"Cancelled by user"`; nine sites write status `"cancelled"` directly; `dev_tools_cancel_kpi_scan` writes the durable row as `"error"` while the in-memory job says `"cancelled"`. Plus `canceled` (one *l*) in `bindings/BackgroundJob.ts:5`. `workflows.rs:63-68` counts none of them — `"cancelled"` falls into its `_ => {}` arm, so a cancelled job is in `total_count` and in no other counter.

### Server — process teardown

**T1 — 21 of 35 spawn sites do not bind the child's lifetime.** 14 use `.kill_on_drop(true)`; 10 of the remaining 21 are `std::process::Command` (the API has no such method — they need an explicit kill or a PID registry) and **11 are `tokio::process::Command` where it was available and omitted**: `ffmpeg.rs:950`, `ai_artifact_flow.rs:455`, `auth_detect.rs:424`, `cli_capture.rs:627`, `git_ops.rs:58`, `ocr/mod.rs:579` and `:596`, `pipeline_executor.rs:598`/`:602`, `fix_pass.rs:205`, `consolidator.rs:354`, `bun.rs:66`. This is the §9 census rule's baseline.

**T2 — 25 `child.kill()` sites orphan grandchildren on Windows.** Including 12 of the scan families (`context_generation.rs:1510`, `idea_scanner.rs:971`, `kpi_compose.rs:558`, `kpi_scan.rs:868`, `use_case_scan.rs:543`, `workspace_divergence.rs:447`, `workspace_verify.rs:455`, `standards_scan.rs:333`, `task_executor.rs:1094`, `revitalize.rs:331`, `cli_runner.rs:826`, `artist/mod.rs:789`) — all of which spawn `claude`, which spawns MCP servers. `CliProcessDriver::kill()` (`engine/src/cli_process.rs:691-694`) is also single-PID, so its 11 production call sites inherit the defect.

**T3 — one tree-kill, five implementations, two divergent.** `engine::kill_process` (`engine/mod.rs:1698`, 16 callers) is the standard. `webbuild/devserver.rs:218` `kill_tree` (private, strictly better — adds `Stdio::null()` and `.status()`), `auto_cred_browser.rs:1583` `kill_pid` (private, **SIGTERM** on POSIX), plus two un-named inline copies at `ai_artifact_flow.rs:568-585` (**SIGTERM**) and `competitions.rs:1182-1193` (no `CREATE_NO_WINDOW`, so it can flash a console). Two send SIGKILL, two send SIGTERM with no follow-up. Zero escalation ladders exist anywhere.

**T4 — the cancel path skips the success path's cleanup, and leaks a git worktree per cancelled run.** `ExecutionWorkspace` (`dev_tools/workspace.rs:558`) creates `personas-exec-wt-<execution_id>`; `finalize()` (`:690-712`) is called from exactly one site (`runner/mod.rs:2973`, normal completion). The three cancel returns (`:1640`, `:1831`, `:1922`) precede it, and the struct has no `Drop`. Every cancelled isolated execution leaves a worktree directory **and** a `personas/exec/<id>` branch in the user's repo. `TeamWorkspaceCoordinator` (`:207`) has the same shape and admits it in its own module doc (`:55-59`: *"If `cleanup()` is never called (panic, app crash), worktrees and the temp parent dir leak. Future v2: a startup GC sweep…"* — the sweep does not exist). `fleet/pty.rs:555` leaks `fleet-mcp-<session_id>` where the headless lane (`headless.rs:256-262`) cleans it up — an asymmetric leak between two lanes of one feature.

**T5 — no `impl Drop` kills a process.** 18 `impl Drop` blocks (12 production); 6 are cancellation-relevant (`SessionExecDir`, `HandleDropGuard`, `RunGuard`, `ProcessContext`, `BuildTurnGuard`, `ocr::CancelGuard`) and every one of them cleans up *bookkeeping*. Process teardown on drop is delegated entirely to tokio's single-PID `kill_on_drop`. There is no `struct KilledOnDrop(pid)`.

**T6 — two both-piped children are not drained concurrently.** `engine/memory_reflection.rs` pipes stderr at `:338` and never reads it (hang until the `:384` timeout). `engine/healthcheck.rs:249-260` reads stdout to EOF then stderr to EOF sequentially — bounded by a deadline, so it degrades to a spurious "timed out" verdict rather than a hang. Separately, `pipeline_executor.rs:597-633` configures no stdio at all while its comment at `:614-616` claims `wait_with_output` drains both, so every pipeline node's output is silently empty.

**T7 — app exit stops one subsystem out of eight.** `lib.rs:3726-3734` (`RunEvent::Exit`) calls `state.webbuild_servers.stop_all()` and nothing else. Live persona-execution CLI children, every `ActiveProcessRegistry` run, all `BuildSessionManager` sessions, the **second** dev-server registry (`competitions.rs:973` `DEV_SERVERS` — a direct analogue of `webbuild_servers`, with its own `taskkill`, simply not wired up), Fleet PTY/headless `claude` children, pooled MCP stdio servers and Playwright orphans all survive the quit. Four doc comments (`devserver.rs:7`, `:162`, `lib.rs:485-486`, `webbuild/mod.rs:12`) say this runs from "the window-close hook"; there is no `on_window_event` in `lib.rs`.

**T8 — `kill_process`'s doc comment overstates the POSIX branch.** *"Use taskkill /F /T to kill the process tree"* is true on Windows; the `#[cfg(not(windows))]` arm is `kill -9 <pid>`, which kills one process. POSIX has process groups and the repo does not use them (`setsid` / `kill -TERM -<pgid>`: zero occurrences).

**T9 — one PID-liveness guard, reinvented, absent from the standard helper.** `devserver.rs:266` `pid_is_node` and `competitions.rs:983` `is_pid_alive` (whose comment names the hazard: *"can cause `dev_tools_stop_slot_server` to `taskkill`/`kill` an unrelated process if the OS has since reused the PID"*). `engine::kill_process` — the one everybody calls — has no such check, and `engine/mod.rs:1284` kills a PID it read from a map **after a 5-second grace window**, the widest reuse window in the codebase.

### Client

**C1 — 26 Stop affordances, 4 designs, 1 correct.** Await + re-read backend truth: **5** (`AutoRunBanner.tsx:62`, `RunDeskPage.tsx:96`, `GoalDetailDrawer.tsx:187`, `useUseCases.ts:125`, `useN8nWizardTransformHandlers.ts:81`). Await + optimistically patch: **10**. Fire-and-forget: **7**. Set local state *before* the invoke: **4** (`CompetitionCard.tsx:140`, `twinSlice.ts:293`, `ChatTab.tsx:150`, `useBuildSession.ts:482`). Only `useN8nWizardTransformHandlers` confirms the stop actually happened.

**C2 — no client checks the `bool` a cancel returns.** Five commands report whether they cancelled anything; zero call sites read it.

**C3 — 3 of ~40 cancel commands use `invokeWithTimeout`.** `api/agents/buildSession.ts:91`, `api/webbuild.ts:20`, `:24`. The rest use bare `invoke`, so a cancel that wedges leaves the button spinning forever — and 24 of 26 buttons aren't spinning either (C4).

**C4 — 24 of 26 Stop buttons have no busy state.** Only `FleetDebugLogFooterPill.tsx:22-32` and `GoalHandoffPanel.tsx:63-66`. `TerminalHeader.tsx:104-112` — the main execution Stop, rendered for every persona run — has no `disabled`, no spinner and no pending label, so a double-click sends two cancels.

**C5 — 2 of 5 `useCorrelatedCliStream` consumers have no cancel path at all.** `useBackgroundPreview.ts:32` (only `resetPreview():90`) and `useN8nTest.ts:25` (only `resetTestStream`). Both call `stream.reset()`, which is `cleanup()` + zero local state; `cleanup()` (`:64-69`) calls the `UnlistenFn`s and nothing else. The CLI runs to completion with nobody listening. A third, `useQueryDebug.ts:47`, cancels but never calls `cleanup()`, so listeners stay attached to a dead run.

**C6 — 1 success toast on a cancel, and it fires before the call.** `CompetitionCard.tsx:145` (`addToast(dl.competition_cancelled_cleaning, 'success')`) precedes the unawaited `cancelCompetition()` at `:149`; a failure adds a contradicting error toast at `:151`. The other ~24 paths are silent, ~14 of them via `silentCatch`. `useBackgroundRebuild.ts:129` swallows the error and unconditionally sets `phase: 'failed', error: 'Cancelled by user'` — a *failed* cancel renders as a successful one.

**C7 — 0 Stop paths gate on `ConfirmDialog`.** It is imported by 22 files; the intersection with files containing a cancel handler is exactly `ConfirmDialog.tsx` itself. The one confirmation-shaped Stop (`GoalHandoffPanel.tsx:63-66`) is a hand-rolled two-step.

**C8 — 6 of 14 `AbortController`s are flag-only; 3 are never aborted on unmount.** Flag-only (`signal.aborted` guards that discard a stale result but stop nothing): `useHealthDigestScheduler.ts:39`, `useAnnotationData.ts:28`, `:65`, `useEventLog.ts:131`, `N8nSessionList.tsx:158`, and `useBuildSession.ts:329` (which races `abortableStart` and fires a compensating `cancelBuildSession` rather than forwarding the signal — the signal never reaches Tauri). Never aborted on unmount: `useBuildSession.ts:329`, `useAutoCredSession.ts:114`, `N8nSessionList.tsx:158`.

**C9 — no route-level cancellation exists.** Zero navigation effects cancel backend work across 27 navigation-symbol sites. `DriveOcrDrawer.tsx:74-76` is the only unmount→backend-cancel in `src/`. This is mostly correct — `useBuildSession.ts:545-558` deliberately hands off to the global EventBridge so a build survives navigation — but it is a default, not a decision, and nothing marks which surfaces chose it.

**C10 — the Stop label is hardcoded English on the two most-used buttons.** `TerminalHeader.tsx:111` (`Stop`) and `StudioChatInput.tsx:233` (`Stop`, plus `aria-label="Stop Athena"` at `:229` and `'Stop autonomous build'` at `:239`). The other 17 hardcoded cancel strings are modal dismisses and out of scope for this leaf.

**C11 — `status_tokens` has no `cancelled` for three categories.** `automation`, `dev` and `test` carry `pending/running/completed/failed` only, so `tokenLabel(t, 'dev', 'cancelled')` falls through to the raw English token (`tokenMaps.ts:34-50`) in all 14 locales. `execution`, `build` and `remote_job` do have it.

**C12 — 217 of 283 files with an async effect have no staleness guard.** No `cancelled` flag, no `mountedRef`, no `AbortController`, no generation ref — so a resolved promise from a run the user stopped can still `setState`. (Interval hygiene, by contrast, is good: 96 `clearInterval` against 82 `setInterval`; only 2 files leak — `TriggerAddForm.tsx` and `lib/debug/callbackTracker.ts`.) The general staleness question is owned by [`stale-response-guard.md`](./stale-response-guard.md); recorded here because a cancel is the sharpest case.

### Cost

**X1 — cancellation is the app's only lever on paid work in flight, and it is dropped in 21 places.** `engine/mod.rs:1257` is explicit — *"Kill the child OS process to stop API credit consumption"* — and `:1281-1287` re-kills for the same reason. Every unbound spawn (T1) and every single-PID kill of a `claude` child (T2) is a cancelled run that keeps billing. `recipes/mod.rs:88-95` documents the opposite decision for recipes (`track_pid: false`, the child is allowed to finish) with its rationale; the two subsystems reached opposite conclusions and only one wrote it down.

## Gaps in the primitives

1. **`JobEntry.cancel_token` is `Option<CancellationToken>` and `set_status` resurrects entries.** `entry(id).or_default()` (`background_job.rs:258`) makes "registered but uncancellable" a representable state, reachable through the ordinary cancel path. Root cause of the `artist_cancel_export` lie.
2. **The tree-kill primitive is not shared.** `kill_tree` + `pid_is_node` (`devserver.rs:218,266`) is the correct implementation and is module-private; `engine::kill_process` is the correct name and is missing both the liveness check and the POSIX process-group handling. Five implementations, two POSIX behaviours.
3. **No kill escalation.** There is no `kill → wait(t) → SIGKILL` helper anywhere, so the two SIGTERM paths have no second stage and every kill-then-wait is a single shot.
4. **`ProcessContext` has no adoption path.** It exists, it is correct, it is `#[allow(dead_code)]`, and the four registries it would replace all predate or ignore it. Nothing routes a new author to it: it is not in `CLAUDE.md`, not in any `docs/` page, and `background_job.rs` — the thing people actually copy — does not mention it.
5. **No cancellation acknowledgement channel.** Cancel is fire-and-forget in both directions: the server has no way to learn the worker observed the token (hence `vector_kb.rs`'s `yield_now()`), and the client has no way to learn it except by re-reading a status. A `CancellationToken` + a `oneshot` ack, or `cancelled()` awaited to completion, would make both provable.
6. **No client primitive for "cancel and confirm".** `useN8nWizardTransformHandlers.ts:80-105` is 25 hand-written lines that every other Stop path would need. There is no `useCancelWithConfirm({ cancel, readStatus, terminal })` hook, which is why 25 of 26 sites guess instead.
7. **`useCorrelatedCliStream` has no cancel surface.** It returns `cleanup`/`reset`, both listener-only, so "stop" and "stop listening" are the same call at the type level — which is exactly the mistake `useBackgroundPreview` and `useN8nTest` made.
8. **`BackgroundJobManager::cancel` returns `Result<(), _>`.** No outcome value, so no call site can distinguish signalled from not-found, and `#[must_use]` has nothing to attach to.
9. **No test covers any cancel path.** `background_job.rs`'s tests (`:594-645`) cover clamping and ring bounds only — nothing for `cancel`, `cancel_or_preempt`, or the evicted-token case. `process_session.rs` tests `ProcessContext` thoroughly and `ProcessContext` is unused. `src-tauri/tests/` contains zero matches for cancel/abort/kill/orphan.
10. **The stop vocabulary is a string on both sides of IPC** and three of six `status_tokens` categories lack a `cancelled` entry. Downstream of the same root cause as [`long-running-job-progress.md`](./long-running-job-progress.md) Gap 2.

## Convergence check — `brainiac`

`C:/Users/mkdol/dolla/brainiac` (Rust, 8-crate workspace, Postgres). Read-only oracle
sweep. Per the contract's portability rule: a mechanic reinvented there is physics; a
clause with no trace there is suspected local calibration.

**The headline correction.** The job-progress path recorded that brainiac has *no
cancellation*. That is right about the primitive — `tokio-util` is not a dependency,
so `CancellationToken` is not even reachable; `AtomicBool` stop flags: 0;
`tokio::time::timeout`: 0; the word `cancel` appears in **exactly one** line of Rust
source, `main.rs:727`, and it is a comment saying they don't. It is wrong about the
posture. brainiac has a deliberately engineered cooperative shutdown — a
`watch::channel` shared by `axum::serve(..).with_graceful_shutdown` and the worker
(`main.rs:484-521`), SIGINT **and** SIGTERM (`:599-632`, whose doc comment records that
a ctrl_c-only future had left the whole path dead code in the primary deploy target),
and every idle/backoff sleep `select!`-ed against it (`:647-661`). The correct
characterisation is **cooperative stop at tick granularity, with an explicit refusal to
interrupt below it**:

> `main.rs:722-727` — *"Let the in-flight batch run to completion before honouring
> shutdown — we don't cancel a tick mid-source, we just stop starting new ones."*

**Independently reinvented — treat as physics:**

- **Refuse to start more is a separate act from interrupt what is running.** brainiac
  implements only the first and says so. That is step 1 of this path's five and the
  only one it needs, which is the strongest possible confirmation that the acts are
  genuinely separable.
- **Stop granularity must be declared.** brainiac's is one tick (batch 8, concurrency 4,
  `worker.rs:41-43`); the `shutdown` receiver is deliberately *not* passed into `tick`.
  This repo's is one execution. Neither is implicit.
- **A wall-clock reaper stands in for a "the work stopped" signal.** Visibility timeout
  300s (`worker.rs:43`, tuned to *"comfortably exceed the slowest full chain"*) plus
  `RUNNING_STALE = "2 hours"` (`sweeps.rs:46`, *"a `running` row older than this is
  treated as crashed"*). Same shape as this repo's `sweep_stale_running` and its boot
  passes, arrived at independently.
- **A three-outcome terminal split.** `ok` / `failed` / `dead` (`queue.rs:16-30`) —
  adjudicated failure vs crash-poison. This repo collapses a user stop, a timeout and a
  handler error into `"failed"` (S7). brainiac's split is the argument for making
  `cancelled` its own outcome rather than a `failed` with a magic error string.

**Done differently — one worth stealing, one that is the type-over-gate answer:**

1. **Reaping fused into the claim transaction** (`queue.rs:117-133`) — the attempt
   ceiling is enforced where delivery happens, so a deterministic crasher terminates
   with no separate reaper, cron or boot hook.
2. **Zero `tokio::spawn` in any HTTP handler** (all three in the workspace are outside
   the request path). Every handler's work therefore lives *in the request future*, so
   axum dropping that future on client disconnect genuinely stops the work — including
   rolling back the `sqlx` transaction, whose own `Drop` does it. **brainiac gets
   correct client-disconnect cancellation for free, structurally, without a
   cancellation primitive, because it never detached the work from the thing that can
   be cancelled.** That is this path's clause 2 as a design constraint rather than a
   discipline, and it is the same argument as this document's type-over-gate proposal.
   Its one violation is the exception that proves it: `POST /v1/ops/sweeps/{kind}/run`
   (`sweeps.rs:205-261`) is the *only* human-triggered long-running operation in the
   service, and it is the only place that detaches — `tokio::spawn` with the
   `JoinHandle` discarded, no queue row, no shutdown await, cleaned up only by the
   2-hour staleness reaper. It has a start button and no brake.

**Absent there, present here — the boundary of what ports:**

brainiac spawns **zero** child processes (no `Command::new`, no `tokio::process`,
anywhere — even git publishing writes files and leaves committing to CI) and has
**one** `impl Drop` in the entire workspace, in a test fixture. So T1/T2/T3/T5/T8/T9 —
`kill_on_drop`, tree kills, PID reuse, POSIX process groups, Drop guards that kill —
have no analogue there at all. **This confirms the brief's hypothesis with one
correction.** Cancellation itself is not desktop-specific: brainiac's one interactive
long-running operation needed a stop and improvised a 2-hour reaper instead, which is
the tell that the requirement was real. What *is* desktop-specific is the **subprocess
teardown half**: cancelling work that is a child process tree, on Windows, where there
are no process groups, is a constraint an HTTP service over a connection pool does not
have. Mark clauses 4, 5 and the whole of T1–T9 as local calibration; mark the
five-act structure, the acknowledgement requirement, and "bind the work's lifetime to
the thing that can be cancelled" as physics.

## The missing gate

Nothing gates any of this today. Every deviation above shipped under a green
`npm run check`, a green `cargo clippy -- -D warnings` and a green `cargo test`.

### The semantic condition

**Work that has been started in a way the stop path cannot reach.** That is the
condition, and it has three faces in this repo: a child process whose lifetime was
never bound to the future that gets cancelled (T1), a run registered in a map its
cancel command does not read (S1), and a cancel outcome no caller can observe (S2).

Only the first is countable by a machine today. The other two are cross-file absences —
see *The parts no census rule can cover*.

**The signal below is a manifestation.** It keys on Rust's `tokio::process` builder
idiom because that is the shape the condition wears here. **A sibling repo must
re-derive its own proxy for the same condition:** *what does this stack do when the
thing that owns the work is discarded — and is there any way to start work that does
not inherit that discard?* In brainiac the equivalent condition is nearly
unrepresentable (no subprocesses at all, and no `tokio::spawn` in a request path, so
the work is always inside the future that gets dropped), which is why the same signal
would report a permanent zero there — and why its one true violation
(`sweeps.rs:261`, a bare `tokio::spawn` with the `JoinHandle` discarded) needs a
*different* proxy: `tokio::spawn` outside the request path with the handle dropped.

**Preconditions this signal depends on, stated so they can be checked before
porting:** (a) the repo spawns children through a builder that offers a
lifetime-binding method (`kill_on_drop`) — if it moves to `std::process` or a wrapper,
the rule reports zero; (b) the builder chain from `Command::new(` to `.spawn()` fits in
~1200 characters; (c) real work pipes at least one stream. None of these is semantic,
which is why the runner's `floor` and zero-match assertions are load-bearing here.

### Census rule (validated)

Do **not** paste this into `scripts/census/rules.json` yourself — the orchestrator
merges it. Validated against the runner at commit `cf14b9832`.

```json
{
  "id": "unbound-child-lifetime",
  "goldenPath": "docs/concepts/golden-paths/cancelling-in-flight-work.md",
  "title": "Child process spawned without binding its lifetime to the cancellable future",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "Command::new\\((?:(?!kill_on_drop)[\\s\\S]){0,1200}?Stdio::piped\\(\\)(?:(?!kill_on_drop)[\\s\\S]){0,1200}?\\.\\s*spawn\\s*\\(\\s*\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a piped child process spawned with no `.kill_on_drop(true)` anywhere between `Command::new(` and `.spawn()` — so when a `tokio::select!` cancel arm, a `tokio::time::timeout`, or a `JoinHandle::abort` drops the owning future, tokio DETACHES the child instead of killing it and the work the user just cancelled keeps running (and, for CLI children, keeps billing)"
  },
  "baseline": { "files": 11, "matches": 12 },
  "floor": 900
}
```

**Measured.** 963 Rust files walked (matches `shared-facts.json` `rust.files: 963`
exactly), **11 files / 12 matches**, `--check` exits 0.

**Precision, hand-verified 12/12 — with the severity split stated rather than hidden.**
Nine are unambiguous: `ocr/mod.rs:579`, `:596` (both `claude` CLI backends — the file
that gets the reused-id race right detaches its own child), `engine/src/cli_process.rs:423`
(`run_claude_cli`, the shared one-shot helper), `artist/ffmpeg.rs:950` (the marquee —
cancel drops the future and ffmpeg encodes to completion),
`credentials/ai_artifact_flow.rs:455`, `build_session/fix_pass.rs:205`,
`project_tracking/consolidator.rs:354`, `webbuild/bun.rs:66`,
`dev_tools/git_ops.rs:58`. Two are *aware but still drop-unsafe* —
`credentials/auth_detect.rs:424` and `credentials/cli_capture.rs:627` both spawn
outside their timeout specifically so they can kill on the deadline, and
`auth_detect.rs:427-429` states the exact hazard the rule keys on
(*"Dropping a tokio::process::Child without calling kill() orphans the process on both
Unix and Windows"*) — but a manual kill in the timeout branch cannot run when the
*outer* future is dropped. One is arguable: `fleet/headless.rs:124` deliberately
detaches into a session registry, so `kill_on_drop` would be wrong — except its owner's
killer (`PidKiller`, `:59-73`) is a single-PID `sysinfo` kill, so Fleet's `claude`
grandchildren survive anyway.

**No `exclude` entries.** `fleet/headless.rs` is the only exemption candidate and
exempting a whole file to excuse one deliberate spawn is how an allowlist becomes a
place violations hide — the contract's own warning. It stays counted, with the reason
written above.

**Verified through a second, independent implementation before baselining,** per the
contract. A subagent hand-classified all 120 `Command::new` lines and all 35 `.spawn()`
sites in `src-tauri/src/` with no knowledge of the regex, and produced 11 unguarded
`tokio::process` spawns. The census matches 10 of those 11 — it correctly skips
`pipeline_executor.rs:598`, which configures no stdio at all — and adds
`engine/src/cli_process.rs:423`, which the hand sweep missed because it scoped to
`src-tauri/src/` and not the extracted `src-tauri/engine/` crate. Two implementations,
one disagreement each way, both explained.

**Known recall limits, stated rather than hidden.** (a) The 10 `std::process::Command`
spawn sites are invisible: that API has no `kill_on_drop`, so the fix is a PID registry
and the signal would be a different one. (b) `pipeline_executor.rs:598` and
`webbuild/devserver.rs:71` use `Stdio::null()` and are skipped — deliberate, since the
`piped` clause is what removes five `explorer`/`open`/`xdg-open` "reveal in file
manager" false positives that an untightened version reported. Dropping the `piped`
requirement gives 15 files / 20 matches at ~40% precision; the tightened form was
chosen and the trade recorded. (c) The 1200-character window can attribute a match to
an earlier `Command::new` in the same file when two are close together
(`git_ops.rs` reports the builder at `:25` for the spawn at `:58`); the *count* is
right, the reported line is the start of the matched span.

**How it fails loudly if its own precondition is absent** — all five verified by
running the runner, not asserted:

| Perturbation | Result |
|---|---|
| baseline `matches: 11` (real 12) | `[drift] matches rose 11 -> 12 (+1)`, **exit 1** |
| baseline `matches: 13` (real 12) | `[drift] matches dropped 13 -> 12 (-1) without the baseline moving`, **exit 1** |
| `floor: 5000` (walk sees 963) | `[structural] walked 963 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN`, **exit 1** |
| spawn idiom renamed so the pattern matches nothing | `[structural] matched zero files anywhere`, **exit 1 in report mode too** |
| `roots` narrowed to one directory (simulating a moved crate) | `[structural] walked 1 files but floor is 900`, **exit 1** |

`floor: 900` against 963 walked leaves ~6.5% headroom — tight enough that deleting a
crate or breaking the `.rs` glob fails structurally rather than reporting a clean tree.
The zero-match case is the one that matters most here: this rule's whole premise is a
naming idiom, and it must scream rather than go green if the idiom moves.

### The parts no census rule can cover

Three of this leaf's most expensive defects are **relational**, and a regex cannot
check that two things refer to each other.

1. **A run registered in one registry and cancelled through another** (S1, 8
   mechanisms). The signal is a *join*: does the map a `cancel_*` command reads contain
   the key the corresponding `start_*` writes? Right host is a small Rust test (not a
   script) that exercises start→cancel→assert-stopped per family — and the reason it
   does not exist is Gap 9: there is no cancel test anywhere. The honest fix is the
   type: one `JobHandle` that owns the registration means there is no second registry
   to be wrong about.
2. **A cancel outcome nobody can read** (S2/C2). An AST rule could flag
   `-> Result<(), AppError>` on a `pub fn cancel_*`, but the real fix is a `#[must_use]`
   `CancelOutcome` return type, after which the compiler is the gate.
3. **The cancel path skipping the success path's cleanup** (T4). This is control-flow
   reachability — "does every early return on a cancel branch reach `finalize()`" — and
   it is exactly what a `Drop` guard makes unnecessary. Convert `ExecutionWorkspace` and
   `TeamWorkspaceCoordinator` to the `SessionExecDir` shape and the question stops being
   askable.

The client half — a Stop that mutates local state before or without awaiting its
invoke (C1's 11 fire-and-forget + set-state-first sites, plus C4's 24 missing busy
states) — is structural rather than lexical: the condition is "a `setState` textually
preceding, or not sequenced after, an `invoke` in the same handler". That is an ESLint
`no-restricted-syntax`/AST job with `RuleTester` fixtures, not a census pattern, and it
composes with the census the way [`inline-busy-state.md`](./inline-busy-state.md) §9
describes: the rule reports, the census ratchets. Recorded here as the client half's
gate, not claimed as this path's measured one.
