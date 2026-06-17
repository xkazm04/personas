# Test Mastery — Approvals & Decisions
> Total: 8 findings (2 critical, 3 high, 2 medium, 1 low)

## 1. Approval state machine (load_pending / finalize_approval) has no CAS-race test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/companion/approvals.rs:499-574 (`load_pending`, `finalize_approval`)
- **Current test state**: none
- **Scenario**: An Athena-proposed action (run a persona, resolve a human review, post to a team channel, write a fact) is gated behind an approval card. The whole safety contract is that an approval executes EXACTLY ONCE: `load_pending` flips `pending→running` via a conditional `UPDATE ... WHERE status='pending'` and bails when `changed == 0`; `finalize_approval` flips `running→{approved|rejected|approved_failed}` the same way. If a refactor drops the `WHERE status=...` clause or stops checking `changed`, a double-click / concurrent `companion_approve_action` + autonomous `auto_resolve_if_allowed` on the same row would BOTH execute the side-effect (e.g. start two executions, post a team message twice, write a fact twice) and no test would catch it.
- **Root cause**: These are private fns needing a `State<Arc<AppState>>` + a real `companion_approval` row, so they were never unit-tested; the only test in the 3727-line file is the `confidence_gate_tests` string parser.
- **Impact**: Silent double-execution of approved actions — the exact "approve once, fires twice" class that turns a consent surface into an unsafe one. Highest blast radius in this context.
- **Fix sketch**: Add a `#[cfg(test)]` module using an in-memory user_db (the repo already exercises sqlite in tests elsewhere): seed a `companion_approval` row with status='pending', assert (a) first `load_pending` returns `(action,params)` and leaves status='running'; (b) second `load_pending` on the same id returns `Err` containing "not pending"; (c) `finalize_approval` from 'running' succeeds and a second `finalize_approval` returns the "could not finalize" error. Invariant to assert: **a single approval row transitions through running exactly once; any second transition attempt is refused, never silently a no-op-that-looks-like-success.**

## 2. fleet autonomous PTY guards (Athena-owned + cwd containment) are untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/companion/approvals.rs:3078-3086 (`fleet_send_input_targets_athena_session`), 3257-3289 (`validate_fleet_cwd`)
- **Current test state**: none
- **Scenario**: Under autonomous mode, `auto_resolve_if_allowed` will auto-fire `fleet_send_input` (type `{text}\r` into a terminal) and `fleet_spawn`/`fleet_dispatch` run `claude --dangerously-skip-permissions` in a cwd. Two guards stop this from becoming "Athena types into the user's OWN live terminal" or "runs a permission-bypassing agent anywhere on disk": `fleet_send_input_targets_athena_session` must return `false` for a missing/unparseable/unknown/user-owned `session_id` (fail-closed), and `validate_fleet_cwd` must reject any cwd that isn't inside a registered `dev_projects` root (canonicalized, so `..`/symlink escapes are caught). The sibling confidence gate (`fleet_send_input_is_high_confidence`) HAS a test; these higher-stakes guards do not.
- **Root cause**: `validate_fleet_cwd` needs an `AppHandle`/state for the project list and the registry guard needs the live fleet registry, so neither got the lightweight unit test the string-only confidence gate got.
- **Impact**: A regression that loosened either guard (e.g. `unwrap_or(true)`, or a containment check that uses `String::starts_with` on un-canonicalized paths so `C:\proj-evil` matches `C:\proj`) would let autonomous Athena drive an unauthorized PTY or skip-permissions claude in an arbitrary directory. Security-critical.
- **Fix sketch**: For `fleet_send_input_targets_athena_session` add a pure-parse test mirroring the existing confidence test: assert `false` for `"not json"`, `{}`, missing `session_id`, and an unknown id (registry returns not-owned). For `validate_fleet_cwd`, factor the path-containment check into a pure helper `cwd_within_any(roots: &[PathBuf], cwd: &Path) -> bool` and test it directly with a tempdir: assert a subdir of a root passes, a sibling `proj-evil` next to `proj` FAILS, and `..` escape FAILS. Invariant: **fail-closed — anything not provably Athena-owned / provably inside a registered root is rejected.**

## 3. abort_retry → goal_shelve repeat-attempt downgrade backstop is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/athena_reaction.rs:1082-1097 (`run_athena_review_resolution` outcome mapping) and 904-910 (retryable-class skip)
- **Current test state**: exists-but-weak (parser tests cover JSON extraction; the decision-mapping logic is not covered)
- **Scenario**: This is the deterministic safety backstop on top of the LLM call. When a goal already has `aborted_attempts >= 2`, the prompt forbids `abort_retry`, but if the model picks it anyway the code MUST downgrade to `goal_shelve` so the loop converges instead of orbiting (a full team attempt costs money/time per lap). Separately, `find_review_resolution_candidates` must SKIP a parked assignment when every failed step is "retryable-class" (rate/usage/session limit, app-restart) because auto-resume owns those — escalating them paged the human about parks that self-healed. Both are pure-ish decisions with no assertion today.
- **Root cause**: The downgrade is buried inside a large async fn; only the `parse_athena_review` JSON path was extracted into the tested surface.
- **Impact**: A regression silently removing the `aborted_attempts >= 2` clamp re-enables infinite abort→re-attempt→re-park laps (cost + deadlock); losing the retryable skip resurrects false escalations that page the user for self-healing failures. Both are exactly the regressions that "look fine in a smoke test."
- **Fix sketch**: Extract the outcome-mapping into a pure `fn map_review_outcome(resolution: &str, aborted_attempts: i64) -> &'static str` and unit-test it: `("abort_retry", 2) == "goal_shelve"`, `("abort_retry", 1) == "abort_retry"`, `("approve", _) == "approve"`, unknown → `"escalate"`. Invariant: **abort_retry is impossible once aborted_attempts ≥ 2.** (The retryable-skip SQL is integration-shaped; note it as a candidate for a seeded-db test rather than blocking.)

## 4. ApplyClientAction route/tab allowlist + approved_failed non-resolution are untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/plugins/companion/ApprovalCard.tsx:32-77 (`applyClientAction`), 101-117 (approve handler)
- **Current test state**: none (DecisionsPanel is well-tested; ApprovalCard is not)
- **Scenario**: Approving a card can carry a `ClientAction` that navigates the sidebar, prefills the persona wizard, deep-links a companion tab, or opens an external URL. `applyClientAction` guards each: an unknown `navigate` route is dropped (`VALID_ROUTES.includes`), an unknown companion tab is dropped (`VALID_COMPANION_TABS`), external URLs go through the validated `openExternalUrl`. Separately, when the backend returns `status==='approved_failed'` the card must show the failure banner and NOT call `onResolved` (so the card stays visible to retry). None of this is asserted; a regression that navigates on an unvalidated route, or that calls `onResolved` on a failed outcome (making the card vanish as if it succeeded), ships silently.
- **Root cause**: ApprovalCard was shipped without a component test; the area's testing effort went to DecisionsPanel and decisionExplain.
- **Impact**: A "build-but-unwired"-style UX break: approval that reports success while the action failed, or an unsafe navigation, with no signal. This is the user-facing half of the same consent surface as finding #1.
- **Fix sketch**: vitest + Testing Library. Mock `@/api/companion`; (a) `companionApproveAction` resolves `{status:'approved_failed', message:'Execution failed: boom'}` → assert the amber banner renders and `onResolved` was NOT called; (b) resolves `{status:'approved', clientAction:{type:'navigate', route:'personas'}}` → assert `setSidebarSection('personas')` called; (c) `{type:'navigate', route:'evil'}` → assert NO navigation. Invariant: **only allowlisted client actions take effect; a failed outcome never resolves the card.**

## 5. runDecisionOption "keep pending on failure" fix has no direct test
- **Severity**: high
- **Category**: missing-assertion
- **File**: src/features/plugins/companion/decision/resolveDecision.ts:37-55 (`runDecisionOption`)
- **Current test state**: exists-but-weak — `decisionExplain.test.ts` simulates the pick handler MANUALLY (`decision.options[0].run(); g.clearPendingDecision();`) instead of exercising the real module, so it cannot catch a regression in `runDecisionOption` itself.
- **Scenario**: The doc comment calls the prior fire-and-forget behavior "the worst class of bug": a rejected approve/reject (concurrent resolution, pool error, executor failure) left the user believing they decided while the system did neither AND the decision vanished. The fix awaits `option.run()` and, on throw/reject, KEEPS the decision pending + toasts + does NOT record `decision_resolved`. The hands-free orb / `;`-key / voice paths all route through here. No test pins this contract against the real function.
- **Root cause**: The existing slice-4 test asserts the store contract by reconstructing the handler inline, never importing `runDecisionOption`, so the regression-catching value is in the wrong place.
- **Impact**: A future edit reverting to fire-and-forget (or clearing before the await resolves) re-introduces the "thought I approved but nothing happened, and it's gone" data-loss-of-intent bug across every hands-free input method — invisibly.
- **Fix sketch**: Test `runDecisionOption` directly: set a pending decision, call with an option whose `run` rejects → assert `pendingDecision` is STILL set, a toast was added, and `companionRecordUxSignal` was NOT called; then with a resolving `run` → assert decision cleared and the signal recorded once. Invariant: **a failed option keeps the decision answerable and is never counted as resolved.**

## 6. athenaLabels pure helpers + backend-slug drift are untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/plugins/companion/athenaLabels.ts:31-239 (`actionLabel`, `triggerKindLabel`, `capabilityLabel`, `connectorDisplayName`, `titleCase`, `stripModelDirectives`)
- **Current test state**: none
- **Scenario**: These are the single source of truth turning backend slugs into human labels; the file's own header promises "None of these should ever return the raw slug." `stripModelDirectives` is a pure display filter that must remove `OP:`/`QR:`/`TTS:`/`{"op"` lines so raw JSON never flashes in chat. `titleCase` underpins every unknown-slug fallback. These are perfect for a generated batch that asserts a real invariant — not a snapshot.
- **Root cause**: Pure helpers added incrementally without a co-located test.
- **Impact**: A bad edit to `stripModelDirectives` leaks raw `{"op":...}` JSON into the user's chat; a fallback that returns the raw slug shows "fleet_send_input" on an approval card. Low blast radius but high visibility.
- **Fix sketch**: LLM-generatable. Pass a minimal fake `t`. Assert: `titleCase('fleet_send_input') === 'Fleet Send Input'`, `titleCase('') === ''`; `stripModelDirectives` drops directive lines while preserving prose + interior paragraph breaks and trims trailing blank lines; `actionLabel`/`triggerKindLabel` return the i18n key for a known slug and the fallback (never the raw slug) for an unknown one. Invariant to assert: **every helper returns a human string, never the raw machine slug.** Bonus drift guard (medium value): a test that reads the `AUTOAPPROVE_ALLOWLIST` / action set is hard cross-language — instead assert `actionLabel` has a non-fallback case for each action the UI commonly surfaces, so adding a backend action without a label is noticed.

## 7. companion_list_pending_approvals skips corrupt/blank-action payloads — untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/companion/approvals.rs:123-182 (`companion_list_pending_approvals`)
- **Current test state**: none
- **Scenario**: This list feeds the approval cards. A deliberate fix here SKIPS rows whose payload is unparseable or whose `action` is empty/whitespace — because an empty-action row previously rendered an actionable card whose Approve button did nothing (a "consent surface showing a no-op as if it were a real decision"). The filtering loop (parse → `action.trim()` empty-check → push) has no test, so a regression that `unwrap_or_default()`s the action back into a blank card would return.
- **Root cause**: Tauri command needing a DB; the filtering logic was never extracted or seeded-db tested.
- **Impact**: Blank/ghost approval cards return — a small but real integrity break on the consent surface.
- **Fix sketch**: Seeded in-memory user_db test: insert three pending rows — one valid, one with payload `"not json"`, one with `{"action":"  "}` — assert the result contains only the valid one. Invariant: **only rows with a non-empty, parseable action become cards.**

## 8. companion_list_design_decisions limit clamp is untested
- **Severity**: low
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/companion/decisions.rs:23-35 (`companion_list_design_decisions`)
- **Current test state**: none (frontend DecisionsPanel is well-covered)
- **Scenario**: The decision log is an immutable audit trail; this read clamps `limit` to `1..=500` (`unwrap_or(100).clamp(1,500)`) and branch-selects `list_by_context` vs `list_recent` on a trimmed/non-empty `persona_context`. A regression dropping the clamp could let a caller request an unbounded result set; dropping the trim/empty filter would route a blank context string to the wrong query.
- **Root cause**: Trivial-looking wrapper, never tested in isolation.
- **Impact**: Minor — unbounded query / wrong branch on a read path. Low blast radius (read-only audit data).
- **Fix sketch**: Extract the two pure decisions into helpers and test them: `clamp_limit(None)==100`, `clamp_limit(Some(9999))==500`, `clamp_limit(Some(0))==1`; `context_branch(Some("  "))` selects recent, `context_branch(Some("persona_A"))` selects by-context. Invariant: **limit is always 1..=500 and a blank context is treated as unscoped.**
