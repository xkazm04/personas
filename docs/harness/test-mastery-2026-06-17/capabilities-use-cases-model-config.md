# Test Mastery — Capabilities, Use Cases & Model Config
> Total: 8 findings (2 critical, 3 high, 2 medium, 1 low)

## 1. Frontend budget enforcement (fail-closed gate) is entirely untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/budgetEnforcementSlice.ts:70-156
- **Current test state**: none
- **Scenario**: This slice is the ONLY thing stopping a budget-exceeded persona from spending more money — the backend has no budget-pause state (per the module's own comment). `isBudgetBlocked` / `getBudgetStatus` / `deriveStatus` encode a deliberately fail-closed contract: stale cache blocks, TTL-expired cache blocks, a missing per-persona entry after first fetch blocks, exceeded blocks unless overridden. A refactor that flips any branch to fail-open (e.g. returning `false` for a missing entry, or treating stale as `ok`) would silently let paid CLI runs through and NO test would catch it. The exact bug the comments warn about ("fail-open window during cache invalidation") is one logic edit away from reintroduction.
- **Root cause**: Pure, dependency-light reducer logic that was hand-hardened against money-losing race windows but never pinned by tests.
- **Impact**: Uncapped LLM spend on a persona the user explicitly told the system to pause; the user's own MEMORY flags "budget-bypass" as a recurring critical-class bug.
- **Fix sketch**: vitest suite driving the slice via `createBudgetEnforcementSlice` with a fake `set/get`. Assert business invariants: (a) `deriveStatus`: ratio>=1.0⇒exceeded, >=0.8⇒warning, <0.8⇒ok, null/<=0 budget⇒ok; (b) `isBudgetBlocked` returns true when `budgetStale`, when `now-budgetLastFetchedAt>BUDGET_TTL_MS`, and when entry missing but `budgetLastFetchedAt!==null` — and `false` only with a fresh non-exceeded entry; (c) override sets unblock the matching persona only; (d) `clearBudgetOverrides` empties both sets. Use `vi.useFakeTimers()` to drive the TTL boundary deterministically.

## 2. Capability cascade rollback (`rename_event_listeners`, partial-write atomicity) has no test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/core/use_cases.rs:490-578 (also 427-462)
- **Current test state**: none (the `#[cfg(test)]` module covers `cascade_use_case_toggle`, `build_simulation_input`, and `patch_generation_settings` well, but `rename_event_listeners` and `count_event_listeners` are untested)
- **Scenario**: `rename_event_listeners` rewrites BOTH `persona_event_subscriptions` and `persona_triggers` inside one transaction; the code comment states the explicit invariant: "both land or neither … a mid-way failure would leave consumers half-migrated — some listening on the old name, some on the new, with no error surfaced." There is no test that a forced mid-transaction failure rolls BOTH writes back, nor that the JSON1 `json_set` path only touches triggers whose parsed `$.event_type` exactly equals `from_event` (the comment lists four raw-REPLACE hazards it must avoid: partial-name match like "alert" in "alert_high", whitespace no-ops, all-occurrence rewrites, unrelated-field rewrites). A regression here silently breaks event wiring between personas.
- **Root cause**: New IPC commands added without extending the existing inline test module that already has the `init_test_db` + seed harness right beside them.
- **Impact**: Renaming an event can half-migrate consumers (some on old name, some on new) with no error — chained capabilities (UC1→UC2 across personas) silently stop firing; data-integrity class bug.
- **Fix sketch**: Inline Rust tests reusing `init_test_db`. (a) Seed 1 sub + 1 event_listener trigger with `config={"event_type":"alert"}` plus a decoy trigger `{"event_type":"alert_high"}`; assert `Update` rewrites only the exact-match rows and leaves the decoy untouched; assert `excluding_persona_id` excludes the renamer. (b) `Delete` removes exact matches only. (c) `Leave` touches 0. (d) `count_event_listeners` returns correct counts and respects exclude. (e) Atomicity: assert empty `from_event`/`to_event` returns Validation before any write.

## 3. `resolveEffectiveModel` / `profileToModelConfig` model-tiering cascade is untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/agents/sub_use_cases/libs/useCaseDetailHelpers.ts:42-118
- **Current test state**: none
- **Scenario**: This is the precedence engine that decides which (possibly paid) model a capability runs on: use_case override → persona `model_profile` (JSON-parsed) → hardcoded sonnet default. The `JSON.parse` of `personaModelProfile` is wrapped in `silentCatch`, so a malformed profile silently falls through to the sonnet default — a behavior that must stay pinned (a regression that threw, or that picked the wrong provider/base_url for ollama, would route runs to the wrong/more-expensive model or break local-model routing). `profileToModelConfig` also maps ollama presets and carries `base_url`/`auth_token` — easy to break in a refactor.
- **Root cause**: Pure mapping/resolution functions with clear inputs/outputs that were never given a test batch.
- **Impact**: Capability silently runs on the wrong model tier (cost/quality regression) or local-model routing breaks; the user's MEMORY explicitly demands BYOM/local routing be proven, not assumed.
- **Fix sketch**: LLM-generatable vitest batch asserting invariants (not snapshots): override wins and `source==='override'`; valid persona JSON ⇒ `source==='persona'` with parsed provider/model; **malformed persona JSON ⇒ falls back to sonnet default, never throws**; null/undefined ⇒ default; `profileToModelConfig` for ollama yields `provider:'ollama'` + correct `base_url` + preserved `auth_token`; anthropic with no model defaults to `sonnet`; empty profile (`{}`) ⇒ null config. Also `profileToOptionId`/`profileToLabel` round-trip for each preset.

## 4. `useToolRunner` cross-persona result-bleed guards are assertion-free in CI
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/agents/sub_tool_runner/libs/useToolRunner.ts:24-134
- **Current test state**: none
- **Scenario**: This hook is loaded with subtle, comment-documented correctness guards: synchronous ref update (to avoid commit-vs-effect lag), dropping an in-flight result when the persona switched mid-IPC, a 120s timeout that releases `isRunning`, and double-click de-dupe. The headline risk is the cross-persona bleed it explicitly defends against: "a tool run started under persona A … surfaced under persona B." None of this is tested, so a refactor that reverts the ref to a `useEffect` or drops the `runPersonaId !== personaIdRef.current` check would silently show one persona's (possibly sensitive) tool output under another.
- **Root cause**: Tricky async/stale-closure logic that lives only in prose comments, not executable assertions.
- **Impact**: Wrong persona's tool result (potentially containing credential-backed data) displayed under another persona; also a hung IPC could pin the Run button forever if the timeout breaks.
- **Fix sketch**: `@testing-library/react` `renderHook` with `invokeToolDirect` mocked. Assert: result from a run started under persona A is dropped after rerendering with persona B (state stays EMPTY_STATE); `getState` returns EMPTY_STATE when stored `personaId` mismatches current; second click while running is a no-op (mock called once); timeout path sets `error` and clears `isRunning` (drive with `vi.useFakeTimers()`); missing-persona path sets the explanatory error string.

## 5. Server-side simulate/verify enable-gate semantics rely on a brittle `include_str!` source-grep
- **Severity**: high
- **Category**: missing-assertion
- **File**: src-tauri/src/commands/core/use_cases.rs:974-985 (test), guarding 592-639 & 661-702
- **Current test state**: exists-but-weak
- **Scenario**: The contract that `is_simulation = true` ⇒ no real notifications is "tested" only by `dispatch_module_contains_simulation_short_circuit`, which `include_str!`s `dispatch.rs` and asserts it contains the literal strings `"if ctx.is_simulation"` and `"[SIM]"`. This is success theater: it passes if the branch exists *textually* even if the branch body is wrong, and breaks on a harmless rename while a real delivery-suppression bug slips through. Meanwhile the genuinely risky behaviors — `simulate_use_case` BYPASSING the `enabled` gate, and `verify_promoted_persona` running the capability FOR REAL (`is_simulation=false`, with a comment noting a prior bug where simulated verification let non-working personas ship as "ready") — have no behavioral test at all.
- **Root cause**: A true integration test needs an `execute_persona_inner` harness that doesn't exist yet (the test's own comment admits this), so a string-grep stand-in was left in place and the gate-bypass/real-run semantics went uncovered.
- **Impact**: A simulation could fire real emails/messages, or promote could re-ship non-working personas as "ready" — neither caught by the current grep test.
- **Fix sketch**: Replace the source-grep with a behavioral test against a seam: extract a small pure predicate (e.g. `should_deliver(is_simulation) -> bool`) or a mock notifier injected into dispatch, and assert simulation ⇒ no delivery. Add a `verify_promoted_persona` test (or a `pick_first_invokable_use_case` unit) asserting an all-`event_listener` persona yields `None` (leave `ready`) and that a manually-invokable capability is selected.

## 6. `useCaseHelpers` design_context parse/serialize round-trip is untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/agents/sub_use_cases/libs/useCaseHelpers.ts:11-37
- **Current test state**: none
- **Scenario**: `getUseCaseById` / `getUseCases` / `updateUseCaseInContext` parse and re-serialize the persona `design_context` JSON blob that the cascade backend also reads. `updateUseCaseInContext` must update only the matching use case and preserve all other top-level keys and sibling use cases — a regression that drops sibling data or mangles non-matching entries would corrupt a persona's capability set on the next save. The frontend and Rust must agree on the array shape (`use_cases`/`useCases`), and nothing pins that.
- **Root cause**: Thin wrappers over `parseDesignContext`/`serializeDesignContext` assumed trivial; the data-loss edge (preserve siblings + other keys) is the real risk.
- **Impact**: Editing one capability silently drops sibling capabilities or other design_context fields → corrupted persona config.
- **Fix sketch**: LLM-generatable vitest batch. Invariants: `getUseCaseById` returns the right uc and `undefined` for unknown id / null context; `updateUseCaseInContext` updates only the target, leaves siblings byte-identical, and preserves other top-level keys; round-trip `parse(serialize(x)) === x` for a representative context; empty/null/garbage input degrades to `[]` not a throw.

## 7. No quality gate / coverage ratchet on money- and routing-critical store slices
- **Severity**: medium
- **Category**: quality-gate
- **File**: vitest.config.ts:10-18
- **Current test state**: none (no `coverage` block; `@vitest/coverage-*` thresholds absent)
- **Scenario**: The vitest config defines no coverage thresholds and no per-area gate, so the budget slice, model-resolution helpers, and tool slice can lose their (soon-to-be-added) tests with zero CI signal. Given the spend-control and model-routing blast radius here, a targeted new-code ratchet is warranted — a full-repo backfill mandate would just get bypassed.
- **Root cause**: Suite is opt-in; no thresholds wired into the runner.
- **Impact**: Newly added safety tests silently rot; the fail-closed budget contract regresses unnoticed.
- **Fix sketch**: Add a `test.coverage` block (v8 provider) with a modest global floor plus a per-file/per-glob threshold for `src/stores/slices/agents/budgetEnforcementSlice.ts` and `src/features/agents/sub_use_cases/libs/**` once findings 1/3/4/6 land. Keep it advisory-then-blocking (start as a new-code ratchet so it fires on regressions without demanding a giant backfill).

## 8. `BudgetControls` empty/clamp coercion (`'' ↔ null`, min bounds) is untested
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/features/agents/sub_model_config/components/BudgetControls.tsx:34-64
- **Current test state**: none
- **Scenario**: The component maps `NumberStepper`'s `null` back to `''` (`onChange={(v) => onMaxBudgetChange(v ?? '')}`) and only forwards numeric values up (`typeof maxBudget === 'number' ? maxBudget : null`), with `min={0}` for budget and `min={1}` for turns. A regression that forwarded `0`/negative/empty differently, or dropped the `min` bound, would let a user set a $0 or negative budget that interacts badly with the enforcement ratio math in finding 1.
- **Root cause**: Small presentational adapter assumed trivial; the empty↔null coercion is the load-bearing bit.
- **Impact**: A malformed budget value could disable enforcement (e.g. budget coerced to 0/empty ⇒ `deriveStatus` returns `ok` regardless of spend).
- **Fix sketch**: Light `@testing-library/react` render asserting the `value` passed to each `NumberStepper` (number→number, `''`/null→null) and that `onChange(null)` surfaces `''` to the parent callback; assert `min` props (0 for budget, 1 for turns) are present. Pair with finding 1's `deriveStatus(0,...)` assertion so the end-to-end "0 budget ⇒ not-exceeded" behavior is documented as intentional or fixed.
