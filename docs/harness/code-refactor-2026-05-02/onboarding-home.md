# Code Refactor Scan — Onboarding & Home

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~32

## Summary

The onboarding and home surfaces work, but the folder carries a noticeable amount of decorative/abandoned code and several near-duplicates of theme-picker UI. Three patterns dominate: (1) **dead-code islands** — entire components and a dev-only icon showcase that nothing imports, but which still grep-pollute the feature ("home has its own icon system?"); (2) **drift between the Onboarding wizard and the Guided Tour** — they each ship their own Step indicator, their own Appearance panel, their own progress widget, with copy-paste UI shells that have already begun to diverge (different sizes, different test ids, different stylings); (3) **English string leaks** in spots where everything else around them is i18n'd, suggesting these blocks were ported in a hurry and never finished. The `releases/` sub-tree is in good shape and is not flagged. Most findings are mechanical to fix — delete-and-grep verifies cleanly because there are no dynamic dispatches into the affected modules.

## 1. `IconShowcase` + `CustomIcons` + `iconData` + `iconStyles` — orphan icon island in home/

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/home/components/IconShowcase.tsx`, `src/features/home/components/CustomIcons.tsx` (245 lines), `src/features/home/components/iconData.tsx`, `src/features/home/components/iconStyles.ts`
- **Scenario**: Four files form a closed cycle: `IconShowcase` imports `iconData` + `iconStyles`; `iconData` imports `CustomIcons`; nothing else imports any of them. Project-wide grep for every Custom* export name (`CustomHome`, `CustomOverview`, `CustomAgents`, `CustomEvents`, `CustomKeys`, `CustomTemplates`, `CustomTeams`, `CustomCloud`, `CustomSettings`) hits only the two definitions — no consumers anywhere. The actual `NavigationGrid` cards use `SIDEBAR_ICONS` from `@/features/shared/components/layout/sidebar/SidebarIcons` (`NavigationGrid.tsx:31`).
- **Root cause**: Abandoned visual exploration that was kept "in case we want to switch to bespoke icons." The 2026-04-27 dev-experience scan flagged this same island, but it has not been removed.
- **Impact**: ~360 lines of code that grep-pollute the home feature, mislead readers into thinking home owns an icon system, slow IDE indexing, and survive every reorganization because each file imports another in the cluster (so a "find unused" lint won't catch any of them in isolation).
- **Fix sketch**:
  - Delete `CustomIcons.tsx`, `iconData.tsx`, `iconStyles.ts`, `IconShowcase.tsx`.
  - Verify TypeScript build is clean — there are zero external imports.
  - If the SVG art is wanted later, recover from git history; do not move into `shared/` speculatively.

## 2. `OnboardingProgressBar` is dead — defined, never rendered

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/onboarding/components/OnboardingProgressBar.tsx`
- **Scenario**: The component is fully implemented (90 lines, reads `useSystemStore`/`useAgentStore`, renders a step checklist with an animated progress bar). Project-wide grep for `OnboardingProgressBar` returns only its own definition file plus `lint-output.json` and a stale audit doc. No JSX consumer, no lazy import, no `React.lazy(() => import(...))`, no dynamic-string lookup.
- **Root cause**: Likely planned to live in the sidebar above `TourLauncher`, but the actual implementation went a different route (the `OnboardingOverlay` modal owns the step UI itself). The progress bar was never wired up.
- **Impact**: A reader of the onboarding folder reasonably assumes this is mounted somewhere; tracing the call chain wastes 10 minutes. Carries its own `STEP_LABELS` map that would silently drift from `OnboardingOverlay`/`StepIndicator` if it ever were re-mounted.
- **Fix sketch**: Delete the file. If a sidebar progress affordance is wanted, file an idea — don't keep the orphan in tree as a placeholder.

## 3. Three-way duplication of the theme/text-scale/brightness picker

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/onboarding/components/AppearanceStep.tsx:107-232`, `src/features/onboarding/components/steps/TourAppearanceContent.tsx:22-148`, `src/features/settings/sub_appearance/components/AppearanceSettings.tsx` (~line 329)
- **Scenario**: All three render the same primitives — `TEXT_SCALES.map(...)`, `darkThemes.map(...)`, `lightThemes.map(...)`, `brightnessLevels.map(...)` — with copy-paste card markup. They've already diverged: `AppearanceStep` uses `w-3.5 h-3.5` icons and `gap-2`, `TourAppearanceContent` uses `w-2.5 h-2.5` icons and `gap-1.5`, and only the tour version has `data-testid="tour-appearance-textscale-${id}"` hooks. The brightness icon-opacity is computed inline in `TourAppearanceContent` (`i === 0 ? 'opacity-40' : i === 1 ? 'opacity-70' : 'opacity-100'`) but `AppearanceStep` reads it from a store-exported constant `BRIGHTNESS_ICON_OPACITY_BY_INDEX` — same intent, different source of truth.
- **Root cause**: The tour was built as a guided coaching layer on top of an existing AppearanceStep, and it copy-pasted the picker UI rather than embedding the existing component.
- **Impact**: Three sites to fix when adding a new theme, three sites to verify when changing the brightness levels, and the divergence is already visible (selection-check icon size mismatches across the same flow). Test-id coverage is uneven.
- **Fix sketch**:
  - Extract `<ThemePickerSection />`, `<TextScaleSection />`, `<BrightnessSection />` into a shared module (e.g. `src/features/shared/components/appearance/`) parameterized by `density: 'comfortable' | 'compact'` and an optional `testIdPrefix`.
  - Have all three call sites (`AppearanceStep`, `TourAppearanceContent`, `AppearanceSettings`) consume them.
  - Drop the inline opacity ladder in `TourAppearanceContent` in favor of the same `BRIGHTNESS_ICON_OPACITY_BY_INDEX` source-of-truth.

## 4. `LanguageSwitcher` default export (the dropdown) is unused — only the card grid is consumed

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/home/components/LanguageSwitcher.tsx:97-195`
- **Scenario**: The file exports two components: `LanguageCardGrid` (named) — used by `WelcomeLayout` — and `LanguageSwitcher` (default, the popover dropdown). Project-wide grep for `LanguageSwitcher` hits only `LanguageSwitcher.tsx`, the harness scenario parser (string match against the filename, not a component import), and `lint-output.json`. No JSX consumer.
- **Root cause**: The dropdown was likely the original implementation; the inline grid replaced it. The dropdown was kept around "just in case."
- **Impact**: ~100 lines of duplicated language-switching UI living next to the in-use `LanguageCardGrid` (same `LANGUAGES` constant, same illustration helper, same selection logic). Two near-identical card renderers exist within the same file.
- **Fix sketch**:
  - Delete the `LanguageSwitcher` default export and the second card grid that lives inside it (lines ~120-192).
  - Promote `LanguageCardGrid` to default (or leave it named — adjust the `WelcomeLayout` lazy import accordingly).
  - The shared `LANGUAGES`, `sortLanguages`, `langIllustration` helpers stay.

## 5. `FleetHealthStrip` is a fully-built unused component

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/home/components/FleetHealthStrip.tsx` (135 lines)
- **Scenario**: Implements a metric-pill row (executions today, success rate with failure-spike pulse, active agents, credential count) backed by `getMetricsSummary` + `listCredentials`. Project-wide grep returns only its own file, audit docs, and `lint-output.json`. Not referenced from `WelcomeLayout`, `HomePage`, or `HomeWelcome`.
- **Root cause**: Built for the home hero strip but not adopted — the home page currently shows `ResumeBanner` + `HeroHeader` + `SetupCards` + `NavigationGrid` instead. Carries IPC calls (`getMetricsSummary(1)`, `listCredentials()`) that would fire on every Home mount if it were ever re-enabled.
- **Impact**: 135 lines of dead code that includes its own metric-fetching hook (`useFleetMetrics`) and a one-off `MetricPill` primitive. Reading the home folder, it's unclear whether this is the "real" health strip or a deprecated draft.
- **Fix sketch**:
  - Either delete entirely, or, if the team still wants it on home, add a single import in `WelcomeLayout` and confirm the IPC cost is acceptable on cold launch.
  - Recommend delete — `Overview > Health` already covers this.

## 6. Onboarding flow components and Tour components are flat-mixed in `components/`

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/onboarding/components/`
- **Scenario**: The folder mixes two unrelated flows. **Onboarding wizard** (one-time first-run modal): `OnboardingOverlay`, `AppearanceStep`, `DesktopDiscoveryStep`, `TemplatePickerStep`, `ExecutionStep`, `StepIndicator`, `useOnboardingState`. **Guided Tour** (re-runnable coach): `TourLauncher`, `GuidedTour`, `TourPanelBody`, `TourSpotlight`, `StepProgress`, `tourConstants`, `steps/` (only used by the tour). They share the folder but not the state machine, not the store slice (`onboardingSlice` vs `tourSlice`), not the persistence model. The README correctly documents only the tour — the onboarding wizard is undocumented because it appears to be the same thing at first glance.
- **Root cause**: Started as one feature; the tour was added later as a sibling without splitting the folder.
- **Impact**: New contributors hit the confusion every time. `StepIndicator.tsx` (onboarding) and `StepProgress.tsx` (tour) are similarly named, both render step rows with a `Check` icon, and live in the same folder — auto-import will pick the wrong one.
- **Fix sketch**:
  - Split into `src/features/onboarding/components/wizard/` (overlay + 4 steps + StepIndicator + useOnboardingState) and `src/features/onboarding/components/tour/` (GuidedTour + TourPanelBody + TourSpotlight + TourLauncher + StepProgress + tourConstants + existing `steps/`).
  - Or rename the feature root: keep `onboarding/` for the wizard and create `src/features/tour/` for the tour. Either way, stop co-locating two distinct state machines under the same folder.
  - Update README to cover both flows or split into two READMEs.

## 7. English-string leaks inside otherwise i18n'd onboarding files

- **Severity**: medium
- **Category**: cleanup
- **File**: `src/features/onboarding/components/steps/PersonaCreationCoach.tsx:6-28`, `src/features/home/components/SetupCards.tsx:25-49,55-59,417-454`
- **Scenario**: Both files import `useTranslation` and i18n most of their copy, but several arrays of user-visible strings are hardcoded English: `SUB_STEPS` labels (`'Describe'`, `'Answer'`, `'Review'`, `'Promote'`), `EXAMPLE_INTENTS` (3 full English sentences), `STEPS` step labels (`'Role'`, `'Tool'`, `'Goal'`), `ROLES` `label` and `subtitle` (`'Office Rat'`, `'Non-technical user'`, ...), and `CARD_DEFS` `defaultTitle`/`description`. A French or Czech user gets a half-translated screen.
- **Root cause**: These constants were defined at module scope (not inside the component) before the i18n migration reached this file, and the migration only touched the JSX-literal strings.
- **Impact**: Recurring i18n bug surface; quality regressions in non-English builds; QA has to hunt these every release. The `home.setup_stepper` translation namespace already exists and is partially used (line 178 onwards), so the keys exist — they just aren't wired here.
- **Fix sketch**:
  - Move the static metadata into i18n (`onboarding.persona_coach.sub_steps[*].label`, `onboarding.persona_coach.example_intents`, `home.setup_stepper.steps[*].label`, `home.setup.roles[*].label/subtitle`, `home.setup.cards[*].title/description`).
  - Compute the localized arrays inside the component using `t.*`.
  - Keep the icon/color metadata at module scope; only the user-visible strings move.

## 8. `OnboardingOverlay` prop-drills 22 fields out of one mega-hook

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/onboarding/components/OnboardingOverlay.tsx:18-46`, `src/features/onboarding/components/useOnboardingState.ts` (287 lines)
- **Scenario**: `useOnboardingState` returns a 22-field bag mixing four unrelated concerns: template loading (with trending/fallback chain + retry nonce), desktop discovery (with cancellation flag), adoption (with double-click dedupe ref), execution. `OnboardingOverlay` destructures all 22 and forwards subsets to four step components. Touching any single field — e.g. `setApprovedApps` adding a new connector — re-renders the entire overlay because `useOnboardingState` returns a fresh object every call.
- **Root cause**: Pull-up state pattern that scaled fine at 2 steps and degraded at 5.
- **Impact**: Hook is hard to test (must mock 4 unrelated APIs to test any one branch); re-render storms during desktop scan; adding a sub-step requires threading new props through the overlay even when only one step needs them.
- **Fix sketch**:
  - Split into `useOnboardingNav` (step transitions, ~20 lines), `useOnboardingTemplates` (~80 lines), `useDesktopDiscovery` (~50 lines), `useOnboardingAdoption` (~40 lines), `useOnboardingExecution` (~30 lines).
  - Each step component imports only the hook(s) it needs. `OnboardingOverlay` shrinks to step-routing + dismiss handling.
  - Memoize the returned object in each split hook with `useMemo` to prevent ref churn.

## 9. `STEP_ORDER` defined in two places — orphan copy in dead `OnboardingProgressBar`

- **Severity**: low
- **Category**: duplication
- **File**: `src/features/onboarding/components/OnboardingProgressBar.tsx:7`, `src/stores/slices/system/onboardingSlice.ts` (the canonical `ONBOARDING_STEPS`)
- **Scenario**: `OnboardingProgressBar.tsx` declares its own `STEP_ORDER: OnboardingStep[] = ['appearance', 'discover', 'pick-template', 'adopt', 'execute']` literal — duplicating the slice's source-of-truth. If the slice ever adds a step, the progress bar would silently miss it. (Mooted by finding #2 — the file is dead — but listed separately because if anyone resurrects the file, they'll inherit the drift.)
- **Root cause**: Convenience copy at write-time without re-reading the slice's exports.
- **Impact**: Minimal today (file is unused). Future-tense risk if revived.
- **Fix sketch**:
  - Resolves automatically when finding #2 deletes the file.
  - If the file is kept for some reason, import the array from the slice (export `ONBOARDING_STEP_ORDER` from `onboardingSlice.ts` and consume it).

> Total: 9 findings (3 high, 5 medium, 1 low)
