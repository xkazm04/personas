# Bug Hunt — Onboarding Flow

> Group: Templates, Onboarding & Home
> Files scanned: 7 (resolved actual paths: OnboardingOverlay.tsx, AppearanceStep.tsx, DesktopDiscoveryStep.tsx, ExecutionStep.tsx, OnboardingQuestPill.tsx, useOnboardingState.ts, onboardingSlice.ts, onboardingQuestStore.ts — note: the requested OnboardingPage/Welcome/Language/Identity files do not exist in the repo; the actual flow uses Appearance/Discover/PickTemplate/Adopt/Execute steps)
> Total: 2C / 5H / 4M / 2L = 13 findings

---

## 1. Mid-flow dismiss state never persists — closing app forgets where you were

- **Severity**: critical
- **Category**: partial-state
- **File**: `src/stores/slices/system/onboardingSlice.ts:151-158` (and slice declaration generally)
- **Scenario**: User starts onboarding, completes Appearance + Discover, dismisses on `pick-template`. `dismissOnboarding` writes `onboardingDismissedAtStep="pick-template"` to the in-memory Zustand store. User quits the app. On next launch the system store is freshly constructed: `onboardingDismissedAtStep` is `null`, `onboardingStepCompleted` is empty, `onboardingActive` is false. `resumeOnboarding()` no-ops (line 114 returns early because `onboardingDismissedAtStep` is null), and `startOnboarding()` aborts at line 100 because the user already has the persona created during adoption.
- **Root cause**: The onboarding slice has no `persist` middleware nor any `setAppSetting` write — `onboardingDismissedAtStep`, `onboardingStepCompleted`, `onboardingCreatedPersonaId`, and `onboardingCompleted` all live in volatile React state. Compare to `onboardingQuestStore.ts` which does persist via `setAppSetting`.
- **Impact**: Users who quit mid-wizard return to a silent, inactive UI with no resume affordance and no auto-restart. The "Skip is reversible" promise in the docstring at line 56 is broken across app restarts.
- **Fix sketch**: Add a thin persistence layer (wrap the slice in `persist()` from zustand/middleware, or mirror `dismissOnboarding`/`completeOnboardingStep`/`finishOnboarding` to `setAppSetting('onboarding_state', …)` like the quest store does, and rehydrate on app boot before `startOnboarding` is dispatched).

## 2. `startOnboarding` aborts forever once user has any persona, even mid-dismissed flow

- **Severity**: critical
- **Category**: step-skip
- **File**: `src/stores/slices/system/onboardingSlice.ts:100`
- **Scenario**: User reaches the `adopt` step, the adoption wizard creates persona X, then user dismisses on `execute`. On next launch `startOnboarding()` checks `storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS).length > 0` — they have one persona — and silently returns. `resumeOnboarding` only fires if something explicitly calls it (and as Bug 1 shows, the dismissed-step state is lost anyway).
- **Root cause**: The "user has personas → skip onboarding" guard uses persona count as a proxy for completion, but the user never reached the `execute` step. The flag that should gate this is `onboardingCompleted`, which would not be true.
- **Impact**: Users who quit between adoption and execution can never see onboarding again unless they manually click a Help-menu "reopen" button — the wizard becomes a one-shot that silently fails.
- **Fix sketch**: Drop the `personas.length > 0` clause. Use only `onboardingCompleted` as the no-start gate, and keep the persona-count check as a separate "first run vs. returning user" hint inside the welcome copy.

## 3. Quest CDC listener double-counts on every UPDATE — milestone fires on edits, not just creations

- **Severity**: high
- **Category**: double-count
- **File**: `src/features/onboarding/components/OnboardingQuestPill.tsx:62-69`
- **Scenario**: Quest is on the `connect_credential` milestone. User long ago saved a credential, then edits its label today. The `credential-updated` Tauri event fires with `action: 'update'`. The handler only filters `action === 'delete'` (line 64), so it calls `completeMilestone('connect_credential')` even though the milestone may have been "completed" earlier (or for a now-deleted credential). The store's `completeMilestone` early-returns if already set (line 113 of the store), but if the user previously dismissed without ever creating a credential, the first edit-event after revive will still mark it complete.
- **Root cause**: `CDC_TABLE_TO_MILESTONE` treats any non-delete CDC notification as completion. The original intent is "first creation"; only `action === 'insert'` qualifies.
- **Impact**: Users who haven't done a milestone yet can have it spuriously check off when an unrelated edit/healthcheck update fires. Confetti bursts unexpectedly; quest progress lies.
- **Fix sketch**: Filter `if (action !== 'insert') return;` (or restrict to `action === 'insert'`). Treat update/delete as no-ops.

## 4. `run_persona` quest milestone fires on execution-START, not completion

- **Severity**: high
- **Category**: double-count
- **File**: `src/features/onboarding/components/OnboardingQuestPill.tsx:72-76`
- **Scenario**: User clicks Run on the Execute step. `EventName.EXECUTION_STATUS` fires multiple times across the lifecycle: `queued`, `running`, `failed`, `completed`. The handler completes the milestone on the *first* status event, regardless of the value. A failed-to-start execution still ticks the box.
- **Root cause**: No status filter — the handler ignores `event.payload`.
- **Impact**: Users can "complete" Run a Persona by triggering an execution that never actually ran (e.g. credential missing, immediate failure). Misleading progress meter and burst.
- **Fix sketch**: Inspect payload status and only call `completeMilestone('run_persona')` when it is a terminal-success (e.g. `'completed'` or `'success'`).

## 5. Auto-dismiss timer fires even if user expanded the pill mid-countdown

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/onboarding/components/OnboardingQuestPill.tsx:183-195`
- **Scenario**: User completes the last milestone. `completedAt` is set, `expanded:true` (from `completeMilestone`). 6 s timer arms. Within those 6 s, the user clicks the pill to inspect their list — `expanded` toggles do not affect the timer. At t=6 s `dismiss()` runs, hiding the entire pill mid-read.
- **Root cause**: The auto-dismiss effect re-runs only when `[completedAt, dismissed, autoDismissArmed, dismiss]` change. It is unaware of `expanded` and never cancels on user interaction.
- **Impact**: Discoverability bug — celebratory completion screen is yanked away mid-read.
- **Fix sketch**: Add `expanded` to the deps and `if (expanded) return;`, or add interaction handlers that clear the timer in `onToggle`/list hover.

## 6. ExecutionStep listener re-registers per-render due to unstable `onComplete` reference

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/onboarding/components/ExecutionStep.tsx:45-84` and `useOnboardingState.ts:285-287`
- **Scenario**: `useEffect` deps include `onComplete`. In `useOnboardingState`, `handleExecutionComplete` is wrapped in `useCallback` with `[completeOnboardingStep]`. `completeOnboardingStep` is read via Zustand selector (line 51) — Zustand returns a stable function reference, so this is OK *unless* the store is recreated. But during HMR or persona refresh the selector may return a new bound action, re-running the effect → tearing down the listener and creating a new one. With Tauri `listen()` resolving asynchronously, the cleanup-then-register window can drop the `execution-complete` event in flight, leaving `finished=false` forever even though the run finished.
- **Root cause**: Effect dep array couples DOM-side listener lifecycle to a store-action reference. The cancelled-flag dance handles unmount but not re-register-mid-flight event drops.
- **Impact**: Intermittent "stuck on Executing…" with no Done button until user dismisses; reproducible during dev with HMR.
- **Fix sketch**: Drop `onComplete` from the deps and read it through a ref kept in sync via `useEffect`, or pull the unlisten/finish logic into a store subscription so it survives renders.

## 7. AppearanceStep language switch can lose user-typed values in subsequent steps

- **Severity**: medium
- **Category**: i18n-drift
- **File**: `src/features/onboarding/components/AppearanceStep.tsx:67`
- **Scenario**: User enters Appearance, picks French, advances to Pick-Template. The `t.onboarding.*` strings re-render in French. Selected `onboardingSelectedReviewId` is preserved in the store, but `selectedReview` is recomputed in `useOnboardingState.ts:225-232` from `templates.find(...)`. Templates are not refetched on language change, so labels remain in their original tongue while UI chrome flips — confusing but tolerable. The real issue: if the user goes *back* to Appearance and switches language again, the `useEffect` at `useOnboardingState.ts:91-128` does NOT re-run on language change, so the `discoveredApps` labels (returned from Rust at scan time) stay in the prior locale until a manual retry.
- **Root cause**: Language change does not invalidate Rust-side data fetched into local component state.
- **Impact**: Mixed-language UI for the rest of the wizard until the user manually retries each step.
- **Fix sketch**: Subscribe `useOnboardingState` to `useI18nStore.language` and add it to the deps of the discovery and templates effects, OR pass language to the Rust calls so the labels come back localized.

## 8. `handleApproveApp` setState-on-unmount race

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/onboarding/components/useOnboardingState.ts:134-152`
- **Scenario**: User clicks Approve on a slow Docker manifest fetch. While `getDesktopConnectorManifest` is in-flight, user clicks Skip → `dismissOnboarding` → overlay unmounts. Manifest resolves, `setApprovedApps(...)` and the `finally { setApprovingApp(null) }` run on the unmounted hook owner.
- **Root cause**: No `cancelled` flag inside `handleApproveApp`. The other effects use the cancelled pattern; this `useCallback` does not.
- **Impact**: React warns "Can't perform a state update on an unmounted component" in dev; in prod a small memory leak holding `approvedApps` in closure scope.
- **Fix sketch**: Either store an `AbortController`/cancelled ref keyed by connector_name, or move approval state into the Zustand slice so unmount doesn't matter.

## 9. `finishOnboarding` leaks `onboardingCreatedPersonaId` across reopens

- **Severity**: medium
- **Category**: partial-state
- **File**: `src/stores/slices/system/onboardingSlice.ts:141-149`
- **Scenario**: User finishes onboarding (`onboardingCreatedPersonaId="persX"`). Later, the user deletes that persona. Then they invoke `reopenOnboarding()` from a Help menu (which DOES reset, line 168). But if they instead trigger `resumeOnboarding()` first (e.g. an old breadcrumb still exists in some UI), it short-circuits because `onboardingCompleted` is true, but the stale `onboardingCreatedPersonaId` remains in the store and any code reading it via `storeBus`/selector points to a non-existent persona.
- **Root cause**: `finishOnboarding` resets `onboardingStep` and `onboardingDismissedAtStep` but not the created-persona id or step-completion map.
- **Impact**: Stale persona id is observable to outside consumers (e.g. quest-tracker or any "your first agent" affordance), causing 404s when looking up the persona.
- **Fix sketch**: Reset `onboardingCreatedPersonaId`, `onboardingSelectedReviewId`, and `onboardingStepCompleted` to initial in `finishOnboarding` once the flow ends.

## 10. Adoption-wizard escape leaves `onboardingStep="adopt"` if step was completed via different path

- **Severity**: medium
- **Category**: step-skip
- **File**: `src/features/onboarding/components/useOnboardingState.ts:277-283`
- **Scenario**: Inside the adoption wizard, if a custom flow already calls `completeOnboardingStep('adopt')` before close (e.g. a unit-test seam, or future code path), then `handleAdoptionClose` sees `onboardingStepCompleted['adopt']===true` and does NOT rewind to `pick-template`. The user is now stranded on `onboardingStep="adopt"` with `showAdoptionWizard=false`, and the overlay renders the "Opening wizard…" loading spinner forever (line 177-182 of OnboardingOverlay.tsx).
- **Root cause**: The conditional is "rewind only if not completed", but the only forward transition out of `adopt` lives in `handleAdoptionComplete`. Closing without completing should always rewind.
- **Impact**: Latent — tied to an assumption about external completion. If anyone wires `completeOnboardingStep('adopt')` outside `handleAdoptionComplete` (e.g. a future automated flow or a test-only hook), the user gets a permanent spinner.
- **Fix sketch**: Always rewind: `setOnboardingStep('pick-template')` in `handleAdoptionClose`, and let the wizard reopen if needed. Or: when `onboardingStep==='adopt'` and `showAdoptionWizard===false` for >N ms, auto-rewind.

## 11. Quest revive does not re-arm auto-dismiss after a complete-then-revive cycle

- **Severity**: low
- **Category**: edge-case
- **File**: `src/stores/onboardingQuestStore.ts:140-150` and `OnboardingQuestPill.tsx:183-195`
- **Scenario**: All milestones complete, pill auto-dismisses (6 s). User revives via TitleBar (`revive()`). The revive sets `visible:true, dismissed:false`, but `completedAt` is still non-null and `autoDismissArmed` (local React state) was true *for the previous mount*. On revive the pill remounts, `autoDismissArmed` resets to false, the effect arms a new 6 s timer and the pill auto-vanishes again 6 s after revive.
- **Root cause**: Auto-dismiss is keyed only on `completedAt && !dismissed && !autoDismissArmed` — there's no "user explicitly revived; don't auto-dismiss again" flag.
- **Impact**: User clicks revive expecting to keep it visible, watches it disappear 6 s later. Confusing.
- **Fix sketch**: Add a persisted "userRevived" flag (or clear `completedAt` on revive). Auto-dismiss should only run on the FIRST completion, not after every revive.

## 12. Desktop discovery re-runs while flow is dismissed if `onboardingActive` flickers

- **Severity**: low
- **Category**: silent-failure
- **File**: `src/features/onboarding/components/useOnboardingState.ts:91-128`
- **Scenario**: User dismisses → `onboardingActive=false` → effect cleanup runs (cancelled=true). User reopens → `onboardingActive=true` → effect re-runs and starts a new scan. But if the previous `discoverDesktopApps` promise from the prior session is still pending and resolves AFTER the new scan starts but before the new one finishes, the "stale" cancelled flag prevents pollution — good. However, the dependency `discoveryReloadNonce` and `onboardingActive` are independent, and if the user reopens quickly, two effect runs can be scheduled before either completes; the second's `setDiscoveryState({ phase: 'scanning' })` is fine, but the first's `setDiscoveredApps(apps)` is gated only by *its own* cancelled flag — it can land *after* the second already wrote success, briefly overwriting the newer data.
- **Root cause**: Two-effect-runs can both write `setDiscoveredApps`; cancellation is per-run, not per-component.
- **Impact**: Tiny visible flicker of older scan results overwriting newer. Edge case, requires very tight timing.
- **Fix sketch**: Use a single ref-tracked epoch counter; only the latest run is allowed to write.

## 13. Confetti particle list uses non-deterministic `Math.random` outside `useMemo` deps

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/onboarding/components/OnboardingQuestPill.tsx:111-124`
- **Scenario**: `useMemo(... [])` captures the random distances/delays once at mount of `ConfettiBurst`. Two `ConfettiBurst` instances are rendered (one inline, one absolute on the pill), each with their own memoized particles — that's fine. But `<ConfettiBurst show={Boolean(burstFor)} />` (line 351) on the collapsed pill never remounts — its particle layout is fixed for the lifetime of the pill. Successive milestone bursts therefore use the same trajectories, undermining the visual variety the random was meant to provide.
- **Root cause**: Deps `[]` on `useMemo` plus a long-lived parent component.
- **Impact**: Cosmetic — bursts look identical each time on the pill. Not functional.
- **Fix sketch**: Key `<ConfettiBurst>` on `burstFor` so it remounts per milestone, or include `burstFor` in the `useMemo` deps.
