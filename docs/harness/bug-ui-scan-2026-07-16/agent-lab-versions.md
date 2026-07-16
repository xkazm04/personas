# Agent Lab & Versions — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. LLM-eval prompt builder panics on multi-byte UTF-8 output, cascading to a Failed run
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/eval.rs:543-547 (also :693)
- **Scenario**: A lab run (arena/ab/matrix/eval) tests a persona whose agent output is longer than 3000 bytes and contains a multi-byte character (emoji, accented letter, CJK — any non-English persona) that happens to straddle byte offset 3000. `build_llm_eval_prompt` does `&input.output[..3000]` — a byte slice, not a char slice.
- **Root cause**: `if input.output.len() > 3000 { &input.output[..3000] }` assumes byte 3000 is a `char` boundary; Rust panics otherwise. The same pattern exists in `parse_llm_eval_response`'s error path (`&trimmed[..trimmed.len().min(500)]`).
- **Impact**: The per-cell tokio task panics; `handle.await` in `test_runner.rs:1853-1858` logs "Lab task panicked" and drops the cell, so `current < total` and the completeness gate (test_runner.rs:1968-1975) finalizes the ENTIRE run as Failed. One emoji at the wrong offset kills a whole (and paid-for) version×model matrix run, non-deterministically.
- **Fix sketch**: Truncate on a char boundary: `let end = (0..=3000).rev().find(|&i| input.output.is_char_boundary(i)).unwrap_or(0); &input.output[..end]` (or use `char_indices().take_while(...)`); apply the same to the 500-byte error preview.

## 2. Lab runs orphaned by an app crash/quit stay "running" in the DB forever and re-hydrate as phantom active runs
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/db/repos/lab/mod.rs:109-133 (query), src/stores/slices/agents/labSlice.ts:599-640 (hydration); no recovery exists in src-tauri/src/lib.rs startup
- **Scenario**: User starts an eval matrix run, then the app crashes or is closed mid-run. The tokio task dies with the process, but the `lab_*_runs` row keeps `status='running'` with a populated `progress_json`. On next launch, `hydrateActiveProgress` finds it via `get_all_active_progress` and calls `markStarted` for its mode.
- **Root cause**: Startup recovery exists for n8n sessions, persona jobs, and dev-ops (`recover_interrupted_sessions`, `recover_orphans`) but there is no equivalent sweep for the four `lab_*_runs` tables — nothing ever transitions a dead run out of `running`.
- **Impact**: Permanent phantom run: launch buttons disabled, cancel button shown, sidebar orbit dot lit, `isLabRunning`/per-mode flags pinned true. The 30-minute frontend safety timeout only resets the in-memory flags — the DB row stays `running`, so every re-selection of the persona re-hydrates the phantom. Only manually clicking Cancel (which writes Cancelled) or deleting the run clears it.
- **Fix sketch**: On startup (near the n8n recovery in lib.rs), run one UPDATE per lab table: `SET status='failed', error_message='Interrupted by app restart', completed_at=... WHERE status NOT IN ('completed','failed','cancelled')`. Safe because no lab task can survive a process restart.

## 3. Cancel commands unconditionally overwrite terminal run status (completed → cancelled), and the runner's final write races the other way
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/execution/lab.rs:191-205 (arena; same at :400-414, :525-539, :783-797); race counterpart src-tauri/src/engine/test_runner.rs:1954-1988
- **Scenario**: (a) A run completes in the backend while the user's UI still shows it running (results/summary write landed, status event not yet processed); the user clicks Cancel. `lab_cancel_*` executes `update_run_status(..., Cancelled, ..., Some(&now))` with no current-status check — the completed run is rewritten as `cancelled` with a new `completed_at`. (b) Reverse race: the runner checks `cancelled` at test_runner.rs:1954, a cancel lands in the gap, then the runner writes `Completed` at :1980 — a cancelled run ends up `completed`.
- **Root cause**: Only the genome repo's `update_run_status` validates transitions via `validate_transition` (db/repos/lab/genome.rs:112-127); the arena/ab/matrix/eval repos' `update_run_status` are unconditional UPDATEs, and both the cancel command and the runner's finalization do check-then-write instead of a guarded write.
- **Impact**: Run history corruption: completed runs (with full results and summary) display as cancelled — their version×model scores look untrustworthy and the `finalizedResultIds` terminal-cache logic in labSlice treats them as final-cancelled; conversely a cancelled run can present partial data as `completed`, feeding the Versions & Ratings rollup a partial sample.
- **Fix sketch**: Make the status write conditional in SQL: `UPDATE ... SET status=?1 ... WHERE id=? AND status NOT IN ('completed','failed','cancelled')` (or port genome's `validate_transition` into the four repos). That single guard fixes both directions of the race.

## 4. finishLabRun keys the orbit-dot cleanup and runs-refresh to the *selected* persona, not the run's persona
- **Severity**: Medium
- **Category**: bug
- **File**: src/stores/slices/agents/labSlice.ts:410-433 (with src/hooks/lab/useLabEvents.ts:54-57)
- **Scenario**: User starts an arena run on persona A (wrapStart adds A to `labRunningPersonaIds`), then navigates to persona B while it runs. The terminal `lab-arena-status` event fires `finishLabRun('arena')`, which reads `get().selectedPersona?.id` — B — and filters B (not A) out of `labRunningPersonaIds`, then refreshes B's run list. Variant: persona A has two concurrent runs (arena + eval); when the arena finishes while A is selected, A is removed from the set even though the eval is still live.
- **Root cause**: The terminal event carries `run_id` but not persona_id, and `finishLabRun` assumes "the finishing run belongs to the currently selected persona" — false for background runs (which `labRunningPersonaIds` exists specifically to represent) and for multi-mode concurrency (which the per-mode lifecycles exist specifically to allow).
- **Impact**: Persona A's sidebar orbit dot never clears (stale "running" indicator until restart), A's run history is not refreshed on completion, and in the concurrent case the dot disappears while a run is still active — the exact signals this feature exists to keep honest.
- **Fix sketch**: Track personaId per started run (wrapStart already has it — store `runId → personaId`), have `finishLabRun(mode, runId?)` resolve the persona from that map (useLabEvents has `p.runId`), and only remove the persona when it has no other tracked active runs.

## 5. DiffViewer claims "No structural diff" when versions differ only in system_prompt or custom sections
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/agents/sub_lab/shared/DiffViewer.tsx:14-16, 54-56 (via getSectionSummary, src/lib/personas/promptMigration.ts:255-267)
- **Scenario**: User compares v3 vs v4 before activating/rolling back. The two versions have identical standard structured sections but differ in `system_prompt` (a legitimate snapshot field — the rollback/activate code paths in lab.rs explicitly restore it, and snapshots may have ONLY a system_prompt) or in non-standard/custom prompt sections. DiffViewer renders "No structural diff between these versions".
- **Root cause**: `getSectionSummary` iterates only `STANDARD_SECTION_KEYS` and DiffViewer diffs only `structured_prompt` — `versionB.system_prompt` and custom sections are never compared, so "nothing in the compared subset changed" is presented as "nothing changed".
- **Impact**: The diff is the decision surface for activation/rollback (a persona-mutating, production-tagging action). A user seeing "no diff" reasonably concludes the versions are interchangeable and activates one whose actual live behavior (system_prompt) differs — a silent behavior change with no UI trail. Also affects legacy versions where `structured_prompt` is null: both sides summarize to `{}` and always read as identical.
- **Fix sketch**: Add a synthetic "System prompt" section to both summaries (`a.system_prompt ?? ''` vs `b.system_prompt ?? ''`) and include non-standard keys from the parsed structured prompt; when sections are equal but other snapshot fields differ, say "No differences in compared sections (system prompt identical)" rather than a blanket no-diff claim.
