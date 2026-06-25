# Agent Lab & Versions — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: agent-lab-and-versions | Group: Persona & Agent Studio
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. A/B, Matrix and Eval share ONE run-lifecycle instance — concurrent runs clobber each other's "running" flag and progress
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race condition / shared-state corruption
- **File**: src/stores/slices/agents/labSlice.ts:362
- **Scenario**: "If a user starts a Matrix run, then starts an A/B run, then cancels (or finishes) the A/B run while Matrix is still executing in the backend..."
- **Root cause**: Lines 362-364 wire `ab`, `matrix`, AND `eval_` all to the same `matrixLifecycle` instance (which owns `isMatrixRunning` / `matrixProgress`); only `arena` gets its own. The slice header at line 272 advertises "Per-mode running state (allows concurrent runs)", and `cancelRun` (lines 164-172) carries a long comment warning that using the wrong lifecycle leaves a per-mode flag stuck — yet three modes are collapsed onto a single flag. `ab.cancelRun` → `matrixLifecycle.markCancelled` flips `isMatrixRunning=false` even though Matrix is still running; `finishLabRun('ab')` (line 390) calls `matrixLifecycle.markFinished` while an eval is live; every `markStarted`/progress event overwrites the shared `matrixProgress` (also seen in `hydrateActiveProgress` lines 624-627, where ab/matrix/eval all write `matrixProgress`).
- **Impact**: UX / state corruption — a still-running eval/matrix/ab shows as stopped (cancel button vanishes, launch re-enables), or one mode's live progress is overwritten by another's. User may launch a duplicate run or lose all progress visibility. Backend run rows are unaffected (separate run_ids), so no data loss, but the UI lies about run state.
- **Fix sketch**: Give A/B and Eval their own `createRunLifecycle('isAbRunning'|'isEvalRunning', 'abProgress'|'evalProgress')` instances (add the state fields), and route `finishLabRun`/`hydrateActiveProgress` per actual mode instead of folding ab/matrix/eval together.
- **Value**: impact=7 effort=2

## 2. `activateVersion` is two non-atomic IPC calls — a failed model switch leaves the version rolled-in but the model stale
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: latent failure / atomicity gap
- **File**: src/stores/slices/agents/labSlice.ts:560
- **Scenario**: "If the user clicks 'Activate (version V, model M)' and `labRollbackVersion` succeeds but `updatePersona` then fails (transient IPC error, validation reject, app crash between the two awaits)..."
- **Root cause**: `activateVersion` performs step 1 `await api.labRollbackVersion(versionId)` (line 564, which atomically rolls the prompt live + tags it `production`) and step 2 `await get().updatePersona(personaId, { model_profile })` (line 587) as two independent transactions. There is no compensating rollback of step 1 if step 2 throws. The single user-facing action "make (version, model) live" is therefore non-atomic.
- **Impact**: wrong result / inconsistent persona state — the persona now runs version V's prompt and is tagged production, but still on the OLD model. The table re-marks the "active" row based on the production tag, so the UI claims the new (version, model) cell is active while the live model is actually the previous one. Silent until the next execution behaves unexpectedly.
- **Fix sketch**: Move the prompt-rollback + model-profile write into a single Rust command wrapped in one transaction (extend `lab_rollback_version` to accept an optional `model_profile`), or in the TS path capture the prior `model_profile` before step 1 and restore the prior production tag on step-2 failure with a clear toast.
- **Value**: impact=7 effort=3

## 3. Scenario cache key omits `tool.input_schema` (and category/script_path) — editing a tool's schema serves stale test scenarios for 10 minutes
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale data / silent wrong result
- **File**: src-tauri/src/engine/test_runner.rs:48
- **Scenario**: "If a user tweaks a tool's `input_schema` (or category) and re-runs Arena/Test for the same persona within 600s of a prior run..."
- **Root cause**: `scenario_cache_key` (lines 38-56) hashes only `persona.id`, `system_prompt`, `structured_prompt`, and per tool `t.name` + `t.description`. But `build_coordinator_prompt` feeds `tool.input_schema` (line 668) and `tool.category` (line 665) into the scenario-generation prompt. Since those fields are absent from the cache key, a schema/category change produces the SAME key → the `SCENARIO_CACHE` (TTL `SCENARIO_CACHE_TTL_SECS = 600`) returns scenarios generated from the OLD schema.
- **Impact**: wrong result — generated test scenarios (mock tool responses, expected tool sequences) silently reflect the pre-edit schema, so the comparison/score is measured against an outdated contract with no warning. Misleads the very "which version/model is best" decision the lab exists for.
- **Fix sketch**: Hash `t.input_schema`, `t.category` (and ideally `t.script_path`) into `scenario_cache_key` alongside name/description so any tool-shape change invalidates the cached scenarios.
- **Value**: impact=6 effort=2

## 4. DiffViewer compares only `structured_prompt` — versions differing solely in `system_prompt` render "no structural diff"
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: edge case not covered / misleading UX before an irreversible action
- **File**: src/features/agents/sub_lab/shared/DiffViewer.tsx:14
- **Scenario**: "If the user diffs a legacy `system_prompt`-only version against another version (or two versions whose only difference is the system prompt) before deciding which to activate..."
- **Root cause**: `sectionsA`/`sectionsB` derive exclusively from `getSectionSummary(version.structured_prompt)` (lines 14-15); `system_prompt` is never read. The rollback path (lab.rs:856-865) explicitly permits versions that have only `system_prompt` and no `structured_prompt`, so such versions summarize to `{}` → `allKeys` empty → the component shows `no_structural_diff` (line 54-55) even when the two prompts are entirely different.
- **Impact**: UX / wrong decision — the comparison surface used to choose a version to activate reports "identical" for versions that genuinely differ, so a user may activate/rollback the wrong one believing there is no change.
- **Fix sketch**: Fold `system_prompt` into the diff (treat it as a synthetic `system_prompt` section, or merge structured sections with the system-prompt body) and show an explicit "structured prompt unavailable — comparing system prompts" banner for legacy versions.
- **Value**: impact=5 effort=3

## 5. A/B and Eval never reject duplicate/identical version selections; "v{num}" label attribution then collides
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: undocumented assumption / data attribution corruption
- **File**: src-tauri/src/commands/execution/lab.rs:292
- **Scenario**: "If A/B is launched with `version_a_id == version_b_id`, or Eval is launched with the same version id appearing twice in `version_ids`..."
- **Root cause**: `lab_start_ab` validates only that both versions belong to the persona (line 292), not that they are distinct; `lab_start_eval` checks `version_ids.len() >= 2` (line 661) but not uniqueness. Downstream, variants are labelled `format!("v{}", num)` and `persist_result` recovers the version via `version_lookup.iter().find(|(_, num)| format!("v{}", num) == variant.label)` (test_runner.rs:2336 / 2416). Because per-persona `version_number` is unique, the design silently assumes the selected versions are distinct — duplicates produce two variants with the same `"vN"` label. `find()` returns the first match for both, and `run_lab_loop`'s tracker key `"{label}:{model}"` (line 1796) merges them.
- **Impact**: wrong result — both result rows are attributed to the same `version_id`, the "comparison" is a version against itself, and the (version, model) cell in the ratings rollup is double-weighted by identical samples, skewing the leaderboard.
- **Fix sketch**: In `lab_start_ab` reject `version_a_id == version_b_id`; in `lab_start_eval` dedupe/reject duplicate `version_ids` (and require ≥2 *distinct* ids) with an actionable validation error before creating the run row.
- **Value**: impact=5 effort=3
