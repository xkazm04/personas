# Bug Hunter — Agent Lab & Versions

> Total: 5 findings (1 critical, 2 high, 2 medium)
> Context: agent-lab-versions | Group: Persona & Agent Studio

## 1. `activateVersion` writes the model to the *selected* persona, not the target persona
- **Severity**: critical
- **Category**: state corruption / wrong-target write
- **File**: `src/stores/slices/agents/labSlice.ts:528`
- **Scenario**: `activateVersion(personaId, versionId, modelId, provider)` rolls the prompt onto `personaId` (step 1, `labRollbackVersion(versionId)` → backend resolves the version's own `persona_id`). But step 2 reads `get().selectedPersona?.model_profile` and then calls `updatePersona(personaId, { model_profile })`. The `model_profile` it merges into comes from whatever persona is *currently selected in the UI*, which is not guaranteed to be `personaId`. If the user activates a (version, model) cell for persona A while the sidebar selection has moved to persona B (deep-link, multi-tab, a `selectPersona` from a concurrent `finishLabRun`/`acceptDraft`, or the "Versions & Ratings" table being driven by a `versionId` whose persona ≠ selected), persona A is written with persona B's base_url/auth_token/cache policy — and the chosen model is layered onto the wrong profile JSON.
- **Root cause**: the function takes `personaId` as a parameter but sources the existing profile from ambient `selectedPersona` state instead of loading the profile for `personaId`. The two identities are assumed equal but never checked.
- **Impact**: silent credential/endpoint cross-contamination between personas; the activated persona can end up pointed at another persona's API endpoint or auth token (security + wrong-result), or lose its own base_url. No error surfaces.
- **Fix sketch**: load the profile for the explicit `personaId` (fetch the persona by id, or assert `selectedPersona?.id === personaId` and bail otherwise). Do the prompt rollback + profile merge in one backend command that resolves both from `personaId` server-side, eliminating the client-side identity assumption.

## 2. A/B and Eval runs share one lifecycle flag — cancelling/finishing one clobbers the other
- **Severity**: high
- **Category**: race condition / concurrent-run state collision
- **File**: `src/stores/slices/agents/labSlice.ts:340`
- **Scenario**: `ab`, `matrix`, and `eval` CRUD factories are all constructed with the same `matrixLifecycle` instance (lines 340–342), which keys off `isMatrixRunning`/`matrixProgress`. Start an A/B run and an Eval run concurrently (both allowed — they are different modes with their own run rows). `matrixLifecycle.markStarted` is shared, so when the Eval run finishes, `finishLabRun('eval')` calls `matrixLifecycle.markFinished`, flipping `isMatrixRunning=false` while the A/B run is still executing. The A/B launch button re-enables and the cancel button disappears mid-run; conversely cancelling A/B (`cancelAb` → `matrixLifecycle.markCancelled`) tears down the Eval progress UI. The FSM in `runLifecycle.ts` is a single shared closure, so the second `markStarted` is also rejected (already 'running'), losing the second run's safety-timeout arming.
- **Root cause**: three logically independent run modes were collapsed onto one lifecycle/state-key pair; the per-mode isolation that arena got (`arenaLifecycle`) was never created for ab/eval.
- **Impact**: phantom "idle" state during an active run, double-submission risk (launch re-enabled), lost cancel affordance, and a run with no safety timeout (can pin state if it stalls). UX + state corruption.
- **Fix sketch**: give `ab` and `eval` their own `createRunLifecycle('isAbRunning'…)` / `('isEvalRunning'…)` instances and state keys, mirroring arena; update `finishLabRun`'s `fetchByMode`/lifecycle dispatch to route each mode to its own instance.

## 3. `fetchResults` terminal-state cache short-circuit serves stale results forever
- **Severity**: high
- **Category**: stale cache / silent wrong result
- **File**: `src/stores/slices/agents/labSlice.ts:167`
- **Scenario**: `fetchResults` returns early (skips the network fetch) when results are already cached AND the run is terminal. A run can reach a terminal status (`failed`/`cancelled`) with partial results cached, then the same `runId` is later re-fetched after a re-run/append, or results were cached while the run was still `running` (non-terminal, so it fetched once) and the run subsequently transitions to `completed` — but the *cached* `runs` array the check reads (`state[runsKey]`) may already show terminal while the cached results predate the final batch. Because the guard trusts the cache whenever `TERMINAL_STATUSES.has(run.status)`, the user permanently sees the stale/partial result set; pulling to refresh does nothing. Also: if `run` is not found in the (paginated, 20-limit) `runsKey` list, `run` is `undefined`, the guard is skipped, and it refetches — inconsistent behavior depending on list window.
- **Root cause**: cache invalidation keyed only on "terminal status seen at least once" with no version/etag/last-results-count; assumes terminal ⇒ results immutable, which is false across delete-rerun and the running→completed cache window.
- **Impact**: users analyze outdated scores, miss the final scenario's results, or compare against a run state that no longer exists. Wrong-result decisions feed the prompt-improvement loop.
- **Fix sketch**: invalidate on a server-provided `completed_at`/result-count signal, or only skip when the cached set was fetched *after* the run reached terminal (store a per-run "fetchedAtStatus" marker). Never short-circuit on a run looked up from a truncated list.

## 4. Version-rating composite divides by `wsum` but averages can be poisoned by error rows scored 0
- **Severity**: medium
- **Category**: edge case / misleading aggregate
- **File**: `src-tauri/src/db/repos/lab/ratings.rs:119`
- **Scenario**: `get_version_ratings` aggregates with `AVG(CAST(ta AS REAL))` etc. across all `status = 'completed'` rows for a (version, model). But a scenario that *executed* but produced an empty/errored output is still written with `status` derived from `verdict_status` — and heuristic-fallback or zero-score rows land in the same table. `AVG` includes every non-null sub-score equally, so one genuinely-scored sample and several `0` fallback rows pull the composite toward 0, presenting a strong version as failing. Conversely, `eval_protocol_compliance` returns `100` when no protocols are expected (eval.rs:237) and `eval_tool_accuracy` returns `100` when no tools expected/called — those optimistic sentinels also get averaged in, inflating composites. `composite_from_parts` guards divide-by-zero (`wsum > 0`) correctly, but the *inputs* mix real and sentinel scores indistinguishably.
- **Root cause**: the rollup treats every completed row's sub-scores as comparable signal, ignoring `eval_method` (llm vs heuristic_fallback vs timeout) and the "nothing-expected ⇒ 100/50" sentinels the heuristics emit.
- **Impact**: the "Versions & Ratings" champion selection and the prompt-improvement engine can pick the wrong version/model based on averages contaminated by fallback sentinels. Wrong result, low visibility.
- **Fix sketch**: exclude rows where `eval_method IN ('heuristic_fallback','timeout')` from the composite (or weight them down), and/or store a per-row "was this dimension actually evaluated" flag so sentinels don't enter the mean. Surface `sample_count` of *real* LLM evals separately.

## 5. `lab_accept_matrix_draft` idempotency fast-path reads run, then claims in a *different* connection — TOCTOU on the prompt write
- **Severity**: medium
- **Category**: race condition / partial-write
- **File**: `src-tauri/src/commands/execution/lab.rs:541`
- **Scenario**: `lab_accept_matrix_draft` does `get_run_by_id` (connection 1), validates `run.draft_prompt_json`, then opens a *new* transaction (connection 2) and conditionally claims `draft_accepted = 1`. The claimed-row guard correctly prevents a duplicate version row. But the `draft_json` written to `personas.structured_prompt` (line 587) is the value read in connection 1, *before* the claim. If another path (a concurrent `lab_improve_prompt`, a rollback, or a second accept that lost the claim race but had already mutated the run's draft) changes `draft_prompt_json` between the read and the claim, the winning accept writes a prompt snapshot that no longer matches the run's current draft, and the auto-versioned row records `draft_json` while the run row may reference different draft state. The duplicate-version `latest_prompt` check also runs against a draft read outside the claiming transaction.
- **Root cause**: the authoritative claim transaction does not re-read `draft_prompt_json` inside the transaction; it trusts the value fetched in a separate earlier connection (read-then-act window).
- **Impact**: under concurrent accept/improve, the persona's live prompt and its auto-saved version row can diverge from the run's recorded draft — a confusing, hard-to-debug "the version I accepted isn't what got saved." Low frequency (requires concurrency) but corrupts the version lineage.
- **Fix sketch**: re-`SELECT draft_prompt_json` inside the claiming transaction after the `UPDATE … WHERE draft_accepted = 0` succeeds, and use that in-transaction value for both the persona update and the duplicate-check, so the whole accept reads a single consistent snapshot.
