# UI Perfectionist — onboarding-home-welcome
> Total: 6
> Severity: 1 critical, 2 high, 2 medium, 1 low

## 1. Cockpit fetch error renders the "empty" CTA — error-blind first impression
- **Severity**: critical
- **Category**: missing-state
- **File**: src/features/home/sub_cockpit/CockpitPanel.tsx:64-69
- **Scenario**: If `companionGetCockpit()` rejects (backend not ready on first boot, IPC hiccup), the catch sets `loading=false` but leaves `spec=null`. The panel then takes the `!spec` branch (line 163) and shows the full "Your cockpit is empty — ask Athena to compose a view" hero. A brand-new user whose first cockpit fetch failed is told their cockpit is empty and nudged to re-ask Athena (who may have already composed one), with no retry and no signal that anything went wrong.
- **Root cause**: The component models exactly two outcomes — `loading` and `spec | null`. A rejected promise collapses into the same `null` state as a genuinely-never-composed cockpit, so the error and empty states are indistinguishable.
- **Impact**: error-blind
- **Fix sketch**: Add an `error` state to the `load()` catch (e.g. `const [error, setError] = useState<unknown>(null)`; set it in catch, clear it on success). Branch before the empty check: render an error panel (icon + "Couldn't load your cockpit" + a `Retry` button calling `load()`) using the same `rounded-modal border` shell as `CockpitEmptyState` so it reads as a sibling state, not a crash.

## 2. Data-fetching cockpit widgets show "empty" while still loading
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/home/sub_cockpit/widgets/PersonaOverviewWidget.tsx:49-84
- **Scenario**: On first cockpit render, `PersonaOverviewWidget` fetches personas in an effect but, on the first paint, `personas` is empty, so `!hero` is true (line 77) and it immediately flashes the "no personas" empty state with a Bot icon — then pops into the hero card a frame later when the fetch resolves. `ConnectedServicesWidget` (line 85, "No connections yet") and `DecisionsPanelWidget` (line 42, "Nothing waiting") have the same flash: each treats "haven't fetched yet" as "definitively empty". For a new user this is a misleading "you have nothing" flicker on the highest-polish surface.
- **Root cause**: These three widgets fetch async on mount but track no loading flag — they derive emptiness purely from current store length, so pre-fetch and truly-empty look identical (unlike `RecentDecisionsWidget`, which correctly carries `loading`).
- **Impact**: confusion
- **Fix sketch**: Gate the empty branch on a loaded flag. Either read a store-level `personasLoaded`/`credentialsLoaded` boolean, or track a local `hasFetched` set in the effect's `.then`. While unfetched, render a lightweight skeleton (a few `bg-foreground/[0.04] rounded-input animate-pulse` rows sized to the widget) inside the shared card shell instead of the empty illustration.

## 3. Every cockpit widget re-hand-rolls the card shell + header (no shared primitive)
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/home/sub_cockpit/widgets/MetricSparkWidget.tsx:52-55
- **Scenario**: Widgets are supposed to "feel like a set" in the 12-col grid, but each repeats the chrome by hand: `rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0` appears verbatim in MetricSparkWidget:52, IssueListWidget:45, ConnectedServicesWidget:72, and DecisionsPanelWidget:33, and each re-implements its own uppercase caption header + empty state. They drift: PersonaOverviewWidget (line 101) uses `rounded-card border border-foreground/10` but a *different* inner layout; RecentDecisionsWidget (line 65) uses a fuchsia-tinted border and `px-3 py-2` instead of `p-4`. Inconsistent padding, border tint, and empty-state treatment across cells that sit side by side.
- **Root cause**: There is no `CockpitCard` / `WidgetShell` primitive. The shell, header, and empty-slot markup are copy-pasted per widget, so any one widget can quietly diverge and there's no single place to enforce the "set" look.
- **Impact**: inconsistency
- **Fix sketch**: Extract a `WidgetShell({ title, action, isEmpty, emptyIcon, emptyLabel, isLoading, children })` (read-only suggestion) owning the card classes, the uppercase caption header, the centered empty state (icon + caption), and a skeleton for #2. Migrate the four list/metric widgets to it; allow a `tone` prop so RecentDecisions' fuchsia accent stays opt-in rather than ad-hoc.

## 4. Guided Tour panel never receives focus — keyboard nav is unreachable on open
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/onboarding/components/GuidedTour.tsx:371-380
- **Scenario**: The tour panel mounts as a `fixed` `role="region"` with no `tabIndex` and no focus call. The keyboard handler (`handlePanelKeyDown`, line 184) is deliberately scoped to the panel root, so ArrowLeft/Right to step and Escape-to-minimize only work *once focus is already inside the panel*. A keyboard-only user who launches a tour from the Learning center has focus left on the (now-unmounted) modal/launcher and must blindly Tab into the left-rail panel before any documented shortcut responds. Un-minimizing (line 357) has the same gap.
- **Root cause**: No focus management on mount/restore. `role="region"` is a landmark, not a focus target, and nothing moves focus into the panel when it appears.
- **Impact**: inaccessible
- **Fix sketch**: Add `tabIndex={-1}` to the panel root and a `ref` that calls `.focus()` in an effect keyed on `[tourId, currentIndex, isMinimized]` (respect reduced-motion by using `preventScroll`). On minimize, return focus to the minimized pill. This makes the existing arrow/Escape shortcuts work immediately after open.

## 5. Welcome hero is the first screen but has no skip/launch affordance for the tour
- **Severity**: medium
- **Category**: visual-hierarchy
- **File**: src/features/home/sub_welcome/WelcomeLayout.tsx:42-64
- **Scenario**: WelcomeLayout stacks ResumeBanner, the centered HeroHeader greeting, then a deferred "Quick navigation" grid and a "Language" grid. There is no visible entry point to the guided tour or onboarding from the hub itself — discovery lives only in the separate Learning tab and the auto-launched modal. A returning user who dismissed onboarding has no first-class way back in from the surface designed as the "first impression", and the hero's visual weight (large shine headline + 6-tile nav) competes with no clear primary next action.
- **Root cause**: The hub treats navigation tiles as the only CTA tier; the highest-intent first-run action (start/resume a tour) is absent from the hero, so the hierarchy has a strong headline and a flat field of equal-weight cards with no anchor.
- **Impact**: unpolished
- **Fix sketch**: Add a single primary "Take the tour" / "Resume setup" button directly under HeroHeader (reuse the violet tone from `OnboardingActionButton`), wired to `startTour('getting-started')` and hidden once `tourCompletionMap['getting-started']` is true. This gives the hero one clear anchor and surfaces the tour from the first-impression screen.

## 6. Two near-identical card systems on Welcome/Setup drift in radius, ratio, and badge
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/features/home/sub_welcome/NavigationGrid.tsx:50-80
- **Scenario**: NavigationGrid cards and SetupCards items are visually the same idiom (gradient panel, glow blob, big centered icon, bottom title overlay, bottom gradient line, hover-lift) but encode it with diverging constants: NavCard uses `aspect-[4/3]` + `typo-heading-lg` title + an `ArrowRight` corner affordance; SetupCardItem (SetupCards.tsx:506) uses a fixed `h-[140px]` panel + a separate 64px description block + a top-right "completed" pill, and its grid gap is `gap-5` vs the nav grid's `gap-6` (HomeWelcome shows them stacked under sequential SectionDividers). Side by side on the same scroll they read as two slightly-off card languages rather than one.
- **Root cause**: The shared "illustration card with title overlay" pattern was implemented twice with hand-picked sizes and gaps instead of one parameterized component, so the radius/aspect/gap/affordance choices silently diverged.
- **Impact**: inconsistency
- **Fix sketch**: Factor the common visual into an `IllustrationCard` (gradient + glow + centered art + bottom title overlay + gradient line + hover-lift) parameterized by aspect, accent, and an optional top-right slot (arrow vs completed pill). Render both NavGrid and SetupCards through it and align the grid gap so the two sections share one cadence.
