# Golden path — Long-running job progress

> Situation node: `backend-runtime/job-coordination/long-running-job-progress` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `2d168ac4c`. Ground-truth sweep: all 963
> `src-tauri/**/*.rs` files walked by the census runner; `background_job.rs` read
> in full; all **19** static `BackgroundJobManager` instances (18 files) and all **23**
> `insert_running`/`resume_running` sites read; all **15** snapshot-read call
> sites read; the second job system (`src-tauri/src/companion/jobs/`, 3,055
> lines) read; **11** boot-time recovery passes and ~35 durable lifecycle tables
> enumerated; on the client, all **5** `useCorrelatedCliStream` call sites, all
> **3** `useBackgroundSnapshot` call sites and all **8** hand-rolled job polls
> read individually over 4,830 `src/**/*.{ts,tsx}` files. Corpus counts cite
> [`shared-facts.json`](../shared-facts.json); command counts cite
> [`polling-loop.md`](./polling-loop.md) (1,673). Every number below came from
> reading source, not estimation.
> This leaf is **two-sided and fused**: it absorbed a server-side
> "poll-a-snapshot command" entry and a client-side "streaming generation
> session" entry. Both halves and the contract between them are stated.
> **Deviations** is a fix backlog; it migrates to `violating` cells on ingest.

**Adjacent leaves — cross-reference, do not absorb.**
[`polling-loop.md`](./polling-loop.md) owns *cadence*: `usePolling`,
`useBackgroundSnapshot`'s decay schedule, the `PollingCoordinator`, the server
read-cost/TTL-cache half, and the "no delta reads exist" measurement. This path
owns what a job must *be able to answer* when polled, and what happens to it
when nobody is polling. Where the two meet — a terminal poll's cadence — that
path is authoritative and this one defers.
`client-runtime/data-fetching/backend-to-frontend-events` owns the emit
transport. This path owns only the rule about what an event may and may not
carry (§The contract, rule 2).
[`page-loading.md`](./page-loading.md) owns what the surface renders while the
job is starting.

---

## Principle

*Three sentences, no repo path, no primitive name, no count — the layer a
sibling repo on another stack can adopt as-is. Each clause is tagged with its
warrant, per the [portability test](../research/portability-test.md)'s
finding that unmarked local calibration is what gets a whole document
discarded.*

> **(physics)** A job that has started must be readable — its state, its
> progress and its outcome — by a client that was not listening when it
> started. **(physics)** A job that has started must reach a terminal state
> even if the worker dies, which means something outside the worker's process
> has to be able to close it. **(ergonomics)** Progress is one authority, not
> two: read it from one place that fuses the durable record with the live
> worker, and let events say only *"read again"*.
>
> *Scale condition:* the third clause starts paying at roughly the second job
> family. Below that, a single hand-rolled poll is honest.
> *Local calibration (do not port):* everything below this block.

---

## Trigger

- "This scan/build/export takes minutes — show the user what it's doing"
- "Poll until the job finishes" / "watch the status until it's done"
- "The progress bar resets when I switch tabs" / "the banner disappears on reload"
- "It says still running but nothing is happening" / "I can't start it again, it thinks one is already running"
- "Stream the CLI output into a log panel"
- "Add a Cancel button to this background task"

If you are about to write `BackgroundJobManager::new(...)`, a `tokio::spawn`
that will `set_status(..., "completed")` at the end, a `status: String` field on
a run row, a `useState<string[]>` for streamed lines, or a `useEffect` that
calls `get*Status(jobId)` on a timer — you are in this situation.

## The one way

Give the job **two authorities and one reader**. The durable row owns identity,
tallies and terminal state; the in-memory worker owns liveness and the output
ring; **one command fuses them and is the only thing any client reads** —
`dev_tools_get_auto_run_status` (`task_executor.rs:1712-1730`) is the shape:
the row is the truth, the registry contributes a single `live: bool`, so a row
left `running` by a hard kill reports `live: false` instead of a banner that
never clears. On the server, register through `BackgroundJobManager` and read
back **only** through `get_task_snapshot` / `get_snapshot` / `get_snapshot_with`
/ `list_snapshots` — those four are the only paths that run
`sweep_stale_running` + `evict_stale` (`background_job.rs:471,490,515,529`), so a
hand-rolled `JOBS.lock()` + `jobs.get()` reader silently opts the whole job
family out of stale detection. Write the durable row's terminal state from the
**frame**, not the handler — `companion/jobs/mod.rs`'s `worker_tick:372-449`
takes a `Result<String, AppError>` from the handler and writes `mark_completed`
or `mark_failed` itself, so "started but never finalised" cannot be expressed by
a handler at all — and close the panic hole with a boot pass
(`recover_orphans:169`) rather than a timeout that cannot fire for a process
that is gone. Emit only high-level milestones (`emit_line`); route noisy output
to `record_line` so it stays in the ring and never crosses IPC. On the client,
hold **no** progress in component state: subscribe to the job's events purely as
an invalidation signal and re-read the fusing command — `AutoRunBanner.tsx:44-60`
does exactly this and says why ("re-reading the backend is both simpler and more
truthful than patching a local shape"). Reach for the cadence primitives named
in [`polling-loop.md`](./polling-loop.md); never a bounded `for` loop with
`await sleep`.

## Mandated primitives

**Server**

- **`src-tauri/src/background_job.rs` — `BackgroundJobManager<E>`** (`:102`). One `static` per job family, `const fn new(lock_error_msg, status_event_name, output_event_name)`. Gives you: an evicting store, a 500-line/4KB-clamped tail ring (`MAX_LINES:24`, `MAX_LINE_BYTES:33`, single chokepoint `push_ring:288`), a cancel token, poison-recovering reads (`lock_or_recover:141`), a 10m30s stale-running sweep (`:188`), a 30-minute TTL evict (`:153`), and LRU capping (`:160`).
- **`get_task_snapshot(job_id, map_extras)`** (`:523`) → `BackgroundTaskSnapshot<T>` (`:576`) — **the read path.** Typed, `#[serde(flatten)]`s your per-family extras, carries `elapsed_secs`, and runs the sweep + evict before answering. `get_snapshot` (`:469`), `get_snapshot_with` (`:509`), `list_snapshots` (`:488`) are the other three legal readers.
- **`emit_line` (`:306`) vs `record_line` (`:327`) vs `record_streamed` (`:339`).** `emit_line` writes the ring *and* crosses IPC — milestones only. `record_line` writes the ring only. `record_streamed` is the same as `record_line` but keeps the `(app, id, line)` closure shape so switching a CLI streamer is a one-token rename under `-D warnings`.
- **`insert_running` (`:230`) / `ensure_not_running` (`:218`) / `resume_running` (`:381`)** — the single-flight guard. All three compare `status == "running"` literally.
- **`src-tauri/src/companion/jobs/mod.rs` — the durable queue.** `enqueue_task:227`, `pop_next_queued:316` (compare-and-swap claim: `UPDATE … WHERE id = ?2 AND status = 'queued'`, so two workers cannot double-claim), `worker_tick:372`, `mark_completed:341` / `mark_failed:353`, `recover_orphans:169`, `prune_terminal_jobs:194` (30-day retention), `JobEventSink:44` (App | Noop — desktop vs headless). **Use this, not `BackgroundJobManager`, when the job must survive a restart.**
- **`JobProgress` (`companion/jobs/mod.rs:127`)** — `report(msg)` (`:133`) and `report_progress(current, total, msg)` (`:155`). The repo's **only** determinate-progress reporter and its only handle-shaped progress channel. Handed to the handler by `worker_tick:389-392`.
- **RAII precedent to copy: `RunGuard` (`src-tauri/src/lib.rs:353-366`)** — "Move this into a `tokio::spawn` block to guarantee cleanup on both normal completion and task panic." Also `HandleDropGuard` (`engine/build_session/mod.rs:73-93`), which additionally generation-checks so a stale guard cannot evict a newer handle. There are **19** `impl Drop` guards in `src-tauri/src/` — the pattern is native here.

**Client**

- **`src/hooks/execution/useCorrelatedCliStream.ts`** — the live half. `{ outputEvent, statusEvent, idField, onFailed?, onOutputLine?, onStatusEvent?, bufferLines? }` → `{ runId, phase, lines, setLines, setPhase, start, cleanup, reset }`. Correlates by `idField` (`:80`, `:109`), validates every payload against a zod schema (`:82`, `:111`), holds all three callbacks in refs so `start` stays stable (`:53-62`), dedupes consecutive identical lines (`:92`), and caps at 5,000 lines × 4,096 chars (`:13-15`). **`bufferLines: false` when the consumer owns its own buffer** — otherwise you keep two 5,000-line copies.
- **`src/hooks/utility/data/useBackgroundSnapshot.ts`** — the reconciling half (terminal poll). Contract, decay schedule and dep-array hazard are documented in [`polling-loop.md`](./polling-loop.md) §Mandated primitives and Gaps #8; do not restate them here.
- **`src/hooks/utility/data/usePersistedContext.ts`** — `{ key, maxAge, validate, getSavedAt, onRestore }`. Survives a full window reload by parking the job id (not the progress) in storage and re-attaching. Two users: `useN8nTransform.ts:110-116`, `useCreateTemplateActions.ts`.
- **`src/features/plugins/companion/TaskTag.tsx:24-32`** — the only determinate progress bar in the app; renders `progressCurrent`/`progressTotal` when both are present, falls back to `progressText`.

## Steps

1. **Decide whether the job may outlive the process.** If a restart mid-job must be recoverable — anything a user will still care about in five minutes — the durable row is mandatory and `companion/jobs` is the closer model. If it genuinely cannot outlive the window (an ffmpeg preview, a query-debug pass), an in-memory `BackgroundJobManager` alone is honest, **but you still owe step 6**.
2. **Define the status vocabulary once, as a type, not as string literals.** See *Prefer a type over a gate* below. Until that lands, use exactly `running` / `completed` / `failed` — the three the manager's own `sweep_stale_running`, `evict_stale`, `insert_running` and `get_workflows_overview` compare against. Do not invent a fourth.
3. **Register.** `JOBS.insert_running(id, cancel_token, extra)?` then `set_status(&app, &id, "running", None)`. `insert_running` already rejects a duplicate live job — do not add your own guard.
4. **Spawn inside `AssertUnwindSafe(...).catch_unwind()`** and write a terminal status in the panic arm too. 15 of the 16 job files do this (`twin.rs` is the exception — see Deviations). Better: hold a Drop guard so you cannot forget.
5. **Report.** Milestones through `emit_line` (`[Milestone]`, `[Summary]`, `[Error]` — the de-facto prefixes across every family). Per-token / per-tool noise through `record_line` / `record_streamed`. If the work is countable, report determinate progress — and persist it, because an event-only counter is invisible to every reader that arrives late.
6. **Write the read command — and write it before the UI.** One `#[tauri::command]` returning a **typed** struct built by `get_task_snapshot`, fusing the durable row (identity, tallies, terminal state) with the registry (liveness, ring tail). Never `serde_json::Value`; never `JOBS.lock()` + `jobs.get()`. **And then stop** — the manager owns the sweep, the eviction and the clamping from here.
7. **Register the family in the aggregator** — `commands/infrastructure/workflows.rs:52-58` and the `cancel_workflow_job` match at `:139-159`. Both are hand-maintained lists; a family that is not in them is invisible to the app's own "all background jobs" view and cannot be cancelled from it.
8. **Add the boot pass in the same commit as the durable table.** `UPDATE <table> SET status='failed', error_text = COALESCE(error_text,'') || ' [orphaned by process restart]' WHERE status='running'`, called from the `.setup(` block in `src-tauri/src/lib.rs` (not from a frontend-invoked command — see Deviations R3). This is the only mechanism that can close a job whose process is gone; an in-memory timeout cannot fire for a worker that does not exist.
9. **Client: subscribe, then re-read.** `useTauriEvent`/`listen` on the status + complete events, and in the handler call the fusing command. Do **not** patch a local shape from the event payload unless the payload is provably complete and the surface is also correct after a cold mount.
10. **Client: re-attach on mount.** If a job id is in a store or in `usePersistedContext`, read its snapshot once on mount — the user may have navigated away and come back after the completion event fired. `ContextMapPage.tsx:352-382` documents exactly this case.
11. **Client: for live output, `useCorrelatedCliStream` with `bufferLines: false`** when a store owns the buffer, plus `useBackgroundSnapshot` for restore. Cadence belongs to [`polling-loop.md`](./polling-loop.md); never write a `for` loop with `await sleep`.

### Prefer a type over a gate

Asked directly: **could a job be made unable to report progress without
registering its lifecycle?** Yes — and this repo has already built the answer
twice, in the wrong two places.

**What is broken today is that `status` is a `String`.** `JobEntry.status`
(`background_job.rs:59`) is compared against `"running"` by literal in four
places that each mean something different: `sweep_stale_running:192` (should
this be timed out?), `evict_stale:155` (may I delete this?),
`insert_running:239` / `ensure_not_running:221` (is one already in flight?), and
`workflows.rs:63-68` (which counter do I bump?). `ffmpeg.rs:589` writes
`"encoding"`. All four predicates read `false` for it, so a media export is
**never stale-swept, never blocks a duplicate start, is evicted after 30 minutes
while still encoding** (taking its cancel token with it, so `:929` finds
nothing) and is counted in `total_count` but in none of running/completed/failed.
One string literal, four silent behaviour changes. A `#[derive(...)] enum
JobStatus { Running, Completed, Failed, Cancelled }` with the four predicates as
methods makes that combination unrepresentable and costs one migration.

**Two shapes, in escalating order:**

1. **`insert_running` returns a `JobHandle<E>` guard instead of `()`.** The
   handle owns the emit channel (`handle.milestone(..)`, `handle.record(..)`,
   `handle.progress(cur, tot)`) and the terminal write
   (`handle.complete(..)` / `handle.fail(..)`), both taking `self`. `impl Drop`
   writes `failed("worker dropped without finalising")` if neither was called.
   A job cannot then emit progress without holding a live registration, and
   cannot be dropped in a non-terminal state — *including on panic*, which is
   what the 15 hand-written `catch_unwind` arms are currently simulating by
   hand and `twin.rs` is not simulating at all. The precedent is in-repo and
   proven: `RunGuard` (`lib.rs:353-366`) and `HandleDropGuard`
   (`engine/build_session/mod.rs:73-93`).
2. **The frame owns the terminal write.** `companion/jobs`'s `worker_tick:372`
   already achieves the same guarantee procedurally: the handler's signature is
   `async fn(..) -> Result<String, AppError>`, and `worker_tick` — not the
   handler — calls `mark_completed` or `mark_failed` (`:400`, `:419`). A handler
   *cannot* return without a terminal write. This is strictly stronger than the
   guard for the cases it covers, because it also forbids writing the *wrong*
   terminal state. It has one hole (a panic in `dispatch_handler` is not caught),
   and that hole is closed by `recover_orphans` at the next boot rather than by
   more discipline. **Convert the `BackgroundJobManager` families to this shape
   and the guard becomes unnecessary for them.**

**And a third, cheaper than either:** make the family register itself.
`workflows.rs:52-58` is a hand-maintained `Vec<(Vec<_>, &str)>`; 14 of 19
families are missing from it, and adding a 19th manager breaks nothing, warns
nothing, and appears nowhere. An `inventory`-style registration inside
`BackgroundJobManager::new` — or simply making `new` take the `job_type` label
and return a value the aggregator iterates — makes "a job family the overview
cannot see" unrepresentable. `job_type: String` in `cancel_workflow_job:139`
should be that same enum, so an unknown type is a compile error rather than
`AppError::Validation` at runtime.

**Propose the type as the fix; the §9 census rule is the ratchet that holds the
line until it lands.**

## The contract (client ↔ server)

Five rules bind the halves. Every one is violated somewhere in this repo.

1. **The snapshot must be sufficient on its own.** A client that arrives late —
   remounted, reloaded, listener registered a tick after the emit — must be able
   to reconstruct the whole picture from one read. Anything an event carries that
   the snapshot does not is data that only the lucky client sees. Violated by S9
   (progress fields nulled by `map_row`), S2 (three families with no snapshot at
   all) and S4 (entry deleted at terminal).
2. **An event may say what changed; it may not be the only place that says it.**
   The event is an invalidation signal. Patching local state from a payload is a
   *performance optimisation*, legal only when the surface is also correct after a
   cold mount — `devToolsTaskSlice.patchTask` earned that exemption by measuring
   the alternative (`:49-62`); `useCorrelatedCliStream`'s five consumers did not.
3. **Terminal state is written by whoever can still write it.** The worker writes
   it when it can. When the worker is gone, only a boot pass can — so a durable
   status column and its boot reconciliation are a single unit and belong in the
   same commit. An in-memory timeout is not a substitute; it cannot fire for a
   process that does not exist (R1).
4. **The status vocabulary is shared, or it is a bug.** Server predicates
   (`sweep_stale_running`, `evict_stale`, `insert_running`, `workflows.rs:63-68`)
   and client branches (`ContextMapPage.tsx:370-375`,
   `FactoryOverviewTab.tsx:316`, `AutoRunBanner.tsx:73-74`) all match on the same
   strings across an IPC boundary with no shared type. One out-of-vocabulary
   value changes four server behaviours silently (S3) and strands a client loop
   for 300 seconds (C3).
5. **The cadence is a budget drawn against the snapshot's size, not just its
   query cost.** [`polling-loop.md`](./polling-loop.md) rule 1 sizes a poll by
   the command's SQLite cost; this leaf adds the payload. A `BackgroundJobManager`
   snapshot clones its entire ring on every read (P1) — up to ~2MB per job per
   tick into a WebView JS heap, on a command that touches zero SQLite. Cheap on
   the server, expensive on the wire: pass a tail bound, or emit and let the
   client accumulate.

## Anti-patterns

- **Reading the registry through `JOBS.lock()` + `jobs.get()`.** The four snapshot accessors are the *only* paths that call `sweep_stale_running` and `evict_stale` (`background_job.rs:471,490,515,529`). A raw-lock reader means the 10m30s stale timeout **never fires for that job family**, ever. 9 occurrences in 6 files (§9). Failure mode: a job whose worker died sits at `running` until the process exits, and `insert_running` refuses every retry with "Job is already running".
- **A `BackgroundJobManager` with no read command at all.** `MEDIA_EXPORT_JOBS`, `CREATIVE_JOBS` and `TASK_EXEC_JOBS` populate the 500-line ring and expose no way to read it. Their entire progress contract is the event stream, so a client that remounts, reloads, or registers its listener a tick late has no recovery path. It also means their stale sweep can never run, because nothing ever calls a sweeping accessor.
- **`remove()`-ing the entry in the terminal arm.** `ffmpeg.rs:631` and `:641` delete the job immediately after emitting the terminal status. A poll that lands one tick later gets nothing; correctness depends entirely on the client having heard one event.
- **A status string outside the manager's vocabulary.** `"encoding"` (`ffmpeg.rs:589`) — see *Prefer a type over a gate*. Same class, wider blast radius: `"cancelled"` at 9 sites, while the manager's own `cancel()` writes `"failed"` with `error: "Cancelled by user"` (`background_job.rs:424`). Two cancel representations means every consumer must handle both, and `workflows.rs:63-68` handles neither (`_ => {}`).
- **A durable status column with no boot pass.** `dev_scans` — the shared row for *every* scan family — has no boot reconciliation and no periodic sweep. `dev_auto_runs`'s own schema comment (`incremental.rs:4495-4497`) calls it "the restart-surviving record" and it has neither. An in-memory timeout is structurally incapable of closing these.
- **A boot pass wired to a frontend-invoked command.** `companion::jobs::recover_orphans` and the `companion_dev_op` recovery both run from `companion_init` (`commands/companion/mod.rs:192`, `:229-235`), not from `.setup(`. If the companion panel is never mounted, those rows are never reconciled. Same class: `team_assignments` recovery runs from `start_loops` (`engine/background.rs:483`).
- **A hardcoded table list in a recovery pass.** `db/src/repos/lab/mod.rs:172-177` recovers four `lab_*_runs` tables. `lab_consensus_runs` (`incremental.rs:5064`) is structurally identical — same `status`, `progress_json`, `error`, `completed_at` — and is not in the list. An off-by-one in an array reproduces the exact phantom-active-run bug the function's own docstring describes.
- **Progress that rides only the event.** `progress_text` / `progress_current` / `progress_total` (`companion/jobs/mod.rs:107-119`) are event-only *by construction*: `map_row:530-532` always reads them as `None`. `TaskTag.tsx:24-25` renders a progress bar from fields that are null on every DB path. Reload mid-scan and the bar is gone. A determinate counter that is not persisted is a counter no late reader can see.
- **Holding progress in component state.** `useCorrelatedCliStream.start()` sets `lines: []` and `phase: 'running'` (`:74-76`) and takes no snapshot input — unmount the surface and the entire run history is gone. `AutoRunBanner.tsx:20-28` documents this exact bug in the runner it replaced ("a reload in the middle of a 40-task run lost the banner entirely"); 5 stream-only call sites can still hit it.
- **A bounded `for` loop with `await sleep` as a terminal poll.** `KpiProposalsPanel.tsx:60-72` (40 × 3s = a hard 120s ceiling) and `FactoryOverviewTab.tsx:311-322` (150 × 2s = 300s). Past the ceiling the loop exits silently and the UI reports the scan finished. `FactoryOverviewTab` has no unmount guard at all and only breaks on `completed`/`failed`, so a *cancelled* scan is polled for the full 300 seconds. This shape is invisible to [`polling-loop.md`](./polling-loop.md)'s proposed `custom/prefer-polling-primitive`, which keys on `setInterval` and self-rescheduling `setTimeout`.
- **Two pollers of one command with two different vocabularies.** `getKpiScanStatus` is polled by both files above, at different cadences, with different terminal-state sets. Same defect class as [`polling-loop.md`](./polling-loop.md)'s server P0 (`dev_tools_pending_counts` polled by two registrations).
- **`serde_json::Value` as a snapshot return type.** 6 status commands return untyped JSON, so there is no ts-rs binding, no compile-time contract, and the `"not_found"` sentinel is invented per call site rather than being part of the status type.

## Evidence

- **`src-tauri/src/commands/infrastructure/task_executor.rs:1707-1730` (`dev_tools_get_auto_run_status`) — copy this one.** The fusion in nine lines: `repo::latest_auto_run` for identity and tallies, `AUTO_RUN_JOBS.get_snapshot(&row.id).map(|s| s.status == "running")` for a single `live: bool`, typed `AutoRunStatus` (`:1650-1669`, `#[ts(export)]`). Its doc comment states the invariant that makes it correct: *"a row left `running` by a hard kill reports `live: false` rather than a banner that never clears."* Paired with `:1743-1749`, which writes the durable `cancelled` immediately on cancel so a restart in the cancel window cannot rehydrate a stopped run.
- **`src/features/plugins/dev-tools/sub_runner/AutoRunBanner.tsx:44-60` — the client counterpart.** Two `listen`s whose entire body is `rehydrate()`. The comment is the doctrine: *"AUTO_RUN_COMPLETE flips the durable row, so re-reading the backend is both simpler and more truthful than patching a local shape."* Zero progress in component state; the only local state is `dismissed`.
- **`src-tauri/src/companion/jobs/mod.rs` — the strongest job design in the repo, and the model for a rewrite.** `pop_next_queued:316-333` (CAS claim), `worker_tick:372-449` (the frame owns the terminal write), `recover_orphans:169-188` (boot pass), `prune_terminal_jobs:194` (retention), `JobProgress:127-162` (the handle), `JobEventSink:44-63` (desktop/headless split with the reason written down).
- **`src-tauri/src/commands/design/template_adopt.rs:100-116` — the legitimate raw-lock escape hatch.** Locks *only* to run `evict_completed_with_cap` with a tighter per-family TTL (10 min / 50 entries, `:96-97`), then reads through `get_task_snapshot`. This is what a family needing custom eviction should look like; it is not a §9 violation because it never reads an entry through the guard.
- **`src-tauri/src/commands/obsidian_brain/revitalize.rs:565-578` — the clean typed reader.** `get_task_snapshot` → a `#[ts(export)]` `RevitalizeSnapshot`, `NotFound` as a real `AppError` rather than a `"not_found"` string. `:580-592` (`obsidian_revitalize_active`) is the re-attach affordance done right: *"lets the panel re-attach after a remount without the frontend persisting the id."*
- **`src/features/templates/sub_n8n/hooks/useN8nTransform.ts:71` + `:277-289` — the only reconciled client surface.** `useCorrelatedCliStream` for live output, `useBackgroundSnapshot` for restore, `usePersistedContext` (`:110-116`) to re-attach across a full reload. **1 of 7 primitive-based job surfaces does this.**
- **`src/stores/slices/system/devToolsTaskSlice.ts:49-62` (`patchTask`) — the delta-by-event pattern, with its cost written down.** *"The old Task Runner refetched the whole project on every TASK_EXEC_STATUS/TASK_EXEC_COMPLETE event — an O(project) IPC round trip per status tick, which is why a 40-task auto-run melted the queue."* Plus a 1,000-line ring (`:12-22`, with the O(n²) analysis) and an 80ms flush window (`:32`). This is the exception to step 9, and it earned it by measurement.
- **`src-tauri/src/background_job.rs:282-346`** — the `push_ring` chokepoint plus the `emit_line`/`record_line`/`record_streamed` triad. The doc comments are the best statement of the emit-vs-record decision in the repo.
- **`src-tauri/src/lib.rs:353-366` (`RunGuard`)** and **`engine/build_session/mod.rs:73-93` (`HandleDropGuard`)** — the RAII precedent, including generation-checking so a stale guard cannot evict a newer handle.
- **`src-tauri/db/src/repos/lab/mod.rs:203`, `:284`** — `recover_interrupted_lab_runs_reaps_only_orphans` and `..._is_idempotent`. The only boot-recovery tests worth copying; the first cites a real live orphan id in its docstring.

## Deviations found

### Server

**S1 — 9 raw-lock snapshot reads across 6 files opt their job family out of stale detection.** `context_generation.rs:841,858` · `idea_scanner.rs:707` · `kpi_scan.rs:634,650` · `use_case_scan.rs:365` · `workspace_divergence.rs:324` · `workspace_verify.rs:322,333`. All 9 also return `serde_json::Value` and all 9 invent a `"not_found"` status string. This is the §9 census rule's exact baseline.

**S2 — 3 of 19 managers are write-only.** `MEDIA_EXPORT_JOBS` (`artist/ffmpeg.rs:92`), `CREATIVE_JOBS` (`artist/mod.rs:50`), `TASK_EXEC_JOBS` (`task_executor.rs:44`) have no snapshot read anywhere. Consequences compound: no late reader, and `sweep_stale_running` can never run for them.

**S3 — `ffmpeg.rs:589` writes `"encoding"`.** Four predicates silently change behaviour (see *Prefer a type over a gate*). Highest-severity single-line defect in this leaf.

**S4 — `ffmpeg.rs:631,641` remove the entry in the terminal arm.** The outcome is unreadable one tick after it happens.

**S5 — `get_workflows_overview` covers 5 of 19 managers.** `workflows.rs:52-58`. Missing: context generation, idea scan, KPI scan, KPI compose, use-case scan, workspace divergence, workspace verify, obsidian revitalize, twin studio, media export, creative session, task exec, auto run, NL query (14). `cancel_workflow_job:139-159` is a second, independently drifting list. Its counter arithmetic (`:63-68`) has a `_ => {}` arm — currently latent, since all 5 aggregated families cancel through the manager's `cancel()` (which writes `"failed"`), but it fires the moment any `"cancelled"`-writing family or `MEDIA_EXPORT_JOBS` is added.

**S6 — `twin.rs` has 2 `insert_running` sites and 0 `catch_unwind`.** The only job file without panic-arm terminal writes. Partially masked because `twin.rs:1626` uses `get_snapshot_with`, so the stale sweep does eventually fire — at 10m30s, and only if someone polls.

**S7 — two spellings of cancel across the two job systems.** `"cancelled"` at 9 `BackgroundJobManager` sites; `canceled` in the companion vocabulary (`src/lib/bindings/BackgroundJob.ts:5`). Plus the manager's own `cancel()` writing `"failed"`.

**S8 — `elapsed_secs` is computed on every snapshot and read by nobody.** `BackgroundTaskSnapshot:581`, `JobSnapshot:569`, `WorkflowJob:25`. **Zero** consumers in `src/`. Every job in the app knows how long it has been running and no surface tells the user.

**S9 — determinate progress is event-only.** `map_row:530-532` nulls `progress_text` / `progress_current` / `progress_total` on every DB read, including `worker_tick:447`'s terminal re-emit. `TaskTag.tsx:24-25` is therefore correct only for a client that was listening.

**S10 — a second, independent determinate-progress channel with different field names.** `twinSlice.ts:119` — `onStudioProgress: (p: { batch_id, phase, completed, total })` versus companion's `progress_current` / `progress_total`. Two vocabularies, neither persisted.

### Server — restart recovery

**R1 — 11 boot passes cover ~13 tables; the largest job families are not among them.**

| Table | Status default | Recovery |
|---|---|---|
| `dev_scans` (`schema.rs:1250`) | `'running'` | **none** — the shared row for *every* `BackgroundJobManager` scan family |
| `dev_auto_runs` (`incremental.rs:4500`) | nullable `TEXT`, no default | **none**, despite its own comment claiming restart survival |
| `lab_consensus_runs` (`incremental.rs:5064`) | `'generating'` | **none** — missing from the 4-table list at `repos/lab/mod.rs:172-177` |
| `dev_tasks` (`schema.rs:1267`) | `'queued'` | none |
| `dev_competitions` (`schema.rs:1306`) | `'running'` | none |
| `autopilot_night_runs` (`incremental.rs:7301`) | `'running'` | none |
| `persona_test_runs` (`schema.rs:605`) | `'generating'` | none |
| `genome_breeding_runs` (`schema.rs:1510`) | `'generating'` | none |
| `build_sessions` (`schema.rs:1473`) | `phase='initializing'` | periodic only, **24h idle gate** (`repos/core/build_sessions.rs:308`) |

**R2 — every orphan-forever table's status column is free `TEXT`.** Among run-lifecycle tables only `persona_executions` (`schema.rs:107-108`), `n8n_transform_sessions` (`:649-650`), `team_assignments`/`_steps` (`incremental.rs:5785`, `:5813`) and `evolution_cycles` (`schema.rs:1570`) carry a `CHECK`. Widening `persona_executions`' CHECK required a full table rebuild (`incremental.rs:85-131`) — which is why every later table skipped it, and why the recovery sentinel is enforced by convention alone.

**R3 — 2 boot passes are wired to a frontend-invoked command,** 1 to the scheduler. `companion_background_job` and `companion_dev_op` recover only if `companion_init` runs (`commands/companion/mod.rs:192`, `:229-235`); `team_assignments` only if `start_loops` runs (`engine/background.rs:483`).

**R4 — 6 of 11 boot reconciliations have no test.** `recover_stale_executions`, `requeue_persisted_executions`, `recover_interrupted_pipeline_runs`, `recover_interrupted_sessions` (n8n), `recover_interrupted_approvals`, `companion::jobs::recover_orphans`. `src-tauri/tests/` contains **zero** matches for orphan/interrupted/recover/restart/zombie.

### Client

**C1 — 1 of 7 primitive-based job surfaces reconciles a snapshot with its stream.** Stream-only (5): `useN8nTest.ts:25`, `useQueryDebug.ts:13`, `useBackgroundPreview.ts:32`, `usePersonaExecution.ts:141`, and `useN8nTransform.ts:71`. Snapshot-only (3): `useCreateTemplateSnapshot.ts:146`, `useBackgroundRebuild.ts:94`, `useN8nTransform.ts:278`. Reconciled: **`useN8nTransform` alone**.

**C2 — 8 hand-rolled job polls.** `ContextMapPage.tsx:360` · `KpiProposalsPanel.tsx:69` · `FactoryOverviewTab.tsx:315` · `useUseCases.ts:85` · `ExtractionMenu.tsx:138` · `ExtractionMenu.tsx:213` · `useSchemaProposal.ts:105` · `ChatTab.tsx:109`. Five are already on [`polling-loop.md`](./polling-loop.md)'s "should be `useBackgroundSnapshot`" list; this path adds the two `for`-loop sites, which that path's proposed gate cannot see.

**C3 — 2 bounded `for` + `await sleep` loops** with silent ceilings (`KpiProposalsPanel.tsx:60-72`, 120s; `FactoryOverviewTab.tsx:311-322`, 300s, no unmount guard, no `cancelled` handling). Both poll the same command.

**C4 — 5 distinct progress-consumption designs across 20 sites.** Stream-only ×5 · snapshot-poll primitive ×3 · hand-rolled poll ×8 · event-fed store map ×3 (`companionStore.jobsById`, `twinSlice.onStudioProgress`, `devToolsTaskSlice.patchTask`) · event-as-invalidation + backend re-read ×1 (`AutoRunBanner`). Only the last is the prescription.

**C5 — `getIdeaScanStatus` has no client consumer.** The Idea Scanner tab was retired; the command, its manager and its `dev_scans` rows remain.

**C6 — no surface renders elapsed time or a determinate bar for any `BackgroundJobManager` job.** See S8/S9.

### Performance

**P1 — every snapshot clones the whole ring.** `get_snapshot:481`, `list_snapshots:501`, `get_task_snapshot:539` all `job.lines.clone()`. Worst case 500 × 4KB ≈ 2MB per job per poll, crossing IPC into the WebView.

**P2 — `get_workflows_overview` clones every line of every job in 5 managers, then keeps 20.** `workflows.rs:74-75` — `snap.lines.len()` then `snap.lines[len-20..]`, on a `Vec` `list_snapshots` already deep-cloned. It discards ~96% of what it paid to copy. Fix: a `tail(n)` accessor on the manager.

**P3 — no delta read exists.** 0 of 1,673 commands accept a change token — measured and owned by [`polling-loop.md`](./polling-loop.md) contract rule 5. Recorded here because it bounds every option in this document: there is no incremental progress tick to migrate to, so the ring tail is the whole cost lever.

## Gaps in the primitive

1. **No terminal-write enforcement.** `insert_running` returns `()`. Nothing structurally connects a registration to a terminal status; 23 spawn sites each remember by hand, and 15 of them additionally hand-roll a `catch_unwind` panic arm to do it twice. See *Prefer a type over a gate*.
2. **`status` is a `String`** with four independent literal comparisons and no shared vocabulary. Root cause of S3, S5's `_ => {}`, and S7.
3. **`sweep_stale_running` is reachable only from a read.** It is a *lazy* sweep with no ticker: if nobody polls, nothing is ever timed out, and if the process dies it cannot run at all. Even for the 12 families that read correctly, the 10m30s timeout is really "10m30s **and** somebody looked".
4. **The stale timeout is a single global constant.** `DEFAULT_STALE_RUNNING_SECS = 10 * 60` (`:36`) — despite the name, nothing overrides it. A 40-task auto-run and a 3-second query-debug share one deadline; the long one gets falsely failed, or the short one hangs for eleven minutes.
5. **No progress channel.** `BackgroundJobManager` has `emit_line` and `set_status` and nothing between them. Determinate progress exists only in `companion/jobs`'s `JobProgress`, which is bound to that system's `JobEventSink` and cannot be reused. This is why S10's second progress vocabulary exists — the author had no primitive to reach for.
6. **`BackgroundTaskSnapshot` has no `lines_since` / tail parameter.** Every read ships the whole ring (P1, P2).
7. **No registry.** Managers are `static`s discovered by grep — and 18 of the 19 are private to their own module, so a sibling module physically cannot reach them. The one exception is the right answer: `N8N_JOBS` is exposed through `pub fn manager()` (`n8n_transform/job_state.rs:48`), which is why `design/reviews.rs:775` and `n8n_transform/cli_runner.rs:251` can register and resume the same job family from two other files. `workflows.rs`'s two hand-maintained lists (S5) are the predictable consequence of the other 18.
8. **No durable/ephemeral bridge.** `BackgroundJobManager` is in-memory-only and `companion/jobs` is durable-only; the fusion `dev_tools_get_auto_run_status` performs is hand-written per family, exactly once, in the whole repo.
9. **`background_job.rs`'s tests cover clamping and ring bounds only** (`:594-645`). No test for `sweep_stale_running`, `evict_stale`, `evict_completed_with_cap`, `insert_running`'s duplicate rejection, or `resume_running`'s race. The three most consequential behaviours in the file are untested.
10. **`useCorrelatedCliStream` has no snapshot input.** `start()` unconditionally clears `lines` and sets `phase: 'running'` (`:74-76`), so reconciliation must be bolted on beside it (C1). A `getSnapshot?` option that seeds the buffer before attaching listeners would make the reconciled shape the default rather than a 1-of-7 outlier.
11. **No documentation surface.** `background_job.rs` appears in no `docs/` page and no `.claude/` doc. Every adopter learned the pattern by copying a sibling — which is visible in the file headers (`ffmpeg.rs:3` "Follows the `BackgroundJobManager` pattern from task_executor.rs", `use_case_scan.rs:15` "mirrors `kpi_scan.rs`", `revitalize.rs:7` "for the pattern... see"). Copy-from-sibling is exactly how the 9 raw-lock readers propagated as a cluster of six adjacent files.

## Convergence check — `brainiac`

`C:/Users/mkdol/dolla/brainiac` (Rust, 8-crate workspace, Postgres). Read-only
oracle sweep. Per the contract's portability rule: a mechanic reinvented there is
physics; a clause with no trace there is suspected local calibration.

**Independently reinvented — treat as physics:**

- **Durable-queue-over-in-memory.** brainiac has *zero* in-memory job state — no `Mutex<HashMap>`, no `DashMap`, no registry. State is three Postgres tables (`migrations/0001_init.sql:210-228`). It arrived at `companion/jobs`'s answer and skipped `BackgroundJobManager`'s entirely.
- **Compare-and-swap claim.** `queue.rs:135-166` uses `FOR UPDATE SKIP LOCKED` with the readiness predicate re-stated at the lock level; `pop_next_queued:316-333` uses `UPDATE … WHERE id=? AND status='queued'`. Same guarantee, two mechanisms, no shared document.
- **Attempt budget + capped exponential backoff** (`queue.rs:44-62`, `MAX_ATTEMPTS=5`, `BACKOFF_CAP_SECS=600`).
- **Terminal state must not depend on the worker surviving.** Its answer is a visibility timeout (`worker.rs:43`, 300s) — *"an unacknowledged job reappears after the timeout with its attempt counter bumped"* (`queue.rs:74-77`) — plus claim-time reaping. Ours is `recover_orphans` at boot. Different mechanism, identical requirement, independently derived. **This is the single strongest confirmation in this document.**
- **`status: String` with no enum.** brainiac has **zero** `sqlx::Type` derives workspace-wide; its three status vocabularies are SQL comments (`0001_init.sql:227`, `:200`, `0018_sweep_schedules.sql:21`), and its real status enum is *computed inline in an HTTP handler* (`console.rs:4518-4558`). It models its **domain** lifecycle as a proper enum (`core/src/types.rs:16-48`, `MemoryStatus`) and its jobs as strings — the same asymmetry this repo has. Convergent, and convergently wrong: it confirms the defect is a common attractor, not that it is acceptable.
- **No delta reads.** limit/offset only (`console.rs:4421-4426`, `http.rs:1699-1707`); the MCP tool's own description says *"poll this… until `extracted` is true"* (`mcp.rs:532`). Independently reproduces P3.
- **The started-but-never-finalised hazard is real and was hit.** `worker.rs:427-440` is a 14-line comment explaining why the audit write must be best-effort — *"losing an audit row is the acceptable failure here; losing the ack is not"* — because an early return would leave the job in-flight until the visibility window lapsed. That is precisely the bug a Drop guard prevents, found independently and fixed with prose.

**Done differently — three worth stealing:**

1. **A three-outcome terminal split: `ok` / `failed` / `dead`** (`queue.rs:16-30`). `failed` is an *adjudicated* failure — the error was observed. `dead` is crash-poison: the job took the worker down before it could report. The stated reason is operational: *"the split exists so `health` can tell 'the job failed and we know why' apart from 'the job took the worker down without a word'."* This repo collapses both into `"failed"` and loses the distinction — `sweep_stale_running`'s "Job timed out after Ns (stale job detection)" and a real handler error are the same status.
2. **Reaping at claim time, inside the claim transaction** (`queue.rs:117-133`). The attempt ceiling is enforced where delivery happens, so a deterministic crasher provably terminates with **no separate reaper, cron or boot hook**. Directly addresses gap #3: a sweep that only runs when someone reads is a sweep that may never run; a sweep fused into the claim always runs.
3. **Per-tenant fair claiming** — `ROW_NUMBER() OVER (PARTITION BY payload->>'org_id')` inside `FOR UPDATE SKIP LOCKED` (`queue.rs:135-166`). Not needed today (single user), but it is the shape `dev_tools_start_batch`'s `max_parallel` will want if projects ever compete.

**Absent there, present here — do not port away:**

brainiac has **no progress reporting of any kind** (4 `progress` hits, all
comments; stats accumulate in a process-local `RunStats` struct, `worker.rs:111-129`,
flushed once at the end), **no cancellation** (no `CancellationToken`; shutdown
is process-wide and explicitly refuses to interrupt in-flight work,
`main.rs:726-727`), and **one `impl Drop` in the entire workspace, in a test
fixture** (`publish/tests/okf_pg.rs:199`). It also never writes a `running` row
at all — `pipeline_runs` is INSERTed once, already terminal, after the job
settles (`worker.rs:507-513`), so the schema's `DEFAULT 'running'` is vestigial.
That is a *deliberate dodge*: by never opening a row you never have to close one,
at the cost of zero in-progress visibility. This repo's `emit_line`/`record_line`
split, `CancellationToken` plumbing, `JobProgress` and 19 Drop guards are all
genuine advantages. The clause worth flagging as **local calibration** is the
500-line/4KB ring: it exists because IPC lands in a WebView JS heap, a constraint
brainiac's HTTP boundary does not have.

## The missing gate

Nothing gates any of this today. Every deviation above shipped under a green
`npm run check`, a green `cargo clippy -- -D warnings` and a green
`cargo test`.

### The semantic condition

**A job registration whose state cannot be read back through the accessor that
enforces the job's own liveness rules.** That is the condition. It causes the
stale timeout to never fire, the eviction to never run, the payload to lose its
type and its `elapsed_secs`, and the `not_found` sentinel to be reinvented per
call site.

**The signal below is a manifestation** — it keys on *this* repo's idiom
(`SCREAMING_JOBS.lock()` followed by `jobs.get(`) because that is the shape the
condition happens to wear here. A sibling repo must re-derive its own proxy for
the same condition: *does the registry expose a read path that skips the
lifecycle enforcement, and does anything take it?* In brainiac the equivalent
condition cannot arise, because reaping is fused into the claim transaction
(`queue.rs:117-133`) — there is no bypassable accessor. That is the better fix,
and it is what gap #3 asks for.

**Precondition this signal depends on, stated so it can be checked before
porting:** this repo names its job registries `*_JOBS` (19 of 19 do) and binds
the guard to a local named `jobs` (16 of 16 `.lock()` sites do). Neither is semantic. If either
convention changes, the rule silently reports zero — which is why the runner's
`floor` and zero-match assertions are load-bearing here.

### Census rule (validated)

Do **not** paste this into `scripts/census/rules.json` yourself — the
orchestrator merges it. Validated against the runner at commit `2d168ac4c`.

```json
{
  "id": "unswept-job-registry-read",
  "goldenPath": "docs/concepts/golden-paths/long-running-job-progress.md",
  "title": "Job-registry read that bypasses the manager's liveness accessor",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b[A-Z][A-Z0-9_]*_JOBS\\s*\\.\\s*lock\\s*\\(\\s*\\)[\\s\\S]{0,300}?\\bjobs\\s*\\.\\s*get\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a BackgroundJobManager read that takes the raw `lock()` guard and pulls one entry with `jobs.get(...)` instead of `get_snapshot` / `get_task_snapshot` / `get_snapshot_with` — the four accessors that run `sweep_stale_running` + `evict_stale` before answering"
  },
  "baseline": { "files": 6, "matches": 9 },
  "floor": 900
}
```

**Measured.** 963 Rust files walked (matches `shared-facts.json`
`rust.files: 963` exactly), **6 files / 9 matches**, `--check` exits 0.

**Precision 9/9, hand-verified.** All nine are hand-rolled single-job status
readers: `context_generation.rs:841` (`dev_tools_get_scan_codebase_status`),
`:858` (`scan_status_json`, the HTTP-bridge twin) · `idea_scanner.rs:707` ·
`kpi_scan.rs:634`, `:650` · `use_case_scan.rs:365` ·
`workspace_divergence.rs:324` · `workspace_verify.rs:322` (`verify_job_probe`),
`:333`. The four other `_JOBS.lock()` sites in `src-tauri/src/commands/` are
correctly excluded by construction rather than by an allowlist: three are write
paths using `get_mut` (`nl_query.rs:252`, `query_debug.rs:447`,
`schema_proposal.rs:319`), one runs `evict_completed_with_cap`
(`template_adopt.rs:102`), and `revitalize.rs:587` iterates rather than gets.
**No `exclude` entries — a rule that fires only on its own allowlist is the
gate-that-no-ops the contract warns about, and this one needs none.**

**Known recall limit, stated rather than hidden.** `context_generation.rs:877`
(`list_scans_json`) has the same defect in `.iter()` form and is *not* matched.
Broadening to `jobs\s*\.\s*(get|iter)\s*\(` would raise the baseline to 7/11 at
some precision cost; the narrow form was chosen because a single-job read is
where the stale sweep matters. Recorded as a deliberate trade, not an oversight.

**How it fails loudly if its own precondition is absent** — all three verified
by running the runner, not asserted:

| Perturbation | Result |
|---|---|
| baseline `matches: 8` (real 9) | `[drift] matches rose 8 -> 9 (+1)`, **exit 1** |
| `floor: 5000` (walk sees 963) | `[structural] walked 963 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN`, **exit 1** |
| rule matches zero files (rename of `*_JOBS`) | runner's built-in zero-match assertion, exit 1 |
| a count **drops** without `--update` | runner treats a silent drop as a broken matcher, exit 1 |

`floor: 900` against 963 walked leaves ~7% headroom — tight enough that deleting
a crate or breaking the `.rs` glob fails structurally rather than reporting a
clean tree.

### The parts no census rule can cover

Three of this leaf's most expensive defects are **absences**, and a regex cannot
count something that is not written.

1. **A durable job table with no boot reconciliation** (R1, 9 tables). The signal is a *join* between a `CREATE TABLE … status … DEFAULT 'running'` and the absence of any `UPDATE … WHERE status='running'` reachable from `.setup(`. Right host: a node script in `scripts/` that parses the migration files for status-bearing tables and greps the recovery passes for each table name, seeded as a shrink-only baseline of the 9 above. It must exit non-zero if it discovers **zero** boot passes — a moved `.setup(` block would otherwise read as a clean tree, which is exactly the `cargo test`-without-`--features desktop` failure this repo already has a scar from.
2. **A `BackgroundJobManager` with no read command** (S2, 3 of 19) and **a family missing from the aggregator** (S5, 14 of 19). Both are cross-file absences. Both stop existing the moment the type-over-gate registration lands — which is the argument for doing that instead of writing two more scripts.
3. **Whether a status string is in the family's vocabulary** (S3). An ESLint-style AST rule could catch a `set_status` literal outside a fixed set today, but the honest fix is the enum, after which the compiler is the gate and no script is needed.

The client half — `for`-loop-with-`await sleep` as a terminal poll (C3) — is 2
files / 2 matches over 4,830 files. That is too thin to ratchet usefully on its
own; it belongs as a fourth sub-rule of
[`polling-loop.md`](./polling-loop.md)'s proposed
`custom/prefer-polling-primitive`, whose existing three sub-rules key on
`setInterval` and self-rescheduling `setTimeout` and therefore miss it entirely.
Recorded here as a cross-path finding, not claimed as this path's gate.
