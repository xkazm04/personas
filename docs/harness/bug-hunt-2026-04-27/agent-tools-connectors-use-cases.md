# Bug Hunt — Agent Tools, Connectors & Use Cases

> Total: 14 | Critical: 1 | High: 6 | Medium: 5 | Low: 2

## 1. Manual run uses stale `selectedPersona` after switch — fires execution against wrong agent

- **Severity**: critical
- **Category**: race-condition
- **File**: `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:79-104`
- **Scenario**: User opens Use Case detail for Persona A, clicks "Run now", and within the same animation frame switches to Persona B before `executePersona` is invoked. Because `handleManualRun` reads `selectedPersona` directly from the closure but the callback is recreated only when `selectedPersona` changes, the click handler bound to the button will use whatever `selectedPersona` was at render time — but `useCaseId` came from Persona A's URL/state. The execution fires against the *currently selected* persona (which may be B) using a `useCaseId` that doesn't exist on B, OR (worse) it fires against B with B's matching UC if any exists, executing the wrong persona+UC pair entirely.
- **Root cause**: `handleManualRun` does not snapshot `personaId` at click time; it assumes `selectedPersona` cannot change between mount and click, but persona switches do not re-mount the panel. Unlike `useToolSelectorState` (which carefully captures `personaId = personaId` at click time), this code path takes the live store value.
- **Impact**: Real CLI spawn against wrong persona, real cost charged, real downstream `emit_event` cascading from the wrong agent. Production data corruption / unrecoverable.
- **Fix sketch**: Snapshot `selectedPersona.id` and `useCaseId` into local consts on the first line of `handleManualRun`, abort if the IDs no longer match the `useCase` lookup; or disable the button while a persona switch is pending.

## 2. `useToolImpactData` co-occurrence count double-counted (legacy) → false-high "frequently used together"

- **Severity**: high
- **Category**: latent-failure
- **File**: `src/features/agents/sub_tools/useToolImpactData.ts:127-133`
- **Scenario**: For every execution containing N tools, the legacy hook iterates over each tool and increments `coMap[other]` for all other tools in the execution. This double-traverses the pair set: tool A→B and tool B→A both increment, but the `coUsedTools` list shown to the user is "tools used alongside *this* tool" — which is supposed to be a count of executions containing both. The legacy file (`sub_tools/useToolImpactData.ts`) double-counts when the same execution contains the same tool twice (which happens often: e.g. multiple `read_file` calls in one execution), because `parseToolNames` deduplicates within an execution but the loop adds each pair once per tool occurrence regardless. The newer `libs/useToolImpactData.ts` uses an `i<j` pattern that is correct.
- **Root cause**: Two parallel implementations of the same hook exist (`sub_tools/useToolImpactData.ts` and `sub_tools/libs/useToolImpactData.ts`); the legacy one is reachable via `index.ts` re-exports / direct imports and silently produces wrong numbers.
- **Impact**: Co-used-tools list shows ~2× inflated co-occurrences. Users make decisions ("should I keep this tool because A and B always run together?") based on inflated numbers. Diverges from the corrected hook depending on which file consumers import.
- **Fix sketch**: Delete `src/features/agents/sub_tools/useToolImpactData.ts` and forward all imports to `libs/useToolImpactData.ts`; or fix the loop to use `i<j` pairs.

## 3. AutomationSetup double-fetch on credential change can race and overwrite with stale repos

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/sub_connectors/libs/useAutomationSetup.ts:134-151` and `usePlatformData.ts:17-45`
- **Scenario**: User selects GitHub creds A, the effect fires `Promise.all([githubListRepos(A), githubCheckPermissions(A)])`. Before it resolves, user picks creds B; effect re-runs and starts a parallel `Promise.all([…(B)])`. There is no AbortController, no generation counter, no ignore flag in the cleanup. If B resolves first then A resolves second, `setGithubRepos` is called with A's repos — even though the dropdown shows credential B selected.
- **Root cause**: Async effect with no cancellation. The cleanup function is empty.
- **Impact**: User picks creds for repo Y, but the dropdown is populated with repo X from the previous credential. Selecting an entry deploys against the *wrong account*. No error; deployment may succeed against the unintended GitHub org.
- **Fix sketch**: Use the `let cancelled = false; ... if (!cancelled) setX(...); return () => { cancelled = true; }` pattern (already used in `subscriptionLifecycle.ts`).

## 4. `useHealthDigestScheduler` `running` ref can lock out future digest attempts forever

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/agents/health/useHealthDigestScheduler.ts:34-101`
- **Scenario**: First effect mount sets `running.current = true`. The async IIFE throws (e.g. an uncaught exception inside `runFullHealthDigest` from a backend panic) before reaching the `finally`. Because the throw is unhandled (no `try/catch` around the IIFE body — only `finally`), `running.current` stays `true`. The `finally` does set `running.current = false` only when `!ran.current`, so this is OK in some paths — but the IIFE has no `try`. JavaScript: a `try/finally` with no catch will rethrow after `finally`. That's actually fine for the lock... BUT — second issue: the cleanup function checks `!ran.current` to release the lock, while the IIFE's `finally` *also* checks `!ran.current`. In Strict Mode (development), the first effect mounts, lock taken, second mount cleanup-then-mount runs the cleanup which releases the lock, *then* the second mount re-takes the lock. If the first IIFE finishes first and sets `ran.current=true`, fine. But if the cleanup runs while the IIFE is mid-flight and something flips `ran.current=true` between them, the lock can be permanently stuck.
- **Root cause**: Lock and latch are managed by two refs without atomic ordering. The cleanup conditionally releases based on a state that the in-flight IIFE may also be mutating.
- **Impact**: After certain failure modes (rare), weekly digest never runs again until app restart. Users miss notifications.
- **Fix sketch**: Always release `running.current = false` in the IIFE's `finally`, regardless of `ran.current`; protect with a per-attempt token if needed.

## 5. `useCredentialNav.navigate('add-new')` has no fallback if context provider is missing

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/sub_tools/useToolSelectorState.ts:191-194` (and `useToolSelectorActions.ts:66-69`)
- **Scenario**: `useToolSelectorState` is consumed by a tool selector that may render outside the `CredentialNavContext` provider during certain modals/portals. If `useCredentialNav()` returns null/undefined or throws, the entire selector crashes (since the hook is called unconditionally at the top level). Even if the provider is present, calling `setSidebarSection('credentials')` and then `navigate('add-new')` on the *next* tick can race: `setSidebarSection` triggers an unmount of the agent-editor route, which unmounts the credential nav consumer, leaving the credential page in its default tab instead of the "add" view.
- **Root cause**: Hook order coupling between `setSidebarSection` (system-wide route change) and `navigate` (intra-page navigation in credentials section). Both fire synchronously but the route change re-mounts the credentials section after the navigate effect has already settled.
- **Impact**: User clicks "Add credential" from a tool that needs auth, lands on credentials list page instead of the add-new form. No error — they think the button is broken.
- **Fix sketch**: Set `sidebarSection` first, then on the credentials route mount detect a `pendingNav` and apply it; or persist intent in store rather than ephemeral context.

## 6. Subscription `activate` retry storm: deletion via `void mutateSingleUseCase` is fire-and-forget

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/agents/sub_connectors/libs/subscriptionLifecycle.ts:128-135`
- **Scenario**: User activates a suggested subscription. `createSubscription` succeeds → DB row created. Then `mutateSingleUseCase` is fired with `void` to mark `adopted: true`. If that mutation fails (network blip, IPC timeout, validation rejection), the failure is swallowed by `void`. On the next list refresh, `mergeSubscriptions` will see the DB record AND the still-unadopted JSON suggestion, producing a duplicate entry. Worse, the `alreadyActivated` check uses event_type+source_filter equality, so the duplicate IS suppressed... BUT on `retire`, deleting the DB record will resurrect the suggestion (because `adopted` was never persisted). The user thinks they "permanently retired" something and it comes back.
- **Root cause**: `void` discards the promise; no retry on adoption mutation; no compensating action if adoption fails.
- **Impact**: Suggested subscription resurrection after retirement; user repeatedly retires the same item and wonders why it keeps coming back.
- **Fix sketch**: `await mutateSingleUseCase(...)` inside the activate `try`, and either roll back the DB create or queue a retry on failure.

## 7. AutomationSetupModal "Start over" preserves `useCaseId` → cross-UC contamination

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/agents/sub_connectors/components/automation/AutomationSetupModal.tsx:111` (uses `useAutomationSetup.handleClose`)
- **Scenario**: User starts the automation setup wizard scoped to UC1, gets to preview phase, clicks "Start over". `handleClose` resets most state but the "Start over" button itself only calls `s.design.reset(); s.setDescription(''); s.setLocalPhase(null); s.setDeployError(null);` — it does NOT reset `useCaseId`, `name`, `inputSchema`, `timeoutSecs`, `fallbackMode`, `platformCredentialId`, `githubRepo`. The user then enters a new description for UC2, but the deploy still tags the automation with UC1's `useCaseId` and uses UC1's name/schema if those weren't manually overridden.
- **Root cause**: "Start over" button has its own ad-hoc reset list that diverges from `handleClose`. Whenever new fields are added to setup state, this list goes out of sync silently.
- **Impact**: Automation deployed against wrong use case, with wrong name. Hard to diagnose because the user sees their new description in the textarea but the form hides the residual config.
- **Fix sketch**: Replace the inline reset with a call to `s.handleClose()` followed by re-opening the wizard, OR add a `s.startOver()` method that performs the same full reset.

## 8. `clampTimeoutSecs` not applied in `useAutomationSetupState.ts` — overflow/NaN reaches backend

- **Severity**: medium
- **Category**: validation-gap
- **File**: `src/features/agents/sub_connectors/libs/useAutomationSetupState.ts:93-123`
- **Scenario**: Two implementations exist again. `useAutomationSetup.ts` clamps `timeoutSecs` at the trust boundary; `useAutomationSetupState.ts` (the newer/refactored one consumed by setup state) sends `timeout_secs: timeoutSecs` directly to `deployAutomation`. A user who pastes "999999999" or empties the field (NaN) into the timeout input bypasses validation; the backend may receive it and either pin resources for hours or reject with a cryptic error.
- **Root cause**: Clamping was added defensively to one of the duplicate hooks but not the other.
- **Impact**: Backend resource pinning, deploy failures with confusing error messages.
- **Fix sketch**: Apply `clampTimeoutSecs(timeoutSecs)` in `useAutomationSetupState.handleDeploy`, OR consolidate to a single setup hook.

## 9. `useAutomationSetupState.handleDeploy` lacks the in-flight guard from its sibling

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/agents/sub_connectors/libs/useAutomationSetupState.ts:93-123`
- **Scenario**: Like above — `useAutomationSetup.ts` has `deployInFlightRef` to guard against double-clicks, with an explicit comment that `useState`-based `localPhase` "can't prevent a second click that fires before React has committed the 'deploying' state". `useAutomationSetupState.ts` does not have this guard. Double-click on the Deploy button → two `deployAutomation` calls → two automations created (or one created and one error after the dedupe constraint trips).
- **Root cause**: Same divergence pattern as #8 — a fix went into one hook but not the other.
- **Impact**: Duplicate automation deploys; cost duplication; user-visible error toasts on the second one.
- **Fix sketch**: Port the `deployInFlightRef` guard pattern, or unify hooks.

## 10. `useConnectorStatuses` auto-test guard breaks when `selectedPersona` is null transiently

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/agents/sub_connectors/libs/useConnectorStatuses.ts:77-80, 120-135`
- **Scenario**: When the user switches personas, there's a frame where `selectedPersona` becomes `null` then becomes the new persona. The reset effect on `selectedPersona?.id` clears `lastAutoTestedCredentialRef` and `inFlightTestsRef`. But if a previous `testConnector` is still in-flight (`healthcheckCredential` is async), it will eventually call `updateStatus(name, ...)` which mutates `statuses` for the *new* persona because `setStatuses` is bound to the latest state. The new persona's connector for the same `name` will be marked with results from the old persona's credential test.
- **Root cause**: `testConnector` does not snapshot a generation token; updates to `statuses` after a persona switch leak across boundaries because `name` collisions exist (e.g. both personas have a "github" connector).
- **Impact**: Wrong healthcheck result displayed (and possibly cached) for the new persona's credentials, including potential green check on a credential that wasn't actually tested.
- **Fix sketch**: Capture `personaId` at the start of `testConnector`; before `updateStatus`, verify `personaId === selectedPersona?.id`.

## 11. `parseCronToVisual` accepts non-numeric tokens silently → cron `*` lost on round-trip

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/agents/sub_use_cases/libs/scheduleHelpers.ts:99-125`
- **Scenario**: A user with a backend-generated cron like `0 9 * * MON,WED,FRI` (named days, sometimes returned by chronos-style libs or imported from elsewhere) opens ScheduleBuilder. `parseCronToVisual` splits dowPart by comma, calls `Number('MON')` → `NaN`, drops it. The visual mode shows zero days selected. User clicks Activate → builds back `0 9 * * *` (every day) silently. They've changed Mon/Wed/Fri to *every day* without realizing it.
- **Root cause**: `if (!isNaN(Number(n)))` is a silent reject, not a fallback to cron-text mode.
- **Impact**: Schedule semantics silently broadened; agent runs 7 days instead of 3.
- **Fix sketch**: If any token doesn't parse cleanly to 0-6, return `null` from `parseCronToVisual` so the builder falls back to cron-text mode.

## 12. `useAutomationSetup` GitHub effect resolves with one error swallowed by `silentCatchNull`

- **Severity**: low
- **Category**: silent-failure
- **File**: `src/features/agents/sub_connectors/libs/useAutomationSetup.ts:138-143`
- **Scenario**: `Promise.all([githubListRepos(...).catch(...), githubCheckPermissions(...).catch(...)])` — both calls catch independently to null. If the credential is invalid (revoked token), `githubListRepos` resolves to `null` (silently filtered to `[]`). The user sees an empty repo list with `loadingRepos=false` and no indication that authentication failed. They blame their GitHub account, not the credential.
- **Root cause**: `silentCatchNull` is too silent here — the error is not a transient issue, it's a permanent auth failure that requires user action.
- **Impact**: Confusing UX during automation setup. User can't proceed but doesn't know why.
- **Fix sketch**: Surface a banner ("Couldn't list repos — credential may be invalid") when `repos === null` (vs. `repos.length === 0`).

## 13. `mutateCredentialLink` failure swallowed in `AgentCredentialDemands.handleReuse`

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/sub_connectors/components/connectors/AgentCredentialDemands.tsx:26-35`
- **Scenario**: User clicks an existing credential to reuse it. `mutateCredentialLink` throws (e.g. design_context conflict, validation error). The catch block is empty (`/* intentional: non-critical */`) but it's not non-critical — the link did NOT happen. `setLinkingDemand(null)` closes the dropdown. User sees the demand still listed as unfulfilled. They click again. Same thing. They give up and create a new credential. Now there are 2 duplicate credentials.
- **Root cause**: Empty catch with a misleading "non-critical" comment for a clearly critical operation.
- **Impact**: Users can't link existing credentials, create duplicates, or report bugs about a "broken" reuse button.
- **Fix sketch**: Use `toastCatch('AgentCredentialDemands:reuse', 'Failed to link credential')(err)` and keep `linkingDemand` open on failure.

## 14. `ScheduleBuilder` initial-fetch effect triggers on mount with empty deps → SSR/test mode stale-cron warnings

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/agents/sub_use_cases/components/schedule/ScheduleBuilder.tsx:42-44`
- **Scenario**: Three useEffects manage cron preview. The third one — `useEffect(() => { fetchPreview(cronExpression); }, [])` — has empty deps with `cronExpression` in scope, creating a stale closure. When the component remounts due to `useCaseId` change (the parent doesn't always re-key), this fires once with the *first* render's `cronExpression`, which may have been a default `'0 9 * * *'` even though the user's saved cron is different. Also no abort on unmount — the in-flight `previewCronSchedule` will call `setCronPreview` after unmount, triggering a React warning and potentially showing stale preview text in dev tools.
- **Root cause**: Empty deps array combined with closure over a state value; missing cleanup for in-flight async.
- **Impact**: Brief flash of wrong "next runs" preview; React stale-state warnings in dev console; potential confusion for users editing rapidly.
- **Fix sketch**: Inline the initial fetch into the cron-mode effect with proper deps, or use an AbortController-equipped version of `previewCronSchedule`.
