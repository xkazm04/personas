# Capabilities, Use Cases & Model Config — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. Promote verification runs a REAL execution whose input payload claims `_simulation: true`
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/../commands/core/use_cases.rs:692 (`verify_promoted_persona`, with `build_simulation_input` at use_cases.rs:253 and `is_simulation: false` at use_cases.rs:708)
- **Scenario**: If a user promotes a persona to `ready`, `verify_promoted_persona` builds its input via `build_simulation_input`, which unconditionally injects `_simulation: true` into the JSON payload — then executes with `is_simulation = false`.
- **Root cause**: The function was flipped from simulated to real execution (the two doc comments contradict each other: lines 658–664 say "the run is a simulation... stubs outbound delivery, so promoting a persona does not fire real emails / messages"; lines 693–698 say it runs "FOR REAL") but the input builder was not changed. Dispatch gates delivery on `ctx.is_simulation` (row-level), not the input flag, so delivery is real; the LLM, however, sees `_simulation: true` in its input.
- **Impact**: Two concrete failures. (a) Every promote fires real outbound notifications (emails/Slack/Telegram), contrary to the documented contract — a persona wired to email a customer will email them on every build promotion. (b) The persona's prompt/input tells it this is a simulation, so a model that honors the flag (or any protocol logic keying off `_simulation` in input) can skew the very `business_outcome` the promote gate reads, and the stored `input_data` of a real execution is permanently mislabeled as a simulation for anything auditing it later.
- **Fix sketch**: Add a `simulate: bool` parameter to `build_simulation_input` (or a sibling `build_verification_input`) that skips the `_simulation` injection when the run is real; pick one contract (real vs simulated) for `verify_promoted_persona`, make the flag, the row's `is_simulation`, and both doc comments agree.

## 2. Budget enforcement fails OPEN before the first spend fetch completes
- **Severity**: High
- **Category**: bug
- **File**: src/stores/slices/agents/budgetEnforcementSlice.ts:150-152
- **Scenario**: If a user opens the app (or the agent store is freshly created) and clicks the use-case "Run" button (or any `isBudgetBlocked` call site) before the first `fetchBudgetSpend` resolves, then `budgetStale === false`, `budgetLastFetchedAt === null`, the persona has no map entry, and the final branch returns `false` — execution allowed.
- **Root cause**: The slice is documented and built as fail-closed ("missing entry after initial fetch means data is in-flight — block"), but the never-fetched state (`budgetLastFetchedAt === null`) is explicitly treated as unblocked, and neither `getBudgetStatus` nor `isBudgetBlocked` kicks off a fetch in that state (passive refresh only fires on `budgetStale` or TTL expiry). The gate silently passes with zero data instead of returning `stale`.
- **Impact**: A persona already over its monthly budget can be run manually — a real, paid CLI spawn whose `emit_event` output cascades to downstream personas — in the cold-start window. Since enforcement is frontend-only by design (the backend has no budget-pause state, per useUseCaseDetail.ts:128-129), this window is the only gate and it's open. Worse, if no screen ever calls `fetchBudgetSpend`, the window is unbounded.
- **Fix sketch**: In both `getBudgetStatus` and `isBudgetBlocked`, treat `budgetLastFetchedAt === null` the same as stale: kick off `fetchBudgetSpend()` and return `'stale'` / `!budgetStaleOverrides.has(personaId)`. The existing stale-override toast already gives users an escape hatch.

## 3. Capability-disable confirmation dialog over-reports automation blast radius
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/core/use_cases.rs:296-300 (`get_use_case_cascade`) vs :119-129 (`cascade_use_case_toggle`)
- **Scenario**: If a persona has 3 automations linked to a use case but only 1 is `running` (the other 2 already `paused`/`failed`), the preview command counts `COUNT(*)` = 3, while the actual disable cascade only updates rows `IN ('running','active')` = 1. On re-enable the preview still reports 3 while the cascade deliberately updates 0.
- **Root cause**: The preview query and the mutation use different predicates: preview counts all rows matching `(persona_id, use_case_id)` regardless of `deployment_status` or direction, but the cascade filters by status on disable and intentionally touches nothing on enable. The preview also hardcodes `enabled: false`, so it cannot express direction.
- **Impact**: The confirmation dialog ("This will pause N automations") is wrong whenever any linked automation isn't running, and is always wrong for the enable direction — the UI promises "will resume/pause 3 automations" while the commit toast then reports a different number. Users approving a destructive-looking action based on inflated numbers, or being told nothing will happen when triggers/subscriptions WILL flip, erodes trust in the safety dialog this endpoint exists to power.
- **Fix sketch**: Accept the intended `enabled` direction as a parameter; for disable, count automations with `deployment_status IN ('running','active')`; for enable, return 0 for automations (matching the deliberate no-resume policy). Mirror the cascade's predicates verbatim so preview and mutation cannot drift.

## 4. Manual-run idempotency dedupe window slides on every click — rhythmic re-runs are silently collapsed while the UI reports success
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:146-152
- **Scenario**: If a user's manual run settles quickly (cheap capability, fast CLI failure, or immediate server-side rejection) and they click Run again ~0.9s after the previous click, the key is reused — and `lastRunRef` is rewritten with `{ at: now, key: sameKey }`. Every subsequent click spaced under 1s reuses the same key indefinitely: the window never closes because each deduped click extends it.
- **Root cause**: The dedupe window is anchored to the time of the *last click*, not the time the key was *minted* (or the run started). The design comment assumes a deliberate re-run always lands >1s after the previous click, but the sliding anchor breaks that invariant for any click cadence under 1s.
- **Impact**: Deliberate repeats are silently swallowed by the backend idempotency gate while the frontend logs "Manual run started" and flips `isManualRunning` through a normal success cycle — success theater: the user believes N runs were fired but one executed. Because `handleManualRun` is the documented way to exercise chained capabilities on demand, downstream event chains the user is trying to re-trigger simply don't fire, with no error anywhere.
- **Fix sketch**: Only refresh `lastRunRef.at` when a *new* key is minted (keep `{ at: prevRun.at, key: prevRun.key }` on reuse), so the window is anchored to key creation and hard-expires after `MANUAL_RUN_DEDUPE_MS`. Optionally surface "duplicate suppressed" when the server returns an existing execution id.

## 5. Budget stepper accepts $0, which the enforcement layer silently interprets as "no budget / unlimited"
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/agents/sub_model_config/components/BudgetControls.tsx:34-44 (with the inverting semantics at src/stores/slices/agents/budgetEnforcementSlice.ts:71)
- **Scenario**: If a user wants to hard-stop a persona's spend and sets "Max budget" to `$0` (the stepper's `min={0}` invites exactly this — stepping down from $0.01 lands on 0), `deriveStatus` treats `maxBudget <= 0` as `{ status: 'ok' }` — the persona is never budget-warned, never budget-paused, and spends without limit.
- **Root cause**: The UI's floor value (0) and the enforcement layer's "falsy/zero means unconfigured" sentinel occupy the same value with opposite meanings. There is no validation, helper text, or distinct "unlimited" affordance to disambiguate; clearing the field (allowEmpty) and typing 0 look like different intents but only one of them is representable.
- **Impact**: The user's most conservative possible input produces the least conservative behavior — unlimited spend on a paid execution pipeline — with zero feedback. This is the inverse-intent failure mode of a money control.
- **Fix sketch**: Set `min={0.01}` on the budget stepper (empty already means "no budget"), or explicitly render "$0 = no limit" as inline helper text; ideally have `deriveStatus` treat `0` as exceeded-at-any-spend and reserve `null` alone for "unlimited".
