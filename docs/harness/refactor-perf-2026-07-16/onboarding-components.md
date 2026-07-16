# onboarding/components — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: App Shell, Settings & Sharing | Files read: 22 | Missing: 0

## 1. TourLauncher counts progress from whatever tour was last active, not the tour it launches
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/onboarding/components/TourLauncher.tsx:27
- **Scenario**: `tourStepCompleted` in the system store is swapped per-tour on `startTour` (tourSlice.ts:1384) and holds the LAST ACTIVE tour's step map. TourLauncher renders the getting-started launcher but computes `completedCount = Object.values(tourStepCompleted).filter(Boolean).length` without filtering to that tour's step ids, while `totalSteps` comes from the getting-started step list. A user who last ran e.g. the plugins tour (5 steps done) sees "Resume 5/4" on the getting-started launcher.
- **Root cause**: GuidedTour computes per-tour progress correctly (`visibleSteps.filter((s) => completedSteps[s.id])`, GuidedTour.tsx:89); TourLauncher re-implements the computation differently and the two diverged — the launcher version ignores which tour the completion map belongs to.
- **Impact**: User-visible wrong progress ratio (can exceed total) on a footer control that is shown whenever no tour is running; also a maintenance trap since two files own the same computation.
- **Fix sketch**: Count only steps belonging to the launched tour: `const completedCount = steps.filter((s) => tourStepCompleted[s.id]).length`. Note this map only reflects the launched tour when it was the last active one; for full correctness read the persisted per-tour record (the `getPersistedTours()` store already keeps `completedSteps` per TourId — expose a `getTourProgress(tourId)` selector on the slice and use it in both GuidedTour and TourLauncher).

## 2. Dead export `getStepIcon` keeps a ~35-icon lucide map alive in tourConstants
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/onboarding/components/tourConstants.ts:66
- **Scenario**: `getStepIcon` (and its `ICON_MAP`, lines 19–64) has zero callers anywhere in `src/` — verified by repo-wide grep (only hit outside the definition is stale `lint-output.json`). StepProgress deliberately renders step NUMBERS, not icons (its own doc comment says so), so the icon map is a leftover from the pre-number design.
- **Root cause**: The step list was redesigned from icon-based to number-based rows, but the icon lookup and its ~35 lucide imports were left behind.
- **Impact**: ~50 lines of dead code plus ~35 lucide icon component imports (Palette, Radio, Wand2, MoonStar, …) pulled into a module imported by GuidedTour/TourPanelBody/StepProgress — unnecessary bundle weight and a stale map that must be hand-maintained every time a tour step id changes.
- **Fix sketch**: Delete `getStepIcon`, `ICON_MAP`, and the now-unused lucide imports from tourConstants.ts (keep `Sparkles` only if still referenced — it is not, after removal). One grep to confirm no dynamic access, then remove.

## 3. ExecutionStep's `unlistenRef` is written but never read
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/onboarding/components/ExecutionStep.tsx:33
- **Scenario**: `unlistenRef.current` is assigned in the listen-effect (lines 75, 85) but no code ever reads it — cleanup uses the closure-local `unlisten` variable, which is sufficient and correct.
- **Root cause**: Leftover from an earlier cleanup implementation that detached via the ref; the cancelled-flag rewrite made the ref redundant.
- **Impact**: Pure noise — a second bookkeeping channel for the same UnlistenFn that a future editor might mistakenly treat as authoritative.
- **Fix sketch**: Delete `unlistenRef` (declaration line 33 and the three assignments at lines 75, 85) — the local `unlisten` + `cancelled` flag already cover every teardown path.

## 4. Tour narration caches blob object-URLs forever without revoking them
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/onboarding/components/useTourNarration.ts:84
- **Scenario**: Every narrated tour step synthesizes TTS audio into a `URL.createObjectURL` blob (voicePlayback.ts:36 explicitly says "Caller is responsible for revokeObjectURL") and `urlCacheRef` stores one URL per step id — but nothing ever calls `URL.revokeObjectURL`, including the unmount effect (line 164), which only bumps the generation token.
- **Root cause**: The cache exists so Replay doesn't re-hit the TTS engine, but the hook adopted the companion chat's "let page unload revoke it" stance — which never happens in a long-lived Tauri desktop session.
- **Impact**: Piper WAV clips are ~150–300 KB each; across 8 tours (~35 narrated steps) a voice-enabled user accumulates up to ~10 MB of unreclaimable blob memory per app session, re-accumulated after every remount of GuidedTour since the ref-scoped cache is rebuilt while old URLs stay alive.
- **Fix sketch**: In the unmount cleanup (and when the tour id changes), iterate `urlCacheRef.current.values()` calling `URL.revokeObjectURL`, then clear the map. Bounded and safe: the cache is only read through this hook instance, so no other consumer can hold a revoked URL.

## 5. useOnboardingState subscribes to (and returns) vault credentials nobody uses
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/onboarding/components/useOnboardingState.ts:81
- **Scenario**: The hook selects `credentials` and `connectorDefinitions` from `useVaultStore` and returns them, but its only consumer (OnboardingOverlay.tsx:50–79, verified by grep — the other two imports are type-only) never destructures either field. Any vault mutation (credential add/edit, connector-definition refresh) while the onboarding modal is open re-renders the entire modal tree — StepIndicator, the active step, footer — for data it doesn't render.
- **Root cause**: Leftover subscriptions from an earlier onboarding flow that showed credential state; the flow moved to desktop-app approval but the selectors stayed.
- **Impact**: Unnecessary full-modal re-renders during onboarding (exactly when connector approvals mutate the vault), plus two dead fields in the hook's return contract that suggest a dependency that no longer exists.
- **Fix sketch**: Delete the two `useVaultStore` selector lines (81–82), the two return fields (330–331), and the now-unused `useVaultStore` import. Zero behavior change; typecheck confirms no consumer breaks.
