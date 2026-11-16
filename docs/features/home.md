# Home and Cockpit

Home is the user's entry point. A production build shows two Home tabs, **Cockpit** and **Learning**, and lands on Cockpit (`DEFAULT_HOME_TAB = 'cockpit'`); Cockpit carries setup resumption and the first-run entry, and Learning carries tours and Power Moves. Welcome, What's New and System Check are DEV-only tabs (`devOnly: true`): a production build never shows them, so the Welcome navigation grid and language picker, the release notes and live roadmap, and the diagnostics below exist in DEV builds only.

## Tabs

Home tabs are declared in `homeItems` in `src/features/shared/chrome/sidebar/sidebarData.ts`. Rows marked `devOnly: true` are hidden from the production sidebar, and `isHomeTabAvailable` reads the same flag, so outside DEV `HomePage.tsx` replaces a dev-only (or unknown) persisted tab with `DEFAULT_HOME_TAB`.

| Tab | Ships in | Behavior | Implementation |
| --- | --- | --- | --- |
| Welcome | DEV only (`devOnly: true`) | Home layout for DEV builds: hero header, "since you left" briefing, resume section, first-run get-started section, navigation grid. There is no fleet-wide stats strip; the fleet's active-agent count now rides as a stat chip on the Agents nav card (see Quick-Navigation chips below) and the strip's other two metrics (runs today, success rate) were dropped with no replacement. The hero greeting addresses the user as **"Commander"** (an Athena-themed honorific) with a time-of-day prefix (Good Morning/Afternoon/Evening), not by account name. | `sub_welcome/HomeWelcome.tsx`, `sub_welcome/WelcomeLayout.tsx`, `sub_welcome/HeroHeader.tsx`, `sub_welcome/SinceYouLeftBriefing.tsx`, `sub_welcome/ResumeSection.tsx`, `sub_welcome/GetStartedSection.tsx`, `sub_welcome/NavigationGrid.tsx` |
| Cockpit | Production + DEV; the production landing tab | Companion-driven dynamic UI surface — Athena composes the page contents via `compose_cockpit`. When she never has, a **deterministic "Starter cockpit"** (`sub_cockpit/defaultCockpit.ts`) is composed in TS from real fleet state (personas + metrics summary, no LLM call): an orientation callout, fleet-vitals stat grid, persona-roster hero, and a needs-attention list. Athena's composed spec always takes precedence; the starter only fills the never-composed gap and only when there is fleet state — a zero-persona install still shows the Athena portrait empty state whose "Talk to Athena" button presets and auto-sends a "compose a persona-overview cockpit" request. Above the board the Cockpit also renders the resume banner and the first-run `WelcomeGetStarted` band (see First-run guidance below). See [cockpit.md](companions/athena/cockpit.md). | `sub_cockpit/CockpitPanel.tsx` + `sub_cockpit/defaultCockpit.ts` + widget registry |
| Learning | Production + DEV | Guided tours + Power Moves. Tours render as compact one-row cards (icon, title, step count, completion badge); clicking a card opens a modal with the tour description, its step list, and a Start/Restart button. A vertical timeline with completed/pending nodes runs alongside the tour cards. The right column is the **Power Moves quest board** (replacing the old static tricks + screenshot modals): ~12 advanced features grouped by payoff (Save time / Prevent failures / Level up agents / Orchestrate), each move a single-line row (icon + title + used badge) whose "Try it" launcher deep-links to the real surface (sidebar section + sub-tab, or the Monitor overlay) and flashes a one-shot spotlight ring on the landing anchor. Progress ("N/12 used") persists in localStorage: clicking Try it marks a move *tried*; moves with a `detect()` probe self-complete from real usage data (e.g. "Chain agents" checks off once an `event_listener` trigger exists). | `sub_learning/HomeLearning.tsx`, `sub_learning/TourDetailModal.tsx`, `sub_learning/data.ts`, `sub_learning/powerMoves/{registry,launchPowerMove,flashSpotlight,powerMovesStore}.ts`, `sub_learning/powerMoves/{PowerMovesPanel,PowerMoveRow}.tsx` |
| What's New | DEV only (`devOnly: true`) | Release notes and roadmap | `sub_releases/*` |
| System Check | DEV only (`devOnly: true`) | Dev-only diagnostics entry. `SystemHealthPanel` ships environment checks, a dev-only `CrashLogsSection`, and an always-visible `LogDiskUsageSection` (powered by `get_log_directory_stats`) that reports tracing-log + crash-log directory bytes/file counts and the configured retention caps. | `SystemHealthPanel`; listed in `homeItems` in every build with `devOnly: true`, and mounted by `HomePage.tsx` only under `import.meta.env.DEV` |

### Quick-Navigation live status chips

The Welcome quick-nav cards are no longer illustration-only — each surfaces its module's current state as compact corner chips (number + type-icon + tone, plus a 24h-vs-prior-24h trend arrow where it applies). Driven by `sub_welcome/lib/useNavCardStatus.ts`, rendered by `sub_welcome/NavStatChips.tsx`:

| Card | Chips |
| --- | --- |
| Overview | open incidents · unread messages · pending reviews (non-zero only) |
| Teams | number of teams (this card was added to the grid) |
| Agents | distinct agents active in the last 24h + trend vs prior day (slot 0), plus the enabled/configured fleet size (slot 1) |
| Events | event volume in the last 24h + trend vs prior day |
| Connections | external (3rd-party) connections + built-in/local connectors |
| Templates / Plugins / Settings | none |

Attention counts (messages/reviews) come from the shared attention registry (the Sidebar already polls them). The windowed metrics (incidents, active-persona window, event window) ride the **Overview spine** — `stores/slices/overview/homeSpineSlice.ts` centralizes those fetches behind a per-source TTL + in-flight guard, and Welcome reads store selectors + triggers the shared fetch (`primeHomeSpine`) when cold, so it owns no IPC of its own and repeated mounts share one cached fetch. Credentials come from the single canonical `vaultStore` via `sub_welcome/lib/useVaultCredentials.ts`. The local-vs-3rd-party split for Connections is a coarse display-only label (`sub_welcome/lib/connectorScope.ts`) — the canonical readiness model is the backend `ConnectorClass`.

### "Since you left" briefing

`sub_welcome/SinceYouLeftBriefing.tsx` (compute in `sub_welcome/lib/sinceLeftBriefing.ts`) shows a compact, dismissible debrief at the top of Welcome of what happened while the user was away: runs since the last visit (and how many failed), alerts raised, and approvals waiting. Every line is a one-click jump to the right Overview surface; all deltas are derived from the Overview spine (no new IPC). The "last visit" anchor is a localStorage timestamp advanced on a heartbeat + on unload/hide. It stays quiet when nothing happened or on first run.

### First-screen lifecycle discipline

The live-roadmap hourly poll pauses when What's New isn't the visible Home tab or the window is hidden, and resumes/refreshes on return (`lib/usePausableInterval.ts`). `HomePage.tsx` uses **keep-alive** panes (visited tabs stay mounted, hidden) instead of a per-switch remount, so returning to a tab is instant with no refetch; only ever-visited tabs are mounted.

## Resume and prefetch

`sub_welcome/useResumeContext.ts` detects unfinished work and drives the resume banner/cards. `lib/prefetch.ts` preloads likely next views so the home-to-workflow transition is fast.

## Releases and live roadmap

The "What's New" tab is DEV-only (`devOnly: true`), so none of this section reaches a production build. As of 2026-07-13 the surface is a **single lean view** (`sub_releases/HomeReleases.tsx`, ~200 LOC): the live roadmap (an in-progress hero card + NOW/NEXT/LATER priority lanes) renders on top, with a compact list of the shipped bundled releases below it — everything is visible at once. The prior multi-file surface (a left `ReleaseNavRail`, `sessionStorage` selection persistence in `releaseSelection.ts`, and separate `HomeRoadmapView` / `ReleaseDetailView` components) was collapsed and removed; there is no release-picker rail or per-release selection state anymore.

Roadmap display items are built by the pure `sub_releases/roadmapItems.ts` (`buildDisplayItems`): the live-fetched payload wins, but a schema-valid-yet-content-empty live payload falls back to the bundled roadmap content so a single content-author mistake can't blank the roadmap. `useLiveRoadmap.ts` calls the Rust live-roadmap command (fetch/cache/stale semantics), and `LiveRoadmapStatusPill` surfaces where the content came from. `useReleasesTranslation` remains the display-shape adapter over the flat `releases.whats_new.*` i18n keys.

### "What's New" update dot

When the running app version (`getVersion()`) differs from the version the user last acknowledged (`systemStore.whatsNewSeenVersion`, persisted), a dismissable cyan dot lights on the **Home** (Level 1) and **What's New** (Level 2) sidebar entries — a nudge to check the release notes after an update. A fresh install records a silent baseline (no dot); the dot only appears after a genuine version change. Clicking the dot, or simply opening the "What's New" page, re-acknowledges the current version and clears it. Logic lives in `src/hooks/sidebar/useWhatsNewIndicator.ts`; the L2 dot rides the generic `indicators` prop on `SidebarSubNav`. The dot is DEV-only: the hook sets `enabled = import.meta.env.DEV`, because the What's New tab it points to is `devOnly`, so a production build never shows it.

Implementation contract: [live-roadmap/live-roadmap.md](live-roadmap/live-roadmap.md).

## First-run guidance

In every build resumption lives on the Cockpit: `sub_cockpit/CockpitPanel.tsx` renders `ResumeBanner` (the ranked continue pointer: a failed run, a paused tour or the last edit) above the board. In DEV the Welcome tab carries its own `ResumeSection`. `sub_welcome/SetupCards.tsx` (the old "Role → Tool → Goal" stepper) is unused: nothing imports it. The deeper feature walkthroughs live in the guided tours panel (`TourLauncher` → `GuidedTour`) — see [onboarding.md](onboarding.md) for the tour registry and authoring contract.

For a **fresh profile** (no personas, onboarding not completed), the Cockpit shows a `WelcomeGetStarted` call-to-action band above the board (`sub_welcome/WelcomeGetStarted.tsx`, rendered by `sub_cockpit/CockpitPanel.tsx`) — a primary **"Build your first agent"** button that launches the onboarding overlay (see [onboarding.md](onboarding.md)) and a secondary **"Ask the assistant"** that opens the companion chat. It hides once the user has a persona (and never renders during the initial persona fetch), so returning users don't see it. This is the deliberate cold-start entry point; the overlay is not auto-popped. In DEV the Welcome tab shows the same two actions as a kit section (`sub_welcome/GetStartedSection.tsx`, built on the `useGetStarted` hook that `WelcomeGetStarted.tsx` exports).
