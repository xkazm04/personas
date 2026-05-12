# Code-refactor scan — Onboarding, Home & Simple Mode

> Total: 8 findings (3 high, 4 medium, 1 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: significant — see below

**Path drift detected (listed scope vs reality):**
- `src/features/simple-mode/` — does not exist. Simple Mode is a tier flag (`useTier().isStarter`) sprinkled across ~15 files; not a feature directory. See `docs/features/interface-modes/simple-mode.md`.
- `src/api/onboarding.ts`, `src/api/home.ts` — do not exist.
- `src/lib/onboarding/`, `src/lib/simpleMode/` — do not exist.
- `src/stores/slices/onboardingSlice.ts`, `homeSlice.ts`, `simpleModeSlice.ts` — actual locations are `src/stores/slices/system/onboardingSlice.ts` (canonical) and `src/stores/slices/system/setupSlice.ts` (home setup). No `homeSlice` or `simpleModeSlice` exist.
- `src-tauri/src/commands/onboarding.rs`, `home.rs`, `db/models/onboarding.rs`, `db/repos/onboarding/`, `lib/onboarding/` — none exist. Onboarding is **frontend-only**; only ambient mentions appear in companion prompt templates and `settings_keys.rs`.

Scan re-scoped to: `src/features/onboarding/`, `src/features/home/`, `src/stores/slices/system/{onboardingSlice,setupSlice,tourSlice}.ts`, `src/stores/onboardingQuestStore.ts`.

---

## 1. `SetupCards` is a 625-LOC orphan module (whole-file dead code)

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/home/components/SetupCards.tsx:1`
- **Scenario**: `SetupCards` (default export, plus internal `SetupStepper`, `StepIndicator`, `RoleStep`, `ToolStep`, `GoalStep`, `SetupCardItem`) is imported nowhere in `src/`. The only references are its own definition, the `setupSlice.ts` docstring, the `UnifiedBuildEntry.tsx` *comment*, the onboarding README, and the home.md doc. The actual `WelcomeLayout.tsx` renders `ResumeBanner` + `HeroHeader` + `NavigationGrid` + `LanguageCards` — never `SetupCards`.
- **Root cause**: The "Role → Tool → Goal" stepper was removed from the home page but the component and its supporting `setupSlice` were left in tree. `UnifiedBuildEntry` still reads `setupGoal` to pre-fill the build intent — but nothing in the live app *writes* it, so the bridge is dormant.
- **Impact**: 625 LOC of unreachable React (motion, modals, illustrations, draft-state bug-fix logic) shipped in the bundle; `setupSlice` (~69 LOC) is permanently persisted to localStorage for every user with `setupRole/setupTool/setupGoal/setupCompleted` that nothing can set. Misleads future devs: docs/`README.md` still treat it as a live surface ("precedence contract" section references it).
- **Fix sketch**: Delete `SetupCards.tsx`. Either delete `setupSlice` entirely and rip out the `UnifiedBuildEntry` bridge (lines reading/clearing `setupGoal`), or keep the slice only if another surface is genuinely about to consume it. Update `docs/features/home.md` and `src/features/onboarding/README.md` to drop the SetupCards rows.

## 2. `OnboardingProgressBar` (89 LOC) and `FleetHealthStrip` + `fleetHealth` lib (133 + 50 LOC) are orphan modules

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/onboarding/components/OnboardingProgressBar.tsx:1`, `src/features/home/components/FleetHealthStrip.tsx:1`, `src/features/home/lib/fleetHealth.ts:1`
- **Scenario**: Three exported components/modules with no importer anywhere in `src/`.
  - `OnboardingProgressBar`: only self-reference + a docs mention. Designed to render in a sidebar while onboarding is active; never wired up.
  - `FleetHealthStrip`: defines `useFleetMetrics` + `MetricPill` + the strip; only its own test references `fleetHealth.ts::hasFailureSpike`. `WelcomeLayout` (the actual home layout) never imports it.
  - `fleetHealth.ts` exists only to serve the orphan strip; its `.test.ts` is the only other consumer.
- **Root cause**: Components scaffolded for a Home layout iteration that landed differently. The keep-the-test reflex preserved `fleetHealth.test.ts` and so the helper looked "used".
- **Impact**: ~272 LOC dead + a test file giving false coverage signal. `FleetHealthStrip` imports a Tauri API (`listCredentials`) and `getMetricsSummary` — it's also adding indirect graph weight to the bundle that the planner-side may not notice.
- **Fix sketch**: Delete all three files plus `fleetHealth.test.ts`. Drop the doc references in `home.md` ("fleet health strip" row in the Tabs table).

## 3. Three near-duplicate step-indicator components for three modal/panel surfaces

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/onboarding/components/StepIndicator.tsx:25`, `src/features/onboarding/components/StepProgress.tsx:12`, `src/features/home/components/SetupCards.tsx:67`
- **Scenario**: All three render the same conceptual UI: a horizontal row of stepper pills with current/completed/upcoming state, color tokens, and Check-when-done. Implementations diverge superficially (pill vs circle, colored-by-tour vs flat, with-arrow-separator vs with-line-separator) but each owns its own ~50-LOC layout. `StepIndicator` is used by `OnboardingOverlay`, `StepProgress` by `TourPanelBody`, the SetupCards copy is local. The wider codebase additionally has `WizardStepIndicator`, `ForagingStepIndicator`, `N8nStepIndicator` — but those have distinctly different shapes (phase/stage indicators, not step-counter pills).
- **Root cause**: Each was written when its surface was the first/only consumer; the cross-cutting "step counter pill row" abstraction was never extracted.
- **Impact**: Three places to change when the design system tightens (rounded radius tokens, focus rings, animation timing). Inconsistent treatment of "current after a completed step" already drifts between the three.
- **Fix sketch**: Extract a shared `<StepperRow steps={[{id,label,icon,color?}]} currentId completedIds variant="pill"|"dot"|"arrow" />` into `src/features/shared/components/feedback/`. Inline `SetupCards.StepIndicator` and `StepProgress` collapse to passing props. Defer until SetupCards finding (#1) is resolved — if SetupCards is deleted this is a 2-site dedup, only worth doing if the shared component already lands cleanly.

## 4. `AppearanceStep` (116 LOC) and `TourAppearanceContent` (81 LOC) duplicate the same picker stack

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/onboarding/components/AppearanceStep.tsx:25`, `src/features/onboarding/components/steps/TourAppearanceContent.tsx:10`
- **Scenario**: Both pull `themeId`, `setTheme`, `textScale`, `setTextScale`, `brightness`, `setBrightness`, `isDark`, brightness-levels, dark/light theme partitions, and render `TextScalePicker` + `BrightnessPicker` + `SimpleThemePicker` twice (dark + light). The only differences are (a) `AppearanceStep` includes an inline 11-language picker, (b) `TourAppearanceContent` passes `density="compact"` + `testIdPrefix="tour-appearance"`. Same theme-store wiring lines repeat verbatim.
- **Root cause**: Tour and onboarding teams each rolled their own composition of the underlying `AppearancePickers`. The shared `AppearancePickers` module is the right boundary; the composition wasn't extracted.
- **Impact**: Any change to the appearance picker layout (new picker, theme-store shape change) needs both files. Already evident: `AppearanceStep` has the language picker inline (also duplicated below), `TourAppearanceContent` does not.
- **Fix sketch**: Extract `<AppearanceControlsStack density?="compact"|"default" testIdPrefix?: string showLanguagePicker?: boolean />` colocated with `AppearancePickers.tsx`. `AppearanceStep` becomes `<AppearanceControlsStack showLanguagePicker />`; `TourAppearanceContent` becomes `<AppearanceControlsStack density="compact" testIdPrefix="tour-appearance" />`. ~150 LOC collapse.

## 5. Onboarding step list (`OnboardingStep` literals) duplicated across 4 sites

- **Severity**: medium
- **Category**: duplication
- **File**: `src/stores/slices/system/onboardingSlice.ts:9-18`, `src/stores/slices/system/onboardingSlice.ts:76-82` (`INITIAL_STEP_STATUS`), `src/features/onboarding/components/StepIndicator.tsx:14-22` (`useSteps`), `src/features/onboarding/components/OnboardingProgressBar.tsx:7` (`STEP_ORDER`) and `:17-23` (`STEP_LABELS`)
- **Scenario**: The five steps `appearance | discover | pick-template | adopt | execute` appear in (a) the union type, (b) the `ONBOARDING_STEPS` array, (c) `INITIAL_STEP_STATUS` keys, (d) `useSteps` returning per-step icon/label, (e) `OnboardingProgressBar`'s `STEP_ORDER` + `STEP_LABELS`. Adding a 6th step requires touching all five locations — and we can verify nothing was missed only by running and visually inspecting two surfaces.
- **Root cause**: Step metadata (label-key, icon) wasn't co-located with the canonical step list when the slice was written.
- **Impact**: High-effort schema change for a closed-set type; subtle bug surface (`INITIAL_STEP_STATUS` lying about which steps exist if the union grows without it).
- **Fix sketch**: In `onboardingSlice.ts` define `export const ONBOARDING_STEP_DEFS: readonly { id: OnboardingStep; labelKey: string; iconName: string }[]`. Derive `ONBOARDING_STEPS` and `INITIAL_STEP_STATUS` from it. `useSteps` and `OnboardingProgressBar` import the defs and map icon name → lucide component locally. (Note: deletion in finding #2 removes the `OnboardingProgressBar` consumer, leaving 3 sites — still worth consolidating.)

## 6. `ONBOARDING_LANGUAGES` (11 entries) duplicates the canonical `LANGUAGES` table (14 entries)

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/onboarding/components/AppearanceStep.tsx:11-23`, `src/features/home/components/LanguageSwitcher.tsx:17-32`
- **Scenario**: `AppearanceStep` hand-rolls an 11-language array of `{code,label,flag}` and renders its own grid; `LanguageSwitcher.LanguageCardGrid` already owns the canonical 14-language list with the script-family ordering, flag, label, english name, and `useLanguagePrefetch` plumbing. The onboarding copy is a strict subset (missing `id`, `vi`, `bn`) and the entries that *are* present duplicate the flag-emoji and label strings.
- **Root cause**: Onboarding picker was authored before `LanguageCardGrid` existed; never reconciled.
- **Impact**: Two sources of truth for "what languages does this app support". Already drifted: 3 languages added to `LanguageSwitcher` aren't offered in onboarding, silently. New language additions will keep missing onboarding.
- **Fix sketch**: Export `LANGUAGES` (and optionally `LanguageCardGrid` in a "compact" density) from `LanguageSwitcher.tsx`. `AppearanceStep` either imports the data list or reuses `<LanguageCardGrid density="compact" />` outright. Same prefetch handlers already live in both places.

## 7. Gradient/glow card pattern repeated across `NavigationGrid`, `SetupCards`, `HomeLearning`-style tiles

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/home/components/NavigationGrid.tsx:50-79` (NavCardWrapper inner block), `src/features/home/components/SetupCards.tsx:506-552` (`SetupCardItem` illustration area)
- **Scenario**: Both implement the same recipe: `relative ... aspect-[4/3] rounded-modal border overflow-hidden bg-gradient-to-br ${gradFrom} ${gradTo} ${accentBorder} shadow-elevation-1 group-hover:shadow-elevation-3` + a `${glowColor} blur-3xl rounded-full opacity-0 group-hover:opacity-40` blob + a bottom title overlay with `bg-gradient-to-t dark:from-black/40 ... to-transparent` + a "bottom gradient line". The shared shape is roughly 30 LOC of layered JSX; the prop surfaces (`gradFrom/gradTo/glowColor/accentBorder/iconText`) are identical.
- **Root cause**: Both authored at similar times against the same Design.md token, but no shared "IllustratedCard" wrapper exists.
- **Impact**: Two sites to touch for design polish; already shows tiny drift (NavigationGrid uses `aspect-[4/3]`, SetupCards uses fixed `h-[140px]`).
- **Fix sketch**: If finding #1 is accepted (delete SetupCards), this collapses to a 1-site concern and isn't worth extracting. If SetupCards survives, extract `<GlowGradientCard gradFrom gradTo glowColor accentBorder iconText size={"aspect" | "fixed-140"}>{children}</GlowGradientCard>` to `features/shared/components/display/` and reuse.

## 8. `OnboardingOverlay` "skip" button + dismiss icon render the same action with two distinct affordances

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/onboarding/components/OnboardingOverlay.tsx:128-135` and `:196-201`
- **Scenario**: The header X button (line 128) and the footer "Skip" button (line 196) both call `dismissOnboarding`. The CTA strings differ — `t.onboarding.skip_tooltip` for the X, `t.onboarding.skip_button` for the footer — but the resulting state transition is identical. The X also lives in `BaseModal`'s own close affordance via `onClose={dismissOnboarding}` (line 110), making this the *third* path to the same action on every step.
- **Root cause**: Modal evolution: the X was added first; the footer Skip was added later for visibility; `BaseModal.onClose` is implicit. None pruned.
- **Impact**: Three click targets for the same destructive action; two of them are inside the BaseModal scrim that already has its own ESC + scrim-click handling. Tooltip strings drift independently.
- **Fix sketch**: Keep one explicit user-facing affordance (the footer Skip is the most discoverable); drop the header X. `BaseModal.onClose` already covers keyboard/scrim dismissal. Saves ~10 LOC and removes a future i18n drift surface.
