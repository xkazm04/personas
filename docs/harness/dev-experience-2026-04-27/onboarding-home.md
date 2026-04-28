# Onboarding & Home — Dev Experience Scan

> Total: 13 · Critical: 1 · High: 5 · Medium: 5 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Two parallel i18n systems — the feature-scoped one is dead weight

- **Severity**: Critical
- **Category**: convention-drift
- **File**: `src/features/onboarding/i18n/useOnboardingTranslation.ts:19`, `src/features/home/i18n/useTranslation.ts:57`
- **Scenario**: A dev needs to add a new onboarding string. They open `src/features/onboarding/i18n/en.ts` (it's right next to the components, looks like the right place), edit it, push. Nothing changes at runtime — the global `@/i18n/useTranslation` is what every onboarding component actually imports. The only consumer of `useOnboardingTranslation` is itself; the only consumers of `useHomeTranslation` are 2 home components. Meanwhile the global system uses **JSON** (`src/i18n/locales/*.json`) with codegen'd types, while the per-feature folders use **TypeScript modules** with hand-rolled `as unknown as` casts (see `home/i18n/useTranslation.ts:18-31`).
- **Root cause**: A half-finished migration to the JSON-based central i18n. `home/i18n/useTranslation.ts:1-9` even has a `@deprecated` JSDoc saying "this will be consolidated in i18n Phase 2", but the consolidation never happened and the old per-feature TS bundles still live alongside (14 locale files × 2 features = 28 stale files).
- **Impact**: Every new onboarding/home string requires the dev to know the trap; mis-edits silently no-op; reviewers and AI agents waste cycles hunting "why isn't my string showing up". The onboarding folder also bundles 14 `.ts` locales that are imported nowhere but still compile and add to type-check time.
- **Fix sketch**: (a) Migrate `HomeWelcome.tsx` and `FleetHealthStrip.tsx` from `useHomeTranslation` to the global `useTranslation` (the keys already exist in `src/i18n/locales/en.json` under `home.*`); (b) delete `src/features/home/i18n/` and `src/features/onboarding/i18n/` entirely; (c) add an ESLint `no-restricted-imports` rule banning `@/features/*/i18n/*` so it can't grow back.

---

## 2. Onboarding steps and tour steps are documented in different ways with different invariants

- **Severity**: High
- **Category**: documentation
- **File**: `src/features/onboarding/README.md`, `src/features/onboarding/components/StepIndicator.tsx:10-32`
- **Scenario**: A dev wants to add a new step. The README is excellent — but it's *only* about the **Guided Tour** state machine (`tourSlice.ts`). The **Onboarding Overlay** flow (`appearance → discover → pick-template → adopt → execute`) is a completely separate state machine in `onboardingSlice.ts` with its own steps array, completion events, side-effects, and persistence. Nothing documents it. The dev assumes the README applies, edits `tourSlice.ts`, and discovers nothing happens for OnboardingOverlay.
- **Root cause**: Two related but distinct flows live in the same folder; only one is documented.
- **Impact**: Knowledge silo. Every new contributor hits the confusion at least once. The two systems also share visual primitives (StepIndicator vs StepProgress) and a near-identical `STEPS` array (`StepIndicator.tsx:26-32`) that could drift from `ONBOARDING_STEPS` in the slice (line 12-18) without test coverage.
- **Fix sketch**: Extend the README with a second section ("Onboarding Overlay (first-run wizard)") documenting: the step union, step-add checklist, where step UI lives (`OnboardingOverlay.tsx`), how completion/dismiss/resume interact with `onboardingDismissedAtStep`, and the relationship between `onboardingActive` and `tourActive` (they can both be true — confirm or reject mutual exclusion). Cross-link from each component's top-of-file JSDoc to the section.

---

## 3. Dead `STEPS` constant beside its replacement — the deprecated stub is exported

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/onboarding/components/StepIndicator.tsx:25-32`
- **Scenario**: A dev imports `STEPS` (autocomplete suggests it; the export looks first-class), sees English-only labels, ships a non-i18n'd UI. The `@deprecated` JSDoc is on a single line above the export and is easy to miss in a hover preview that shows all of one line.
- **Root cause**: `STEPS` was kept "for backward-compatible imports" but nothing imports it (verified with grep). Pure cruft.
- **Impact**: Low-key foot-gun. Also bloats the typed surface of the module.
- **Fix sketch**: Delete the `STEPS` export and the `STEP_LABELS` placeholder inside; verify with a build. Inline the type onto `StepIndicator`'s `steps` prop signature.

---

## 4. Three unused presentation files in `home/` (ICONS / IconShowcase / CustomIcons)

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/home/components/IconShowcase.tsx`, `src/features/home/components/CustomIcons.tsx` (244 lines), `src/features/home/components/iconData.tsx`, `src/features/home/components/iconStyles.ts`
- **Scenario**: A dev exploring the Home folder spends 10 minutes reading 244 lines of bespoke SVG `Custom*` icons (CustomHome, CustomOverview, …) plus a swappable Lucide↔Custom showcase, before discovering nothing imports `IconShowcase` and `CustomIcons` is only consumed by `iconData.tsx`, which is only consumed by `IconShowcase`. The actual home cards use `SIDEBAR_ICONS` from `@/features/shared/components/layout/sidebar/SidebarIcons` (`NavigationGrid.tsx:31`).
- **Root cause**: An abandoned visual-spike kept in tree.
- **Impact**: ~360 lines of dead code in a 14-file feature; misleading mental model ("home has its own icon system?"); slows orientation; ships in dead-code-eliminated bundles only because tree-shaking works, but still increases TS check time and grep noise.
- **Fix sketch**: Delete all four files. If the SVG art is worth keeping, move the components into `shared/components/icons/` and add at least one real consumer; otherwise nuke.

---

## 5. Two `EmptyState` components with identical names in shared

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/shared/components/feedback/EmptyState.tsx` (205 lines, scenario-variant API), `src/features/shared/components/display/EmptyState.tsx` (116 lines, illustration API)
- **Scenario**: A dev needs an empty state. They auto-import `EmptyState` from VS Code's symbol picker — which one wins is alphabetical/cache-dependent. They get the wrong API, see different props, get confused. Both are actively used (19 vs 4 consumers respectively), so neither is removable.
- **Root cause**: Two designers/devs built different empty-state primitives without coordinating. The folders (`feedback/` vs `display/`) hint at intent but the symbol name collides.
- **Impact**: Recurring papercut on every empty-state addition; PRs with the wrong import; AI agents have a >0% chance of guessing wrong.
- **Fix sketch**: Rename to communicate the API: `feedback/EmptyState.tsx` → `ScenarioEmptyState` (variant-driven), `display/EmptyState.tsx` → `IllustratedEmptyState`. Update barrel index files. Or, better, merge the two: scenarios are essentially named (illustration, title, subtitle, steps) tuples — make one component with both modes.

---

## 6. No tests for any onboarding/home logic — including a 287-line stateful hook

- **Severity**: High
- **Category**: testing
- **File**: `src/features/onboarding/components/useOnboardingState.ts` (287 lines), `src/stores/slices/system/onboardingSlice.ts` (172 lines)
- **Scenario**: `useOnboardingState` does template fetching with fallback chains (`getTrendingTemplates → listDesignReviews`), dedupe-on-double-click adoption, desktop scan with cancellation, and post-adoption persona refresh. The slice has 5 actions with subtly different reset semantics (start vs resume vs dismiss vs finish vs reopen — see lines 98-171). All untested. Other features in the repo (matrix, simple-mode, network) have colocated test suites; onboarding/home have zero.
- **Root cause**: The team built test infrastructure but onboarding work happened during fast-iteration phases where coverage wasn't enforced.
- **Impact**: A regression on adoption dedupe (double-promote), template fallback ordering, or step-completion semantics ships silently. The cancel-rapid-reopen comment on `ExecutionStep.tsx:39-44` literally describes a previously-shipped bug — exactly the kind of thing tests prevent.
- **Fix sketch**: Add `useOnboardingState.test.ts` with `vitest` + `@testing-library/react`'s `renderHook`, mocking the API modules. Cover: trending succeeds, trending fails → fallback succeeds, both fail → error phase, retry nonce, double-click dedupe within 1s, adoption-complete advances to execute. Add a slice unit test for the dismiss/resume/finish/reopen quartet. ~150 lines of test for a critical-path flow.

---

## 7. `OnboardingOverlay` does prop-drilling instead of letting steps own their state

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/onboarding/components/OnboardingOverlay.tsx:18-46`
- **Scenario**: The overlay destructures **22 fields** out of `useOnboardingState()` and forwards subsets to step components. To add a sub-step (say a credentials wizard inside `discover`), you have to thread props through three layers. The hook itself is one mega-blob mixing template loading, desktop discovery, adoption, and execution — modules that are otherwise unrelated.
- **Root cause**: A "pull all state up, push it down" pattern that worked at 2 steps and got worse at 5.
- **Impact**: Each step component's prop list grows with every store change; the hook is 287 lines because it hosts 4 unrelated concerns. Re-renders cascade — touching `approvedApps` re-renders the whole overlay including unrelated steps.
- **Fix sketch**: Split `useOnboardingState` into `useOnboardingNav` (step transitions only), `useOnboardingTemplates`, `useDesktopDiscovery`, `useOnboardingAdoption`. Each step component imports only the hook(s) it needs. The overlay shrinks to step-routing + dismiss handling.

---

## 8. Step-id strings and side-effect branches are duplicated and unsynchronized

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/onboarding/components/GuidedTour.tsx:90-105`, `src/features/onboarding/components/TourPanelBody.tsx:48`, `src/features/onboarding/components/tourConstants.ts:13-26`
- **Scenario**: The id `'appearance-setup'` appears (a) as `step.id` in the slice, (b) hard-coded in `GuidedTour.navigateToStep` for baseline capture, (c) hard-coded in `TourPanelBody` to gate specialized content, (d) keyed in `ICON_MAP`, (e) keyed in `STEP_TO_SURFACE`. Drop a typo in any one and the step renders with wrong icon/color/content silently — no compile error, no warning. The README acknowledges this on lines 51 and 79 ("Missing entries fall back silently") without a way to enforce.
- **Root cause**: String-typed step ids without a registry export.
- **Impact**: Adding a step is a 5-file change with no compile-time net. Bug surface is invisible until runtime.
- **Fix sketch**: Export a `TourStepId` union from `tourSlice.ts` (already exists), then make `ICON_MAP`/`STEP_TO_SURFACE`/the `hasSpecialContent` array in TourPanelBody typed as `Record<TourStepId, …>` or `readonly TourStepId[]`. Missing keys become compile errors. Pair with a unit test asserting `every TourStepId has an icon and a color`.

---

## 9. Magic timeouts (100ms, 150ms, 300ms, 500ms, 5000ms) scattered across tour code

- **Severity**: Medium
- **Category**: code-organization
- **File**: `GuidedTour.tsx:86,94,96,102,104,122`, `TourSpotlight.tsx:67-68,144,151`
- **Scenario**: Section-mount delay (100ms), credential-bus emit delay (150ms), persona-modal open delay (150ms), spotlight-measure delay (300ms), spotlight-retry interval (500ms), timed-step auto-advance (5000ms). Each is a bare number literal with no name. When a step transition feels janky, a dev has to read three files to find the right knob. Two existing comments already document race conditions ("listen() resolves asynchronously…", "transient disconnect mid-step-navigation").
- **Root cause**: Iterative bug-fixing added each delay in isolation.
- **Impact**: Tuning is shotgun debugging; constants drift; nobody knows which is critical vs cargo-culted.
- **Fix sketch**: Extract a `TOUR_TIMINGS` constants module (`SECTION_MOUNT_MS`, `STORE_BUS_EMIT_MS`, `SPOTLIGHT_MEASURE_MS`, `SPOTLIGHT_RETRY_MS`, `SPOTLIGHT_MAX_RETRIES`, `TIMED_STEP_AUTOADVANCE_MS`). Each constant gets a one-line comment explaining *why* (which race it fixes). Reuse across both files.

---

## 10. `STEP_ORDER` exists in two places and could silently disagree

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/onboarding/components/OnboardingProgressBar.tsx:7`, `src/stores/slices/system/onboardingSlice.ts:12-18`
- **Scenario**: Slice exports `ONBOARDING_STEPS` as the canonical order. `OnboardingProgressBar.tsx:7` redeclares its own `STEP_ORDER: OnboardingStep[]`. Both happen to be in the same order today. If someone reorders `ONBOARDING_STEPS` in the slice (the canonical source) without touching the progress bar, the progress percentage and checklist will go out of sync with the actual flow — silently.
- **Root cause**: Local convenience over import.
- **Impact**: Silent UI/state divergence on next reorder.
- **Fix sketch**: Import `ONBOARDING_STEPS` from the slice; delete the local copy.

---

## 11. Discovery scan starts even when nothing depends on it yet

- **Severity**: Low
- **Category**: build-speed (perf, dev-loop)
- **File**: `src/features/onboarding/components/useOnboardingState.ts:76-93`
- **Scenario**: As soon as `onboardingActive` flips true (step = `appearance`), `discoverDesktopApps()` fires — even though the user is on the appearance step and may dismiss before reaching `discover`. That's a Tauri IPC + filesystem scan on every onboarding open. In dev with HMR, every save that touches the overlay re-fires the scan.
- **Root cause**: One mount-time effect rather than gating by `onboardingStep === 'discover'`.
- **Impact**: Slower onboarding-open feel during dev; unneeded IPC noise. Not user-blocking, but a papercut for anyone iterating on the appearance UI.
- **Fix sketch**: Move the discovery effect dependency from `[onboardingActive]` to `[onboardingActive, onboardingStep === 'discover']` — or simpler, lift the effect into `DesktopDiscoveryStep` itself so it only runs when mounted. (This also helps Issue #7's separation of concerns.)

---

## 12. `OnboardingOverlay`'s `STEP_LABELS` map duplicates labels already in `STEPS`/i18n

- **Severity**: Low
- **Category**: convention-drift
- **File**: `src/features/onboarding/components/OnboardingProgressBar.tsx:17-23`
- **Scenario**: The progress bar builds its own `STEP_LABELS` from `t.onboarding.progress_*` keys. The overlay uses `useSteps()` which builds labels from `t.onboarding.step_*` keys. Two sets of translation keys (`progress_appearance` vs `step_appearance`) for the same five steps in the same flow.
- **Root cause**: Two devs building two surfaces shipped two key conventions.
- **Impact**: Translators duplicate work in 14 locales; labels can drift mid-flow ("Look & Feel" vs "Appearance"); bundle larger.
- **Fix sketch**: Pick one set (`step_*` is shorter and matches the overlay), delete the other across all 14 locales. Add a check:i18n script rule warning on duplicate-meaning keys.

---

## 13. `HomePage` uses the same `key={homeTab}` remount trick as a navigation primitive

- **Severity**: Low
- **Category**: dev-loop-friction
- **File**: `src/features/home/components/HomePage.tsx:18`, `src/features/onboarding/components/OnboardingOverlay.tsx:104-105`
- **Scenario**: The pattern of forcing remount via `key={changingStateValue}` to trigger an `animate-fade-slide-in` happens in both files. It's a clever way to play the entrance animation, but it loses internal state every time the tab changes (e.g. scroll position in `HomeRoadmapView`, in-progress textarea drafts). When a dev later builds a stateful sub-feature inside one of these surfaces, they will be confused why their state vanishes.
- **Root cause**: Animation framework (Tailwind `animate-fade-slide-in`) doesn't have a built-in "play once on enter" hook; remount-via-key is the cheap workaround.
- **Impact**: Subtle data loss on tab switch; a footgun for future stateful additions.
- **Fix sketch**: Either document the constraint at the top of each file ("DO NOT add stateful inputs without keeping their state in a parent store — this view fully remounts on every tab/step change") or migrate to framer-motion's `AnimatePresence` (already imported elsewhere in the codebase) which animates without remount.
