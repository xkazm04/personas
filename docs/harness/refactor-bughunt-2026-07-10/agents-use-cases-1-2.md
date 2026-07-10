> Context: agents/use_cases [1/2]
> Total: 10
> Critical: 0  High: 3  Medium: 4  Low: 3

## 1. Selecting the "Opus" model override silently runs Sonnet
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case / money-correctness
- **File**: src/features/agents/sub_use_cases/libs/useCaseDetailHelpers.ts:25, 63-67
- **Scenario**: The `MODEL_OPTIONS` entry for Opus is `{ id: 'opus', label: 'Opus', provider: 'anthropic' }` — it has **no `model` field** (Haiku/Sonnet both do). When the user picks Opus in `UseCaseModelDropdown`/`TileModelStrip`, `handleModelSelect` builds `model_override = { model: undefined, provider: 'anthropic' }`. `profileToModelConfig` then returns `{ id: mp.model || 'sonnet', model: mp.model }` → id `'sonnet'`, `model: undefined`. So the test/execution config carries no Opus model. Meanwhile `profileToLabel`/`profileToOptionId` match on `o.model === mp.model` (both `undefined`), so the UI keeps showing "Override: Opus". User believes they are running (and paying for) Opus; the run actually goes out as the anthropic default/sonnet.
- **Root cause**: The Opus option omits the concrete model slug that every other option carries; the `mp.model || 'sonnet'` fallback then quietly substitutes a different model instead of erroring.
- **Impact**: Wrong model executed on a normal path, wrong cost/quality, no signal to the user. Same latent defect is duplicated in the (dead) `detail/UseCaseModelOverride.tsx` opus entry.
- **Fix sketch**: Add `model: 'opus'` to the Opus `MODEL_OPTIONS` entry (and the dead override list if kept). Optionally make `profileToModelConfig` throw/log rather than defaulting to `'sonnet'` when an anthropic profile has no model.

## 2. "Run now" on the capability tab bar double-spends and bypasses the budget gate
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: race-condition / money-correctness
- **File**: src/features/agents/sub_use_cases/components/persona-layout/PersonaLayoutView.tsx:224-246
- **Scenario**: `handleRunActiveCapability` guards only on `isManualRunning` (React state) and `isExecuting`. Two clicks landing in the same render commit both read `isManualRunning === false` and each call `executePersona(...)` — a real, paid CLI spawn — with two fresh `crypto.randomUUID()` idempotency keys, so the backend cannot collapse them. It also never calls `useAgentStore.getState().isBudgetBlocked(personaId)`. `useUseCaseDetail.handleManualRun` deliberately added BOTH a synchronous `runInFlightRef` reentrancy guard AND the budget-block gate for exactly this IPC; this second copy of the button never received either fix.
- **Root cause**: The view-mode run-now button was cloned from the detail hook's logic before (or without) the hardening the hook documents in its own comments.
- **Impact**: Duplicate paid executions on a fast double-click; a budget-exceeded persona can still be spent through this button while the Runner UI shows it paused.
- **Fix sketch**: Add a `useRef` in-flight guard set synchronously before the first `await` and cleared in `finally`; add the `isBudgetBlocked` check + toast mirroring `handleManualRun`; ideally reuse the hook instead of duplicating.

## 3. Concurrent policy toggles drop each other's change (lost update)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: race-condition / state-corruption
- **File**: src/features/agents/sub_use_cases/components/recipes-prototype/shared/usePolicyControls.ts:60-100
- **Scenario**: `settings` is memoized from `uc.raw.generation_settings` (props). Each toggle builds `{ ...settings, <key>: next }` then `await setUseCaseGenerationSettings` then `await fetchDetail`. `pending` is a single key, and in the callers each card is disabled only for its OWN key (`policy.pending === 'memories'`, etc.). So while the memories write + refetch is in flight, the Events/Review cards stay clickable. Clicking Events uses the still-stale `settings` (memories change not yet reflected in `uc.raw`), and its persisted payload overwrites the memories value back to the old state.
- **Root cause**: Read-modify-write off stale props with no cross-key lock and per-key-only disabling; the "source of truth" only updates after `fetchDetail` completes.
- **Impact**: A quick memory→events (or any two-key) sequence silently reverts the first toggle; user sees the change flip back after the refetch.
- **Fix sketch**: Serialize writes behind a single in-flight lock (disable all three while any `pending`), or build each payload from the latest server settings inside the mutator/queue rather than the memoized props snapshot.

## 4. Notification channel toggles have the same lost-update race
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition / state-corruption
- **File**: src/features/agents/sub_use_cases/components/recipes-prototype/shared/NotificationsDimCard.tsx:37-60, 104-135
- **Scenario**: `handleToggle` computes `next` from `channels = uc.raw.notification_channels` and awaits `mutateSingleUseCase` then `fetchDetail`. `pending` disables only the single channel type currently writing; the other channel rows stay enabled. Toggling Slack, then Telegram before the Slack refetch returns, computes Telegram's `next` from the stale channel array (no Slack change) and persists it, dropping the Slack toggle.
- **Root cause**: Same stale-props RMW + per-item-only disabling as finding 3.
- **Impact**: Rapidly enabling two channels can leave only one enabled; silent for the user.
- **Fix sketch**: Disable the whole channel list while any toggle is pending, or fold multiple toggles into one atomic mutator that reads current channels server-side.

## 5. EventRenameModal "Update consumers" silently no-ops if advisory counts haven't loaded
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / race-condition
- **File**: src/features/agents/sub_use_cases/components/core/EventRenameModal.tsx:63-93, 127-133
- **Scenario**: Consumer counts are fetched asynchronously (advisory, `.catch(() => {})`). `handleSave` only reconciles rows where `(r.existingCounts?.subscriptions ?? 0) + (r.existingCounts?.triggers ?? 0) > 0`. If the user types a `from`/`to` and hits "Save aliases" before `countEventListeners` resolves, `existingCounts` is still `undefined`, so the row is filtered out and `renameEventListeners` is never called — even though the user explicitly chose the "Update" action. Consumers silently keep listening to the old name.
- **Root cause**: The reconcile decision is gated on a racing, best-effort UI count rather than the server performing the reconcile authoritatively.
- **Impact**: User picks "update consumers", gets a success toast, but downstream subscriptions/triggers are not rewired — the exact breakage the dialog exists to prevent.
- **Fix sketch**: When `action !== 'leave'`, call `renameEventListeners` for every row with non-empty from+to and let the backend report 0 touched; don't pre-filter on the advisory count.

## 6. Dead scheduling subtree — entire UseCaseSubscriptions tree is unreferenced
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/agents/sub_use_cases/components/schedule/* (UseCaseSubscriptions.tsx, SubscriptionList.tsx, ScheduleBuilder.tsx, ScheduleModePanels.tsx, DayTimeGrid.tsx, SchedulePreview.tsx, UseCaseSubscriptionForm.tsx) + libs/scheduleHelpers.ts
- **Scenario**: `UseCaseSubscriptions` is the only entry point into this subtree, and a repo-wide grep finds it imported nowhere outside its own file. `ScheduleBuilder`/`SubscriptionList`/`SchedulePreview` are referenced only within the subtree (the `sub_triggers` matches are unrelated `TriggerSchedule*` components). `scheduleHelpers` is consumed only by these files (its `DAYS`/`CRON_PRESETS` re-exports are used elsewhere via the canonical `@/lib/utils` modules, not this file). The whole tree is unreachable.
- **Root cause**: Scheduling UI was superseded by the persona-layout / trigger surfaces; the old tree was left behind.
- **Impact**: ~8 files of maintenance dead weight. It also hides a latent bug: `ScheduleBuilder.tsx:49-51` runs three overlapping `fetchPreview` effects (a debounced one plus an unconditional `useEffect(() => fetchPreview(cronExpression))` that fires on every keystroke), defeating the 400ms debounce and double-fetching the preview — never observed because the code is dead.
- **Fix sketch**: Confirm no dynamic/test-bridge usage, then delete the `schedule/` directory + `scheduleHelpers.ts`. If any piece is intended for reuse, wire it in and fix the triple-fetch first.

## 7. Dead component: UseCaseTestRunner.tsx
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/agents/sub_use_cases/components/core/UseCaseTestRunner.tsx:1-192
- **Scenario**: `UseCaseTestRunner` is imported nowhere (grep hits only its own definition). Its test/fixture responsibilities were absorbed by `useUseCaseDetail` + `UseCaseDetailPanel`. It also contains a weaker copy of the fixture handlers that call `mutateSingleUseCase` fire-and-forget without checking `result.applied` (the live hook fixed that as "success theater").
- **Root cause**: Superseded during the detail-panel refactor, not removed.
- **Impact**: Maintenance cruft; risk that someone revives the inferior fixture-save path.
- **Fix sketch**: Delete the file after confirming no dynamic usage.

## 8. Dead components: UseCaseModelOverride.tsx + UseCaseModelOverrideForm.tsx (with duplicated model tables)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code / duplication
- **File**: src/features/agents/sub_use_cases/components/detail/UseCaseModelOverride.tsx:1-203, detail/UseCaseModelOverrideForm.tsx:1-71
- **Scenario**: `UseCaseModelOverride` is imported nowhere; `UseCaseModelOverrideForm` is imported only by it. The live model UI is `UseCaseModelDropdown` (fed by `useCaseDetailHelpers`). The dead file re-declares its own `MODEL_OPTIONS` and `profileToLabel`, duplicating (and drifting from) the canonical tables in `useCaseDetailHelpers.ts` — including the same Opus-without-model defect from finding 1.
- **Root cause**: Older override widget replaced by the dropdown; left in place with its private copy of the model catalog.
- **Impact**: Two sources of truth for model options; a future edit to the real table won't reach this copy.
- **Fix sketch**: Delete both files. If the custom-provider expansion form is still wanted, fold it into the live dropdown and import the shared `MODEL_OPTIONS`.

## 9. Dead component: DefaultModelSection.tsx
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/agents/sub_use_cases/components/core/DefaultModelSection.tsx:1-138
- **Scenario**: `DefaultModelSection` is imported nowhere (grep hits only its own definition). Persona default-model editing now lives in the model-config feature / `PersonaCrest` right-slot pattern. Its `resolveModelLabel` also defaults an empty model to "Opus" (line 15), inconsistent with the app's real anthropic default of Sonnet — another reason not to let it drift back into use.
- **Root cause**: Left over after the model-config surface moved.
- **Impact**: Dead file plus a misleading default-label helper.
- **Fix sketch**: Delete after confirming no dynamic usage.

## 10. Deprecated dead exports: HEALTH_META and MODE_META
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase.ts:101-139
- **Scenario**: The `@deprecated` English-only `HEALTH_META` and `MODE_META` constants are referenced nowhere outside this file (only their own definitions + the doc comments on the `getHealthMeta`/`getModeMeta` factories). All live callers use the `get*Meta(t)` factories. (`STATE_HEX` just below them IS still used by `UseCaseRow.tsx`, so keep that one.)
- **Root cause**: Migration to translated factory functions completed; the deprecated fallbacks were never removed.
- **Impact**: Minor cruft; keeps an untranslated label table alive as a temptation.
- **Fix sketch**: Delete the two `@deprecated` consts; keep `STATE_HEX`.
