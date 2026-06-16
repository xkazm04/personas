# Bug Hunter Fix Wave 1 — Concurrency / missing-CAS double-execution

> 5 commits, 5 criticals closed.
> Theme: "add a real guard against duplicate/concurrent execution" — one mental
> model across frontend (in-flight ref / fresh-state read) and backend
> (process-wide single-flight registry).
> Baseline preserved: `cargo check --features desktop` 0 → 0 errors; `tsc --noEmit` 0 → 0 errors.

## Commits

| # | Commit | Finding closed | Severity | File |
|---|---|---|---|---|
| 1 | `c3ab4aa7f` | shared-ui #1 — ConfirmDialog double-confirm | Critical | `src/features/shared/components/feedback/ConfirmDialog.tsx` |
| 2 | `6e960f1b5` | team-builder-workspace #1 — AutoTeam double-submit | Critical | `src/features/teams/sub_teamWorkspace/useAutoTeam.ts` |
| 3 | `fa326eb14` | artist-studio #1 — concurrent creative session clobber | Critical | `src/features/plugins/artist/hooks/useCreativeSession.ts` |
| 4 | `9d1de3d78` | team-assignment-handoff #1 — double-started tick loops | Critical | `src-tauri/src/engine/team_assignment_orchestrator.rs` |
| 5 | `0ff899369` | dev-tools-context-map #1 — concurrent scan wipes map | Critical | `src-tauri/src/commands/infrastructure/context_generation.rs` |

## What was fixed (grouped by sub-pattern)

**Frontend re-entry guards (1–3).**
1. **ConfirmDialog double-confirm.** The shared confirm primitive was a pure controlled component with no in-flight state — its confirm button stayed enabled through the caller's async `onConfirm` (callers only close in a `finally`), so a double-click fired destructive actions twice across every call site. Added an internal `busy` guard: `onConfirm` may now return a promise; while pending both buttons are disabled (`aria-busy`) and backdrop/Escape dismissal is ignored. One primitive, whole class fixed.
2. **AutoTeam double-submit.** In the preview phase both the Enter keydown handler and the "Create team" button called `apply()`; `phase` was read from the render snapshot, so two events in one tick both saw `'previewing'` and both ran a full team-creation flow — two `createTeam`s, double member adoption, the first team orphaned. Added an `applyingRef` that flips synchronously before any re-render; re-entrant calls return; cleared in `finally` and on `reset()`.
3. **Artist concurrent generation.** `sendPrompt` unconditionally minted a fresh UUID and overwrote the single global creative session id; a second start (remounted panel / lagging `running` flag) orphaned the first backend job as a runaway CLI subprocess (output for a `job_id` the store no longer tracked, uncancellable, up to 10 min). Now reads `creativeSessionRunning` freshly from the store and refuses re-entry.

**Backend single-flight registries (4–5).**
4. **Team-assignment double-start.** `run_assignment` (reached from start + every resume path) `tokio::spawn`ed a fresh `tick_loop` unconditionally — no CAS on the DB transition, no registry of live tasks — so two starts forked two loops that each re-scanned the DAG and launched the same step (two executions, two PRs, doubled spend). Added a process-wide `OnceLock<Mutex<HashSet<assignment_id>>>`; `run_assignment` claims the slot before spawning, no-ops if held, releases when the loop exits. A resume during a live loop is absorbed by that loop (it re-reads status each tick).
5. **Dev-tools concurrent context-scan.** `launch_context_scan` had no per-project guard; two rescans interleaved `clear_project_context_map` (a full DELETE of the project's contexts/groups, cascading to `dev_goals`/`dev_kpis` `context_id` refs) with each other's writes, leaving an arbitrary partial / near-empty map while reporting success. Added a `CONTEXT_GEN_INFLIGHT` guard (reusing `engine::inflight_guard`, same pattern as `INFLIGHT_TRIGGERS`) keyed by `project_id`; the RAII handle is moved into the spawned task so it releases on completion/cancellation.

## Verification (before / after)

| Gate | Baseline | After Wave 1 | Notes |
|---|---|---|---|
| `cargo check --features desktop` | 0 errors | 0 errors | The `--features desktop` flag is required — a bare `cargo check` fails before compilation on the feature-gated `updater:default` capability (`capabilities/default.json:19`). Not a regression; reproduced with all changes stashed. |
| `tsc --noEmit` | 0 errors | 0 errors | — |
| eslint (lefthook, per-commit) | clean | clean | Ran on each staged frontend file at commit time. |
| `vitest run` | 5 failing (pre-existing) | 5 failing (same) | `narrationTimeline`, `shortcutRegistry`, `customRules`, `webview2-compat` — none references any file changed in this wave (grep-verified). Unrelated to the concurrency fixes; left for a separate pass. |

No regressions introduced by this wave.

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Commits |
|---|---|---:|---|
| 1 | Concurrency / missing-CAS double-execution | 5 | `c3ab4aa7f`, `6e960f1b5`, `fa326eb14`, `9d1de3d78`, `0ff899369` |

Criticals closed: **5 / 42**. Findings closed overall: **5 / 260**.

## Patterns established (catalogue additions, items 1–4)

1. **Re-entry guard on an async UI confirm/submit.** A controlled component or hook whose async action only resets/closes in a `finally` leaves its trigger live for the whole round-trip. Add an internal `busy`/in-flight ref that flips *synchronously* before any re-render; disable the trigger and ignore dismissal while pending. Fixes double-fire at the primitive instead of per-consumer.
2. **Read liveness freshly from the store, not the render snapshot.** A `disabled={running}` prop is captured at render; a sibling instance, a remount, or a lagging status event can bypass it. Re-check the authoritative flag via `store.getState()` at the top of the action and refuse re-entry there.
3. **Process-wide single-flight registry for spawned background tasks.** When a function `tokio::spawn`s a long-lived task and is reachable from several callers (start + resume + auto + recovery), a unique-per-call id or a loop-local map cannot dedupe across spawns. Claim a key in a `static OnceLock/LazyLock<Mutex<HashSet>>` (or reuse `engine::inflight_guard::InflightGuard`) before spawning; no-op if already held; release when the task exits by moving the RAII handle into the task.
4. **"Lazy clear" + concurrent writers = full-table wipe.** A producer that DELETE-alls-then-reinserts per stream assumes a single in-flight producer. Concurrent producers interleave clear+insert and corrupt the result (partial mix or near-empty). Guard the producer with a per-entity single-flight, and/or make the clear+insert atomic in one transaction.

## What remains

41 other criticals across 11 themes (see `INDEX.md`). Remaining concurrency-double-exec criticals not in this wave: `build-sessions` simulate clobber, `companion-brain` wake-gate re-entry, `agent-chat` triple-finalization double-persist. Highest-blast-radius next wave per the INDEX plan is **Security & trust-boundary** (SSRF redirect, CORS `Any`, PostgREST injection, 2× path-traversal, enclave signature).
