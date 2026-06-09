# Bug Hunter — research-lab
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

## 1. Experiment run result is never persisted if the app closes / poll times out
- **Severity**: critical
- **Category**: recovery-gap
- **File**: src/features/plugins/research-lab/sub_experiments/ExperimentsPanel.tsx:63-92
- **Scenario**: User clicks "Run" on an experiment. `runPersonaAndWait` executes the persona (real tokens/cost) and polls for up to 120s. The persona row is created and runs to completion in the backend, but the *experiment run record* (`createExperimentRun`) is only written **after** the JS poll loop returns. If the app is closed/crashes, the tab is navigated away, or the persona takes >120s, control never reaches line 84 and no run row is ever written. The experiment executed and burned cost, yet "View runs" shows nothing — the result is silently lost.
- **Root cause**: The durable record of the run is created client-side *after* the long-running async work, instead of a run row being created up-front (status `running`) and then updated. There is no backend-side linkage from a persona execution back to a research run.
- **Impact**: data loss (completed experiment results vanish), wasted cost, misleading empty run history.
- **Fix sketch**: Create the run row server-side *before* dispatching the persona (status `running`, store `execution_id`), then update it on completion. On app start, reconcile any `running` runs against their `execution_id`'s terminal status so a crash mid-run is recoverable rather than orphaned.

## 2. Timeout / non-terminal execution is recorded as a genuine "failed" run
- **Severity**: critical
- **Category**: silent-failure
- **File**: src/features/plugins/research-lab/shared/runPersona.ts:47-62, src/features/plugins/research-lab/sub_experiments/ExperimentsPanel.tsx:70-85
- **Scenario**: A persona is still `running` when the 120s deadline elapses. `runPersonaAndWait` does **not** throw on timeout — it returns the last polled execution (status `running`/`queued`) with `passed: false` and whatever partial `output_data` exists. `handleRun` then calls `evaluatePass(...)` on that partial output and writes a permanent run row marked **failed**, with `metrics.status = "running"`. The user sees "Run failed" and the failed run is later compiled into reports as counter-evidence, even though the experiment may still be succeeding in the background.
- **Root cause**: Timeout and "terminal-failed" are conflated into one `passed=false` return; the caller cannot distinguish "didn't finish observing" from "finished and failed", so it records a false negative as ground truth.
- **Impact**: corruption (false experimental results), success-theater inverted — a real success persisted as failure, polluting findings/reports.
- **Fix sketch**: Have `runPersonaAndWait` return a discriminated result (`{kind: 'terminal'|'timeout', ...}`) or throw on timeout. In `handleRun`, only persist a run when the execution actually reached a terminal status; for timeouts, leave the run `running`/`pending` for later reconciliation (see #1).

## 3. Reports compile & download from in-memory store while fetches are still in flight — partial data presented as a finished paper
- **Severity**: high
- **Category**: edge-case
- **File**: src/features/plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx:60-99, src/features/plugins/research-lab/sub_reports/compileReport.ts:171-210
- **Scenario**: Opening the preview fires `fetchSources/Hypotheses/Experiments/Findings` in a `useEffect`, but `markdown` is computed synchronously via `useMemo` from the *current* store contents — initially the previous project's data (or empty). There is **no loading gate**. A user can hit "Download"/"Copy" in the window before the fetches resolve and walk away with a "Full Paper" whose Results/References sections are empty or stale, rendered with section headers and a "Generated <date>" banner that present it as complete. `renderFindingsList`/`renderSourceList` emit "_No findings recorded._" / "_No references._" with no indication the data simply hadn't loaded.
- **Root cause**: The compiler treats "absent in store" as "absent in the project" — it cannot distinguish *not-yet-loaded* from *genuinely-empty*, and there is no readiness barrier before export.
- **Impact**: corruption / UX degradation — an authoritative-looking cited report exported with missing sections and references.
- **Fix sketch**: Gate Copy/Download/markdown behind a per-project "all four lists loaded for this projectId" flag (track loaded projectId per slice). Disable export while any relevant `*Loading` is true or the loaded projectId ≠ report.projectId.

## 4. "Full paper" References list every project source regardless of citation, and findings render no source linkage — orphaned/uncited citation integrity is invisible
- **Severity**: high
- **Category**: state-corruption
- **File**: src/features/plugins/research-lab/sub_reports/compileReport.ts:92-102,171-209
- **Scenario**: Findings carry `sourceIds`/`hypothesisIds`/`sourceExperimentIds` JSON lists, but `renderFindingsList` never dereferences them — a finding is printed with title/confidence/description and zero citations. Conversely the `## References` section dumps **all** `sources` for the project, so the paper "cites" sources no finding actually used, and a finding whose `sourceIds` point at a since-deleted source produces no warning (the dangling id is simply never read here). The pipeline markets itself as "question → cited report" but the rendered findings are effectively uncited and references are unfiltered.
- **Root cause**: The report compiler ignores the denormalized id-lists that are the only link between findings and their evidence; citation integrity is never validated at render time.
- **Impact**: corruption of the core deliverable (uncited/over-cited report), silent loss of finding→source provenance, dangling source ids surface as nothing rather than a flagged broken citation.
- **Fix sketch**: Resolve each finding's `sourceIds` to actual `ResearchSource` rows, render inline citation keys per finding, and build `## References` from the *union of cited* sources only. When an id resolves to nothing, emit an explicit "⚠ missing source" marker instead of dropping it.

## 5. `update_hypothesis` accepts arbitrary status and unclamped confidence — validation state machine is bypassable
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/db/repos/research_lab.rs:345-384, src-tauri/src/commands/infrastructure/research_lab.rs:108-125
- **Scenario**: `update_hypothesis` writes whatever `status` string and `confidence` f64 it is handed — no enum check, no transition guard, no `0.0..=1.0` clamp. A hypothesis can jump straight to `validated`/`confirmed` without ever having a linked experiment or supporting evidence (skipping validation), and confidence can be set to `5.0` or `-1.0`. `compileReport` then prints `Math.round(5.0 * 100)` = `500%` confidence; the SignalMeter clamps for display but the stored/exported value and the executive-summary sort are corrupted.
- **Root cause**: The "hypothesis state machine" exists only as a convention; the persistence layer enforces no allowed-value set or transition rule, so any caller (including the AI generator path) can place a hypothesis in an illegal state.
- **Impact**: corruption (hypotheses confirmed without validation; out-of-range confidence propagated into reports and ranking).
- **Fix sketch**: Validate `status` against an allowed set with explicit permitted transitions, and clamp/reject `confidence` outside `[0,1]` in the repo (or a CHECK constraint) so illegal states are impossible regardless of caller.

## 6. Source "indexing" is success theater — status flips to `indexed` with no ingestion, then counted as indexed in reports
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/plugins/research-lab/shared/useIngestSource.ts:20-35, src/features/plugins/research-lab/sub_reports/compileReport.ts:130-147,220-225
- **Scenario**: `ingest()` flips a source `ingesting` → `indexed` with no actual knowledge-base work ("there is no real KB ingestion behind it today"). The literature-review and executive-summary templates then report `${indexed.length} indexed` and segregate "Indexed Sources" vs "Pending", presenting a hard completeness metric that is meaningless — and `knowledge_base_id` stays null, so anything downstream keying off it (RAG/citation lookup) silently finds nothing.
- **Root cause**: A UI affordance asserts a backend capability (KB ingestion) that does not exist; the status field is treated as ground truth by the report layer.
- **Impact**: UX degradation / misleading reports — users trust an "indexed" count that reflects only a button click, and any feature reading `knowledge_base_id` gets empty results without error.
- **Fix sketch**: Until real ingestion exists, don't expose an "index" action that fabricates `indexed` status (or label it "mark reviewed"); have the report distinguish "indexed (KB-backed, has knowledge_base_id)" from a mere status flag so completeness claims are honest.
