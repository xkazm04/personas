# Test Mastery — Build Sessions & PersonaMatrix
> Total: 8 findings (2 critical, 3 high, 2 medium, 1 low)

## 1. promote_build_draft exclusion filtering (use_cases ↔ triggers alignment) is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/build_sessions.rs:2594-2646 (filter), build_structured_use_cases:1074-1168, create_triggers_in_tx:1977-2065
- **Current test state**: none
- **Scenario**: When a user excludes a capability in the Phase 5b preview panel, the code drops the matching `ir.use_cases` entry AND positionally filters `ir.triggers` (only when `triggers.len() == original_count`). A regression that drops the trigger-filter branch, mis-aligns the kept-index set, or off-by-ones the positional map would promote a persona whose trigger fires for a capability the user explicitly removed — a phantom scheduled/event trigger referencing a dropped UC. Today nothing catches this.
- **Root cause**: The promote orchestrator is a long async tauri command with no seam; the exclusion logic is inline rather than a pure helper, so it was never unit-tested. `build_structured_use_cases` and the positional trigger↔use_case alignment (`create_triggers_in_tx` uses `use_case_ids.get(idx)`) are also untested, so the *contract* that triggers and use_cases stay index-aligned is unverified.
- **Impact**: Excluded capabilities silently keep running (cron/webhook trigger fires), or the wrong trigger binds to the wrong UC — the user believes they disabled work that is actually still executing (cost + unwanted side effects).
- **Fix sketch**: Extract the exclusion+trigger-realignment into a pure `fn apply_capability_exclusions(ir: &mut AgentIr, excluded: &[String])` and unit-test: (a) excluding the middle of 3 UCs keeps triggers[0] and triggers[2], drops triggers[1]; (b) `triggers.len() != use_cases.len()` leaves triggers untouched; (c) Simple-variant UCs (no id) are never dropped; (d) unknown exclusion id is a no-op. Then assert `build_structured_use_cases` preserves `ids[i]` ↔ `triggers[i]` index alignment as the invariant `create_triggers_in_tx` relies on.

## 2. test_build_draft / promote phase compare-and-set (concurrent-claim guard) has no test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/build_sessions.rs:702-726 (CAS claim), 2466-2469 + 2476-2499 (promote validate_transition + agent_ir retry)
- **Current test state**: none
- **Scenario**: `test_build_draft` claims the session with a conditional `UPDATE ... WHERE phase IN ('draft_ready','test_complete')` and rejects when `claimed != 1`. This guard exists specifically because two rapid calls both passed `validate_transition` and both ran real tool APIs, then clobbered `last_test_report` (documented in the comment). There is no test that a second concurrent claim is rejected, nor that a failed run reverts phase to `draft_ready` (lines 780-792). A refactor that reverts to a blind `update(phase=Testing)` would silently reintroduce double-billing of real API tests and report corruption with a green suite.
- **Root cause**: The CAS lives inside a `#[tauri::command]` that needs `AppState` + DB pool, so it has no pure seam; `BuildPhase::validate_transition` (the lighter-weight invariant) is also untested in this module.
- **Impact**: Concurrent test/promote runs execute real tool calls twice (cost + external side effects) and the persisted test report is non-deterministic — the user promotes on a report that may not reflect what ran.
- **Fix sketch**: Add a Rust integration test against an in-memory SQLite (the repo already builds test pools elsewhere) that: inserts a `draft_ready` session, runs the conditional UPDATE twice, asserts the first returns 1 and the second returns 0. Separately, unit-test `BuildPhase::validate_transition` for the legal/illegal edges (draft_ready→testing OK, promoted→testing rejected, testing→testing rejected by the CAS even though validate_transition allows it). Name the invariant: *a session can be claimed for testing exactly once per testable phase*.

## 3. matrixBuildSlice multi-draft "next active session" policy is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:476-492 (pickNextActiveSessionId), 622-640 (removeBuildSession), 1277-1295 (resetBuildSession)
- **Current test state**: exists-but-weak (matrixBuildSlice.test.ts covers single-session handlers + applyPendingAnswers, but never removeBuildSession or the newest-first / persona-scoped promotion rule)
- **Scenario**: The header comment pins a deliberate policy: on removing the active session, promote the remaining session with the largest `createdAt`, ties broken by sessionId, AND scoped to the *same persona* so removing persona A's failed draft never flips the editor to persona B's UI. None of this is tested. A regression to the old `Object.keys()[0]` insertion-order behavior, or dropping the `preferPersonaId` scoping, would silently swap the user onto a different persona's draft mid-edit — the exact bug the scoping was added to prevent.
- **Root cause**: The multi-draft refactor added the policy in a pure helper but no test was backfilled; the existing slice test predates multi-draft.
- **Impact**: User edits/promotes the wrong persona's draft after closing one tab — data goes to the wrong agent.
- **Fix sketch**: `pickNextActiveSessionId` is a pure function — llm-generatable batch. Assert invariants: (1) newest `createdAt` wins; (2) equal `createdAt` → lexicographically smallest sessionId wins (determinism); (3) with `preferPersonaId`, a remaining session for a *different* persona is NOT chosen → returns null; (4) empty map → null. Plus a slice-level test: create s1(p-1), s2(p-1, newer), s3(p-2); remove active s2 → active becomes s1, never s3.

## 4. v3 capability event handlers + clarifying-question handlers are untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:794-909 (handleBehaviorCoreUpdate, handleCapabilityEnumerationUpdate, handleCapabilityResolutionUpdate, handlePersonaResolutionUpdate, handleClarifyingQuestionV3), 947-985 (addCapabilityDraft id-collision, removeCapability)
- **Current test state**: none (the test file stops at the legacy cell/question handlers)
- **Scenario**: These handlers drive the capability-first build UI — the actual data the user reviews before minting a persona. Real invariants with no guard: (a) `handleCapabilityResolutionUpdate` for an id never seen in enumeration creates a stub instead of dropping the field; (b) `handleCapabilityEnumerationUpdate` merges refined title/summary without losing `resolvedFields` or duplicating `capabilityOrder`; (c) `addCapabilityDraft` disambiguates colliding ids as `_2`,`_3` rather than clobbering user work (explicitly commented as protecting against data loss); (d) `handleBehaviorCoreUpdate` deep-merges `identity`/`voice` rather than replacing the whole object. A regression in any of these silently corrupts the draft the user promotes.
- **Root cause**: Handlers were added after the original test file; they touch nested maps where shallow-merge bugs are easy and invisible without assertions.
- **Impact**: User-edited capability fields silently lost or overwritten; a refined enumeration drops earlier resolution → persona promoted with missing capability config.
- **Fix sketch**: llm-generatable batch over a created session. Assert: enumeration→resolution→re-enumeration sequence preserves resolved fields and order; resolution-before-enumeration creates a stub and appends to order exactly once; `addCapabilityDraft` with a duplicate id produces `id_2` and keeps both; behaviorCore partial update preserves untouched `identity.description`.

## 5. hydrateBuildSession preservation of in-flight state on re-hydration is untested
- **Severity**: high
- **Category**: missing-assertion
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:1297-1452 (esp. 1410-1444 existing-session merge), 1344-1398 (v3 agentIr → behaviorCore/capabilities hydration)
- **Current test state**: exists-but-weak — existing tests only hydrate a *fresh* session and check phase/cellStates/pendingQuestions; the re-hydration branch and v3 hydration are uncovered.
- **Scenario**: The code carries a long comment explaining that re-hydrating an existing session must NOT wipe transient state (mid-test results, draft answers, edit state, v3 clarifying question) — "wiping them on every re-hydration silently destroys mid-test results." Persisted hydration arrives from polling, so this fires routinely during an active build. There is no test that the existing-session merge preserves `testOutputLines`, `pendingAnswers`, `editState`, `clarifyingQuestionV3`, nor that `agentIr.persona` + `use_cases` hydrate `behaviorCore`/`capabilities` so a page reload resumes the v3 UI.
- **Root cause**: The preservation branch is conditional on `existing !== undefined` — a path the original (pre-multi-draft) test never exercised.
- **Impact**: A background poll/hydrate during testing throws away the user's in-progress test output and typed answers; after reload the capability UI comes back empty.
- **Fix sketch**: Test (1) create session, set test/edit/answer state via patchActiveSession, then hydrateBuildSession with the same id → assert transient fields survive while phase/cells refresh from the payload. Test (2) hydrate with `agentIr: { persona: {...}, use_cases: [...] }` → assert `buildBehaviorCore`/`buildCapabilities`/`buildCapabilityOrder` populated.

## 6. Promote pure helpers (normalize_agent_icon, solo_use_case_model_profile, find_connectors_needing_setup, ensure_webhook_secrets) have no tests
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src-tauri/src/commands/design/build_sessions.rs:1350-1382 (ensure_webhook_secrets), 1428-1678 (normalize_agent_icon), 1787-1797 (find_connectors_needing_setup), 2354-2376 (solo_use_case_model_profile)
- **Current test state**: none (build_sessions.rs tests only cover collect_persona_emit_event_types + smee relays)
- **Scenario**: These are pure, branch-heavy mappers that decide what gets persisted on the promoted persona. `solo_use_case_model_profile` gates whether the persona-level `model_profile` is seeded — a wrong branch means the persona runs on the wrong (possibly far more expensive) model. `normalize_agent_icon` has a 6-tier resolution order (catalog/Lucide/connector/keyword/fallback) with a documented sync contract against the frontend catalog. `ensure_webhook_secrets` auto-mints a secret only when missing/blank. `find_connectors_needing_setup` decides which connectors get flagged for the readiness gate.
- **Root cause**: Pure helpers buried in a 3231-line command file; easy to test but never were.
- **Impact**: Silent regressions in model selection (cost/quality), broken icons in the avatar, a webhook trigger promoted with an empty secret (auth bypass on inbound webhook), or a misconfigured persona passing the readiness gate.
- **Fix sketch**: llm-generatable Rust `#[cfg(test)]` batch. Invariants: `solo_use_case_model_profile` returns `{"model":"x"}` only for exactly-one Structured UC with a non-null override, None for 0/2+ UCs or Simple variant; `ensure_webhook_secrets` mints exactly when secret absent/empty and never overwrites a present one; `normalize_agent_icon` resolves each tier (bare id, Lucide name, connector name, keyword) and falls back to `assistant`; `find_connectors_needing_setup` flags Simple connectors + Structured with `has_credential != true`.

## 7. persist_blueprint transaction (index→member-id mapping + atomic rollback) is untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/workflow_compiler.rs:144-320
- **Current test state**: exists-but-weak — only `validate` (self-loop/OOB) and `derive_team_name` are tested; the DB persistence path has no test.
- **Scenario**: `persist_blueprint` resolves blueprint connection indices to freshly-generated member UUIDs (`member_ids[bc.source_index]`) and inserts team + members + connections in one transaction that must roll back fully on any failure. A regression that mis-maps indices (e.g. inserts connections before members populate `member_ids`, or off-by-one) wires a connection to the wrong persona; a regression that drops transactional atomicity leaves a partial team. Neither is caught today.
- **Root cause**: Needs a DB pool, so it sits outside the pure-function tests that do exist.
- **Impact**: Composed team has edges pointing at the wrong members (broken handoff topology), or partial/orphan teams pollute the DB after a mid-insert failure.
- **Fix sketch**: Integration test on an in-memory pool: persist a 3-member, 2-connection blueprint, assert each connection's source/target member_id maps to the correct persona by position; then force a failing insert (e.g. duplicate id) and assert no team/members/connections remain (rollback). Note `dropped_connections`/`warnings` are hardcoded to 0/empty despite validation rejecting invalid connections upstream — worth a test pinning that contract.

## 8. handleBuildSessionStatus / handleBuildCellUpdate status-validation fallbacks are untested
- **Severity**: low
- **Category**: missing-assertion
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:684-694 (cell status fallback), 770-778 (phase fallback), 695-706 (resolved→updated dataChanged path)
- **Current test state**: exists-but-weak — happy-path phase/cell transitions are tested, but the `isBuildPhase`/`isCellBuildStatus` drift-fallback branches (warn + fall back to 'failed'/'error') and the resolved→updated re-emit path are not.
- **Scenario**: These branches exist to protect against backend enum drift (a renamed/new phase or cell status) corrupting UI state — the comments say so. There's also subtle logic: a repeat `resolved` cell whose `items` changed flips to `updated`, otherwise stays `resolved`. None of this is asserted, so a regression that lets an unknown status through (instead of falling back) or that breaks the dataChanged diff would mis-render build progress.
- **Root cause**: Defensive branches added later; tests only cover the valid enum values.
- **Impact**: Backend enum drift silently corrupts the build matrix UI instead of failing visibly; stale "resolved" cells that actually changed don't re-highlight.
- **Fix sketch**: Add tests: feed an unknown `status`/`phase` string → assert fallback to `error`/`failed` (spy/allow console.warn); feed two `resolved` cell_update events with different `items` → assert second yields `updated`; identical items → stays `resolved`.
