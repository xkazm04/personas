# Auto-Run Scheduler — design contract

> Co-located with `task_executor.rs`. Documents the snapshot loop that drains
> the dev-tools backlog respecting goal-DAG dependencies, with predictable
> termination and hard caps on runaway. Approved 2026-05-01 from
> `/research` Matt Pocock workflow video.

## Problem

`dev_tools_start_batch(task_ids, max_parallel)` takes a fixed list of task
IDs and spawns them all at once, throttled by a Semaphore. The user must
hand-pick the batch list every time.

Goal: a single command that drains a project's pending backlog respecting
goal-level dependencies (`DevGoalDependency`), without requiring the user to
re-pick after each wave.

## Design choice — Approach A (snapshot loop)

Picked over event-driven (B) and UI-helper-only (C) because:

1. Reuses the existing single-task path (`run_task_execution`) verbatim.
2. **Snapshot-at-start makes the run deterministic** — the set of tasks
   eligible for this run is the set of `queued` tasks that existed when the
   command was issued. Tasks created mid-run are NOT picked up. This bounds
   the run's risk surface and gives the user a predictable scope.
3. No new "backend listens to its own emitted events" pattern; the scheduler
   awaits `tokio::JoinHandle`s directly.

The "pick up tasks created during the run" property is intentionally out of
scope. If a future finding wants it, build B on top.

## Public surface

Two new Tauri commands in `task_executor.rs`:

```rust
#[tauri::command]
pub async fn dev_tools_start_auto_run(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
    max_parallel: Option<usize>,        // default 2
    max_iterations: Option<u32>,        // default 50 (number of waves)
) -> Result<serde_json::Value, AppError>;
// Returns: { run_id: String, snapshot_size: usize }

#[tauri::command]
pub async fn dev_tools_cancel_auto_run(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    run_id: String,
) -> Result<bool, AppError>;
```

Two new events in `event_registry.rs`:

```
AUTO_RUN_STATUS    => "auto-run-status"
AUTO_RUN_COMPLETE  => "auto-run-complete"
```

`AUTO_RUN_STATUS` payload: `{ job_id, status, error? }`
(reuses BackgroundJobManager status shape so frontends can listen with the
same contract used for `TASK_EXEC_STATUS`).

`AUTO_RUN_COMPLETE` payload:
```json
{
  "run_id": "<uuid>",
  "completed": <int>,    // tasks that finished with status='completed'
  "failed": <int>,       // tasks that finished with status='failed'
  "cancelled": <int>,    // tasks cancelled mid-run (cap hit)
  "skipped": <int>,      // tasks blocked by failed upstream goal
  "iterations": <int>,
  "snapshot_size": <int>,
  "termination_reason": "exhausted" | "max_iterations" | "cancelled"
}
```

## Internal mechanics

```text
dev_tools_start_auto_run(project_id, max_parallel=2, max_iterations=50)
  run_id = uuid::new
  snapshot = list_tasks(project_id, status="queued")   // canonical set
  goal_state = list_goal_statuses_with_deps(project_id) // bulk: id -> (status, deps)

  emit AUTO_RUN_STATUS { run_id, status="running" }
  loop iteration in 0..max_iterations:
    if cancellation_token.is_cancelled():
      termination_reason = "cancelled"; break
    ready = snapshot.filter(t -> task_ready(t, goal_state) && t.status == "queued")
    if ready.is_empty():
      termination_reason = "exhausted"; break
    slice = ready.take(max_parallel)
    spawn each via existing run_task_execution; wait for ALL to finish
    refresh task statuses + goal statuses from DB
  if iteration == max_iterations: termination_reason = "max_iterations"

  counts = tally(snapshot - latest DB state)
  emit AUTO_RUN_COMPLETE { run_id, ...counts, termination_reason }
```

### Readiness predicate

A task is *ready* if it is `status='queued'` AND:
- Its `goal_id` is `None` (orphan — no upstream by definition); OR
- Every goal `g` in the upstream-closure of `goal_id` has `status='completed'`

A task is *skipped* if any upstream goal has `status='failed'` or
`status='cancelled'`. Skipped tasks remain `queued` in DB; the runner
counts them but does not transition them automatically (the user can
re-trigger after fixing the upstream goal).

### Cycle prevention

`add_goal_dependency` previously inserted edges with no cycle check. Adding
two-way deps (A→B, B→A) would deadlock the readiness predicate — every task
in the cycle would be perpetually unready. Add a DFS check before insert:

```rust
fn check_goal_dependency_cycle(pool, new_goal_id, new_depends_on_id)
    -> Result<(), AppError>
```

Returns `Err(AppError::Validation("Adding this dependency would create a cycle"))`
when a path already exists from `depends_on_id` back to `goal_id`.

Existing cycles in the DB are not auto-fixed; the runner treats them as
"perpetually unready" and they fall out of the ready set. The cycle check is
preventive, not curative.

### Concurrency model

The scheduler uses `tokio::task::JoinSet` (NOT Semaphore — that pattern is for
"all-spawned, throttled"; here we want "spawn N, wait for any-or-all, refill").

Per iteration: spawn at most `max_parallel` tasks via `run_task_execution`,
`join_set.join_next()` until empty, then refill. This keeps the scheduler
itself single-threaded while letting CLI subprocesses run concurrently.

### Cancellation

- One `CancellationToken` per run, stored in a new
  `BackgroundJobManager<AutoRunExtra>` instance (mirrors `TASK_EXEC_JOBS`).
- `dev_tools_cancel_auto_run` triggers the token; the next iteration's
  cancel-check exits the loop. In-flight tasks are NOT auto-cancelled — they
  finish naturally because cancelling a Claude CLI mid-execution leaves
  partial work uncommitted. Use `dev_tools_cancel_task_execution` to cancel
  individual in-flight tasks.

## Repository changes

### `db/repos/dev_tools.rs`

```rust
pub fn list_ready_tasks(
    pool: &DbPool,
    project_id: &str,
    limit: usize,
) -> Result<Vec<DevTask>, AppError>;
```

Returns up to `limit` tasks where:
- `project_id = ?1`
- `status = 'queued'`
- `goal_id IS NULL` OR every goal in the upstream-closure of `goal_id` is
  `status='completed'`

Implementation: one query for queued tasks + one query for the project's
goal status map + in-memory closure walk. Avoids the N+1 of
`list_goal_dependencies` per task. Sorted by `created_at ASC` (FIFO).

```rust
pub fn check_goal_dependency_cycle(
    pool: &DbPool,
    goal_id: &str,
    depends_on_id: &str,
) -> Result<(), AppError>;
```

Wired into `add_goal_dependency` as a pre-insert check.

```rust
pub fn list_goal_statuses_with_deps(
    pool: &DbPool,
    project_id: &str,
) -> Result<HashMap<String, (String, Vec<String>)>, AppError>;
```

Bulk query returning `goal_id -> (status, Vec<dep_goal_id>)`. Used by the
scheduler to evaluate readiness without per-goal round trips.

## Frontend changes

`TaskRunnerPage.tsx`:
- New "Auto-Run All" button next to "Start Batch", styled `accent="violet"`
  (distinct from amber Start Batch).
- New compact progress strip below the action row, visible while a run is
  active: shows `iterations / max_iterations`, `completed / snapshot_size`,
  and a "Cancel Auto-Run" button.
- Listens to `AUTO_RUN_STATUS` and `AUTO_RUN_COMPLETE` events; updates store
  on completion to refetch tasks and surface counts.

API wrapper at `src/api/devTools/devTools.ts`:
```typescript
export const startAutoRun = (projectId: string, maxParallel?: number, maxIterations?: number)
  => invoke<{ run_id: string; snapshot_size: number }>(
       "dev_tools_start_auto_run",
       { projectId, maxParallel, maxIterations });

export const cancelAutoRun = (runId: string)
  => safeInvoke<boolean>(false, "dev_tools_cancel_auto_run", { runId });
```

i18n keys (added to `src/i18n/locales/en.json` under `plugins.dev_runner`):
- `auto_run_all`, `cancel_auto_run`, `auto_run_progress`, `auto_run_complete`,
  `auto_run_started`, `auto_run_iterations`, `auto_run_no_ready_tasks`

## Out of scope (explicit non-goals)

- **Tasks created during a run** — snapshot only.
- **Cost tracking** — `max_iterations` is the only cap. A future cost cap
  would need `Result.usage` extraction from stream-json (separate finding).
- **Priority sorting** — FIFO by `created_at`. Custom priority can land via
  existing `TriageRule` if a real consumer asks for it.
- **Auto-skip on upstream failure** — skipped tasks stay `queued`; the user
  decides whether to re-run after the failure is resolved.
- **Fixing existing DB cycles** — cycle check is preventive only.
- **Touching `run_task_execution` itself** — unchanged.

## Validation

- `cargo check` in `src-tauri/` — type clean
- Rust unit tests for `list_ready_tasks` (orphan, all-deps-met, blocked,
  failed-upstream-skipped) and `check_goal_dependency_cycle`
  (self-loop, two-cycle, three-cycle, no-cycle)
- `npx tsc --noEmit` — TS types pick up regenerated command names
- `npm run lint` — no new violations
- Manual: create three queued tasks (T1 orphan, T2 with goal_a, T3 with
  goal_b where goal_b depends_on goal_a). Run `start_auto_run`. Expect:
  T1 + T2 in iteration 1, T3 in iteration 2 after goal_a flips to completed.
