# Test Mastery — Pipeline & Agent Chains
> Total: 8 findings (2 critical, 3 high, 2 medium, 1 low)

> Scope note: the manifest lists `src/stores/slices/pipeline/index.ts` and `src/api/pipeline/index.ts`, which do not exist. The actual surface is `src/stores/pipelineStore.ts` + `src/stores/slices/pipeline/*.ts`, `src/api/pipeline/*.ts`, and the Rust engine (`pipeline_executor.rs`, `chain.rs`, `composite.rs`, `a2a/types.rs`). `chain.rs` (32 tests), `composite.rs` (sequence-only), and `a2a/types.rs` are already well covered; the high-value gaps are concentrated in `pipeline_executor.rs` (orchestration runtime) and the entirely-untested frontend pipeline slices.

## 1. Fan-in input merge (`resolve_node_input`) has zero tests despite being a fixed data-loss bug
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/pipeline_executor.rs:999-1034
- **Current test state**: none
- **Scenario**: A node with multiple predecessors (aggregator / synthesizer / reviewer — the entire point of a fan-in topology) must receive *all* present predecessor outputs merged into `{ "inputs": { member_id: output } }`. The in-code comment documents that a prior version silently `find_map`'d a single predecessor and discarded the rest while still reporting success. There is no test locking this behavior. A future refactor (e.g. back to `find_map`, or changing the single-vs-multi branch boundaries) re-introduces silent data loss and the suite stays green.
- **Root cause**: The `#[cfg(test)]` block only covers `evaluate_condition`, `parse_node_config`, `build_predecessor_map`, and `should_skip_node`. The input-resolution helper — pure, fully deterministic, no DB/engine deps — was never added.
- **Impact**: A reviewer/synthesizer node runs on one arbitrary branch's output, the pipeline reports `completed`, and the business decision (merge/approve/summarize across branches) is made on partial data. High blast radius — every multi-input pipeline.
- **Fix sketch**: Pure-function unit tests (no fixtures needed): (a) no predecessors → returns `pipeline_input`; (b) single predecessor with output → returns the raw string unchanged (linear-chain invariant); (c) single predecessor with `None` output → falls back to `pipeline_input`; (d) **two predecessors both producing output → result parses as JSON with `inputs` containing BOTH member_ids and values**; (e) two predecessors where one produced `None` → only the present one appears. Assert the invariant "every predecessor that produced output is represented in the merged payload."

## 2. Pipeline node runner, budget-halt, and approval-gate orchestration are untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/pipeline_executor.rs:728-993 (run_pipeline), :320-511 (run_persona_node), :679-704 (poll_for_approval)
- **Current test state**: none
- **Scenario**: The orchestration loop owns money- and correctness-critical behaviors with NO test: (1) the **budget enforce-mode halt** (`ledger().should_halt` → stop launching further nodes, mark `has_failure`, finalize); (2) the **approval-gate arm-before-emit ordering** that the comment at :814-820 says exists specifically to close a TOCTOU window where an approval lands before `poll_for_approval` registers and hangs the run forever; (3) **failure propagation** — once a node fails, remaining `idle` nodes are relabeled `skipped`/`cancelled` and `final_status` is computed. A regression in any of these either over-spends (halt removed), hangs runs forever (approval re-ordering), or mislabels a partially-failed run as `completed`.
- **Root cause**: `run_pipeline` is a large async fn that takes `tokio::process`, a `DbPool`, and an `ExecutionEngine`, so it was treated as untestable. But the decision logic (halt check, skip-label selection, final-status computation) can be extracted/exercised independently of the I/O.
- **Impact**: Money (budget bypass), liveness (hung pipelines), and honest reporting (failed run shown as success) all regress silently. These are exactly the "would it catch a regression that hurts the business" cases.
- **Fix sketch**: (a) Extract the final-status + idle-relabel logic (lines :946-973) into a pure helper `finalize_statuses(was_cancelled, has_failure, &mut statuses) -> &'static str` and unit-test the matrix {cancelled, has_failure, clean} × {idle nodes present}. (b) Add an integration test against `init_test_db()` that registers a run-budget ceiling at ~0, then asserts the loop halts and finalizes `failed` without launching a second node. (c) For the approval gate, a focused `tokio::test`: register the approval key, set the flag, call `poll_for_approval`, assert `Approved`; then a `cancelled`-first case asserts `Cancelled` — locks the documented TOCTOU fix.

## 3. Chain `payload_forward` shape and the mark_triggered CAS / DLQ branches are untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/chain.rs:242-274 (payload build), :288-398 (mark CAS + retry + quarantine + DLQ)
- **Current test state**: exists-but-weak (cascade happy-path + suppression covered; these branches are not)
- **Scenario**: When `payload_forward: true`, the forwarded payload must embed `source_output` (parsed-or-string), `_chain_depth = next_depth`, and the appended `_chain_visited` so downstream cycle-detection state propagates. No test inspects the *published payload contents* — only counts (`events_published`). A regression that drops `_chain_visited` or fails to increment depth breaks cycle detection two hops later, re-enabling the infinite-cascade class the code exists to prevent. Separately, the `mark_triggered` → `Ok(false)` CAS-lost skip, the retry path, and the quarantine+DLQ path (which the comments tie to a real duplicate-PR incident) are entirely unexercised.
- **Root cause**: Tests assert `CascadeMetrics` counters but never read back the persisted event's payload, and there's no seam to force `mark_triggered` to return `Ok(false)`/`Err` for the CAS/DLQ branches.
- **Impact**: Duplicate downstream executions (CAS regression = the documented competing-PR bug) and broken multi-hop cycle detection (lost visited set) — both directly burn budget and produce conflicting work.
- **Fix sketch**: (a) After `evaluate_chain_triggers` with `payload_forward:true`, fetch the published event via `event_repo` and assert its payload JSON contains `_chain_depth == 1`, `_chain_visited` contains the target persona, and `source_output` round-trips. (b) Pre-mark a trigger as already-fired at the same `trigger_version` (or call evaluate twice) to drive the CAS-lost path and assert `events_published == 0` (no double-fire). Name the invariant: "a trigger that loses the mark CAS never publishes."

## 4. `composite.rs` suppression window and ALL/ANY evaluation lack tests (only SEQUENCE is covered)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/composite.rs:243-246 (suppression), :399-416 (all/any), :469-495 (source_filter wildcard)
- **Current test state**: exists-but-weak (`sequence_tests` thorough; `all`/`any`/suppression/wildcard untested)
- **Scenario**: A composite trigger that already fired within its `window_seconds` must be **suppressed** (not re-fire) until the window passes — the whole anti-spam contract. There is no test for the suppression math (`now - last < window`), nor for `evaluate_all_detailed` (every condition must match) / `evaluate_any_detailed` (at least one), nor for the `source_filter` trailing-`*` wildcard prefix match in `event_matches_condition`. A regression flipping `<` to `<=`, mis-counting conditions_met, or breaking the wildcard makes triggers either spam downstream personas every tick or silently never match.
- **Root cause**: The recent sequence-consumption bug got dedicated tests; the older AND/OR/suppression/wildcard paths predate that discipline and were never backfilled.
- **Impact**: Either runaway re-firing (cost + noise) or dead triggers (silent non-firing — the worst failure mode for an event feature, per the code's own comments).
- **Fix sketch**: Pure-function tests for `evaluate_all_detailed`/`evaluate_any_detailed` over a small `&[&PersonaEvent]` (mirror the existing `ev()`/`cond()` helpers): all-match→fired, one-missing→not-fired (all) / still-fired (any), with correct `conditions_met` counts. Add `event_matches_condition` cases: exact source match, `prefix*` wildcard match/non-match, `None` source with a filter set → false. For suppression, a focused unit on the boundary `now - last == window` (assert NOT suppressed at exactly the window edge).

## 5. Frontend pipeline store slices have zero tests; `applyAssignmentProgress` reducer is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/pipeline/assignmentSlice.ts:282-311 (applyAssignmentProgress), src/stores/pipelineStore.ts
- **Current test state**: none (no `*.test.ts` anywhere under `src/stores/slices/pipeline/` or `src/api/pipeline/`)
- **Scenario**: `applyAssignmentProgress` is the live-update reducer that merges orchestrator `TEAM_ASSIGNMENT_PROGRESS` events into the kanban caches. Its two documented invariants — (1) assignment-level transitions (`step_id === null`) patch status into the per-team lists **idempotently** (`changed` flag: only writes on real status change, returns `{}` otherwise to avoid re-render churn), and (2) detail re-fetch fires **only** when that assignment is currently being viewed (`assignmentDetails[id]` present) — are pure, synchronous, and trivially testable, yet have no test. A regression that drops the `changed` guard causes render storms; one that always re-fetches hammers IPC for un-viewed assignments.
- **Root cause**: The whole pipeline slice family was shipped without unit tests even though sibling domains (`processActivitySlice.test.ts`, `src/api/__tests__/*`) establish the pattern.
- **Impact**: Live board updates silently stop merging (stale UI showing wrong assignment state) or thrash performance — a daily-driver surface for teams orchestration.
- **Fix sketch**: vitest store test (create the store, mock `@/api/pipeline/assignments`): seed `assignmentsByTeam`, call `applyAssignmentProgress({step_id:null, status:"running"})` → assert the matching assignment flipped and a no-op status returns no new array identity. With `assignmentDetails[id]` set, assert `getTeamAssignmentDetail` was called; unset, assert it was not. These are deterministic reducer assertions, not snapshots.

## 6. `create_node_memory` UTF-8 truncation and `run_id[..8]` slicing are untested edge cases
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/pipeline_executor.rs:214-249
- **Current test state**: none
- **Scenario**: Node output longer than 500 bytes is truncated at a UTF-8 char boundary before becoming a team memory; the title/tags slice `&run_id[..8]`. Multi-byte output (emoji, CJK) near the 500-byte boundary, or a `run_id` shorter than 8 chars, are the classic Rust panic-on-byte-index-into-`str` traps. There's no test proving the char-boundary logic actually avoids a panic or that the truncated content stays valid UTF-8.
- **Root cause**: The helper does DB I/O via `team_memories_repo::create`, so it was lumped in with the untestable runtime — but the truncation math is separable.
- **Impact**: A panic here aborts the pipeline node mid-run (caught by `AssertUnwindSafe` at the team level but still fails the node) and loses the team memory; the auto-memory feature degrades silently for non-ASCII agents.
- **Fix sketch**: Extract the truncation into a pure `fn truncate_on_char_boundary(s: &str, max_bytes: usize) -> String` and test: ASCII under/over 500, a string whose 500th byte lands mid-multibyte-char (assert result is valid UTF-8 and ≤ original), and exactly-500. Optionally guard `run_id[..8]` with `run_id.get(..8).unwrap_or(run_id)` and test a short id.

## 7. No vitest coverage gate / new-code ratchet on the pipeline frontend
- **Severity**: medium
- **Category**: quality-gate
- **File**: vitest.config.ts:10-18
- **Current test state**: n/a (no `coverage` block at all)
- **Scenario**: `vitest.config.ts` configures no `coverage.thresholds`, so the entirely-untested pipeline slices (Finding 5) carry no signal and new untested store/reducer code merges freely. Given 189 frontend test files already exist, the suite is mature enough that a *new-code ratchet* would catch regressions without demanding a giant backfill.
- **Root cause**: Coverage was never wired into the gate; correctly, a blanket high global threshold would be bypassed given large untested UI areas — but the absence of *any* per-area or diff-based gate means risky reducer logic ships untested.
- **Impact**: The pipeline store family stays a coverage blind spot indefinitely; each new slice action is one more silent gap.
- **Fix sketch**: Add a `coverage` block (v8 provider) with a **per-directory** threshold scoped to `src/stores/slices/pipeline/**` and `src/api/pipeline/**` (start advisory, e.g. lines 60%, ratchet up), or adopt a new-code/changed-files coverage check in CI. Keep it scoped so it fires on real pipeline-logic risk, not on UI-component churn — avoids the bypass-or-noise failure mode.

## 8. Chain cascade tests assert counters but never the "fired BEFORE published" ordering invariant
- **Severity**: low
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/chain.rs:282-432
- **Current test state**: exists-but-weak
- **Scenario**: The comment at :282-287 declares a critical ordering: a trigger is marked fired *before* the event is published, so a crash between the two can't leave an unmarked trigger that re-fires on next startup. Tests confirm `events_published == 1` but never assert the trigger's persisted state (`mark_triggered`/`last_triggered_at` / version bump) after a successful fire. The ordering contract is documented but not pinned.
- **Root cause**: Assertions stop at the metrics struct; the persisted trigger row after firing is never read back.
- **Impact**: Low (happy path works today) but a refactor reordering publish/mark could re-introduce duplicate-on-restart firing with no test failure.
- **Fix sketch**: In `test_cascade_metrics_with_trigger`, after the call, re-fetch the trigger via `trigger_repo` and assert it is recorded as triggered (version incremented / not re-fireable). Cheap addition to an existing DB-backed test; locks the documented "mark precedes publish" invariant.
