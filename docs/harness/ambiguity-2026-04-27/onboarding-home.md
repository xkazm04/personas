# Ambiguity Audit — Onboarding & Home

> Total: 12 findings (1 critical, 5 high, 5 medium, 1 low)
> Files read: ~16
> Scope: First-run onboarding overlay, guided tour spotlight/coach, home/welcome surfaces, fleet metrics & live roadmap.

## 1. Setup stepper writes only `setupGoal` — `setupRole` and `setupTool` saved on click, never undone

- **Severity**: critical
- **Category**: undocumented-decision
- **File**: src/features/home/components/SetupCards.tsx:351-353, 306-314
- **Scenario**: `RoleStep` / `ToolStep` call `setSetupRole` / `setSetupTool` directly inside `onSelect`, so the choice is committed to the persisted `useSystemStore` the instant the user clicks a card. Only `goalDraft` is buffered and committed on Finish. If the user opens the stepper, picks a different role, then closes via the X button or escape, the new role is permanent and the previous selection is gone — no Cancel semantics, no undo.
- **Root cause**: Two of three steps mutate global state synchronously while one buffers a draft, and there is no comment anywhere saying that this asymmetry is intentional. The `setupCompleted` flag is also never set anywhere in this file; whether the gating predicate at line 549 (`if (setupCompleted) return null;`) is set elsewhere is invisible from this scope.
- **Impact**: Closing the stepper after exploring options silently corrupts the user's saved profile. Worse, `SetupCards` hides itself forever once `setupCompleted === true`, so a partial role-only state can leave the user with no UI surface to fix it. Future devs adding a "Reset" button will not realize that role/tool are already persisted.
- **Fix sketch**:
  - Buffer `roleDraft` / `toolDraft` like `goalDraft`; commit all three only on Finish.
  - Document where `setupCompleted` is toggled (it is referenced but never set in this scope).
  - Decide and write down: is closing the modal a Cancel or a Save?

## 2. `executePersona` return value semantics are undocumented and silently swallowed

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/onboarding/components/ExecutionStep.tsx:86-94
- **Scenario**: `handleRun` calls `await executePersona(personaId)` and treats a falsy `execId` as failure. There is no comment explaining what falsy means: thrown error caught upstream? validation rejection? backend offline? race against a still-running execution? The toast/error path collapses all of these into a single i18n string `t.onboarding.execution_failed`.
- **Root cause**: The contract of `executePersona` (which lives in `agentStore`) is implicit. Onboarding is the one surface where a clean error message matters most, but the failure mode is opaque.
- **Impact**: When first-run users hit a real failure (missing credentials, no LLM key, network), they see a generic message with no remediation hint. Future devs cannot tell whether to add error-class branching here or in the store.
- **Fix sketch**:
  - Document `executePersona`'s return type (Promise<string | null> with reason for null) at its definition.
  - Surface the failure reason in onboarding so first-runners get actionable messages.

## 3. Magic 8 hardcoded as denominator of completeness — no link to dimension list

- **Severity**: high
- **Category**: magic-number
- **File**: src/features/onboarding/components/steps/PersonaCreationCoach.tsx:51-52
- **Scenario**: `completeness = Math.round((resolvedCount / 8) * 100)`. The 8 is the count of `MATRIX_DIMENSIONS` defined seven lines above (lines 13-22). If a future dev adds a 9th dimension to the array, the completeness percentage will silently exceed 100% on a fully-resolved agent.
- **Root cause**: Two related constants (the array and the divisor) are independently maintained.
- **Impact**: Adding a dimension is a single-line change to the array, but the displayed "100% complete" badge will become unreachable (or "112%" possible). Tour gating (`effectiveSubStep === 3` when "promoted") could mistime.
- **Fix sketch**:
  - Replace `8` with `MATRIX_DIMENSIONS.length`.
  - Add a unit test pinning `MATRIX_DIMENSIONS.length` so future additions are intentional.

## 4. TourSpotlight retry budget — 4 retries × 500 ms is silently tied to step-navigation timing

- **Severity**: high
- **Category**: undocumented-decision
- **File**: src/features/onboarding/components/TourSpotlight.tsx:67-69
- **Scenario**: `MISSING_TARGET_RETRY_MS = 500` and `MAX_MISSING_TARGET_RETRIES = 4` give an anchor a 2-second window to re-mount before auto-dismissing the tour. The comment explains *why* there's a retry but not why these specific numbers, nor what real navigation/render timings they target.
- **Root cause**: The thresholds were chosen empirically against the slowest current step transition; nothing locks future routes/lazy chunks to that envelope. There's no test asserting transitions stay under 2 s.
- **Impact**: As tours grow (lazy-loaded routes, animations, slower hardware), real anchors that re-mount at 2.1 s will produce an unexplainable "tour just exits" bug. The auto-dismiss runs `dismissTour` silently — no toast, no log — so the failure mode is invisible.
- **Fix sketch**:
  - Add a one-line rationale: "tested against worst-case step transition (~1.5s) with margin".
  - Emit a Sentry breadcrumb on `dismissForMissingTarget` so the silent dismissals show up in telemetry.
  - Consider per-step override via `step.maxMissingTargetRetries`.

## 5. `getStepColors` falls back to the input key when STEP_TO_SURFACE has no mapping

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/onboarding/components/tourConstants.ts:35-47
- **Scenario**: `getStepColors(key)` does `STEP_TO_SURFACE[key] ?? key`. If a future tour adds a step whose id is not in `STEP_TO_SURFACE`, the function passes the *step id itself* to `getTourSurface`, expecting it to behave as a tour-color key. This works today only because all known step ids happen to not collide with surface keys.
- **Root cause**: One function silently overloads two different argument vocabularies (step ids and tour colors) using `??` to pick which.
- **Impact**: Adding a new tour with steps that share names with future surface keys (or vice versa) yields silently wrong colors that pass typecheck. The bug surfaces only as visual drift.
- **Fix sketch**:
  - Split into two functions: `getStepSurface(stepId)` and `getTourSurfaceByColor(colorKey)`.
  - Or assert that `STEP_TO_SURFACE[key]` exists when called from `StepProgress` and disallow the fallback path.

## 6. Hero background randomization is non-deterministic per render-mount

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/home/components/HeroHeader.tsx:19-24
- **Scenario**: `useMemo(() => BG_OPTIONS[Math.floor(Math.random() * BG_OPTIONS.length)]!, [isStarter, isDark])`. Memoized but only by tier/theme — every fresh mount of HomePage (route navigation away and back, full reload, theme toggle and back) picks a new random background. There is no rationale comment.
- **Root cause**: Whether the goal is "always feels fresh" or "consistent per session" was never written down.
- **Impact**: Looks like a bug to QA ("background changes every visit"). If a designer later wants per-user-stable selection, no code points to where the decision was made.
- **Fix sketch**:
  - Pin per session via a stable seed (user id, day-of-month, or sessionStorage).
  - Document the desired behaviour in a comment.

## 7. `discoverDesktopApps` returns empty on any error — user can't distinguish "scanned, none found" from "scan failed"

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/onboarding/components/useOnboardingState.ts:81-90
- **Scenario**: The `.catch(() => setDiscoveredApps([]))` collapses every failure (Tauri command unavailable, permission denied, OS-level scan error) into the same empty list. Downstream `DesktopDiscoveryStep` then renders `t.onboarding.desktop_empty` ("no desktop apps found"), which is a lie when the scan actually failed.
- **Root cause**: No distinguished `'error'` phase modeled — only an implicit "loading or empty" boolean (`isScanning`).
- **Impact**: Users on a system where Tauri's discovery command is broken will be told "we found nothing" and skip the step, missing apps they have installed. This is the single point where Connectors get auto-detected.
- **Fix sketch**:
  - Mirror the `templateLoadState` pattern: `loading | loaded | empty | error`.
  - Show a Retry button in the error case.
  - Log the swallowed error via `silentCatch`.

## 8. Auto-complete timer for tour steps is a hard-coded 5 s with no telemetry

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/onboarding/components/GuidedTour.tsx:117-125
- **Scenario**: After 5 s on any step listed in `timedSteps`, `emitTourEvent(currentStep.completeOn)` fires regardless of whether the user looked at the panel, navigated away, or actually engaged. The 5000 ms is unexplained.
- **Root cause**: "Engagement" was never defined; the timer is a stand-in for real interaction tracking.
- **Impact**: Backgrounding the app for 5 s checks the step off without the user reading anything. Telemetry that relies on `tourStepCompleted` becomes meaningless. Designers thinking they are A/B testing engagement get noise.
- **Fix sketch**:
  - Pause the timer when `document.visibilityState !== 'visible'`.
  - Add a per-step `autoCompleteMs` field so 5 s isn't applied uniformly.
  - Document the rationale with a single comment line.

## 9. Per-host failure-spike threshold (≥3 executions and >50% failed) is undocumented

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/home/components/FleetHealthStrip.tsx:32
- **Scenario**: `summary.totalExecutions >= 3 && summary.failedExecutions / summary.totalExecutions > 0.5` — the strip pulses red when "too many" failures. The 3-execution floor and 50% bar are not annotated.
- **Root cause**: Threshold engineering was done by guessing rather than calibrating against historical telemetry.
- **Impact**: A user with 4 executions and 3 failures sees alarm-red on the home screen, possibly while their agents are actually fine (rate-limit, transient error). Adjusting the threshold later requires git-archaeology to understand what behaviour it replaces.
- **Fix sketch**:
  - Pull the constants into `lib/constants/healthThresholds.ts` with a comment.
  - Consider a 24-hour rolling window rather than "today" arithmetic since `getMetricsSummary(1)` semantics aren't obvious.

## 10. `setHighlightTestId` scheduled at 100 / 150 / 300 ms — three competing layout windows

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/onboarding/components/GuidedTour.tsx:78-105
- **Scenario**: The `navigateToStep` callback schedules sub-tab setters at +100 ms, special-step navigation at +150 ms, and the spotlight highlight at +300 ms. There's no comment about ordering. The 300-ms highlight assumes both the sub-tab and special-step actions have settled.
- **Root cause**: Three independent timers compose into a fragile happy-path. If a step's nav target lazy-loads slowly, the 300 ms highlight fires against a not-yet-mounted DOM node — relying on TourSpotlight's retry budget (finding 4) to recover.
- **Impact**: Adding a new tour step with a heavier route can produce a single missed-highlight that the user perceives as the tour "broke". The interaction with TourSpotlight retry timing is invisible.
- **Fix sketch**:
  - Replace the timer chain with `requestAnimationFrame` + a "wait for testid in DOM" promise.
  - Or document the ordering (sub-tab @ 100ms → nav @ 150ms → highlight @ 300ms) at the top of the function.

## 11. `prefetchHomeReleases` cache stays sticky on success but resets on failure — silent staleness

- **Severity**: medium
- **Category**: trade-off-hidden
- **File**: src/features/home/lib/prefetch.ts:11-17
- **Scenario**: The `cache` helper resets `pending = null` *only inside the `.catch`*. On success the promise stays in `pending` forever. This means a successful prefetch result is never re-fetched even if a deploy ships a new chunk hash hours later.
- **Root cause**: For `import()`-style prefetchers this is fine (chunk URLs are content-addressed), but the helper is generic — `Prefetcher = () => Promise<unknown>`. Future authors using this for API prefetches will assume "cached" implies a TTL.
- **Impact**: A future dev adds `cache(() => fetchTrendingTemplates())` thinking it gets a one-shot prefetch; it actually permanently freezes the result for the session.
- **Fix sketch**:
  - Rename to `cacheChunkPrefetch` or restrict the type to `() => Promise<{ default: unknown }>`.
  - Add a doc-line: "Successful results are sticky for the session — do NOT use for data prefetches."

## 12. `ONBOARDING_LANGUAGES` list (11 entries) drifts from full `Language` set silently

- **Severity**: low
- **Category**: tribal-knowledge
- **File**: src/features/onboarding/components/AppearanceStep.tsx:10-22
- **Scenario**: The hand-curated list of 11 onboarding languages is a subset of the supported `Language` type (the `i18n/` folder has 14: ar, bn, cs, de, en, es, fr, hi, id, ja, ko, ru, vi, zh). `bn`, `id`, `vi` are translated but invisible during onboarding.
- **Root cause**: There's no comment explaining whether the omission is intentional (low-traffic locales) or accidental (forgot to update list when a new locale was added).
- **Impact**: New translators add a locale, see translation files in `i18n/`, but the UI for first-run language selection silently excludes them. Confusion bug for contributors.
- **Fix sketch**:
  - Either generate the list from the `Language` union plus a metadata table, or add a comment naming the deliberately-excluded locales.
