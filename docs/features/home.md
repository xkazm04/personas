# Home and Cockpit

Home is the user's entry point. It combines setup resumption, language switching, learning, release/roadmap content, and primary navigation into the rest of the app.

## Tabs

Home tabs are declared in `homeItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`.

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Welcome | First-run/home layout, hero header, setup cards, "since you left" briefing, resume banner, fleet health strip, navigation grid. The hero greeting addresses the user as **"Commander"** (an Athena-themed honorific) with a time-of-day prefix (Good Morning/Afternoon/Evening), not by account name. | `sub_welcome/HomeWelcome.tsx`, `sub_welcome/WelcomeLayout.tsx`, `sub_welcome/HeroHeader.tsx`, `sub_welcome/SetupCards.tsx`, `sub_welcome/SinceYouLeftBriefing.tsx`, `sub_welcome/ResumeBanner.tsx`, `sub_welcome/NavigationGrid.tsx` |
| Cockpit | Companion-driven dynamic UI surface — Athena composes the page contents via `compose_cockpit`. The empty state shows the Athena portrait as an atmospheric background; its "Talk to Athena" button presets and auto-sends a "compose a persona-overview cockpit" request. See [cockpit.md](cockpit.md). | `sub_cockpit/CockpitPanel.tsx` + widget registry |
| Learning | Guided tours + Power Moves. Tours render as compact one-row cards (icon, title, step count, completion badge); clicking a card opens a modal with the tour description, its step list, and a Start/Restart button. A vertical timeline with completed/pending nodes runs alongside the tour cards. The right column is the **Power Moves quest board** (replacing the old static tricks + screenshot modals): ~12 advanced features grouped by payoff (Save time / Prevent failures / Level up agents / Orchestrate), each move a single-line row (icon + title + used badge) whose "Try it" launcher deep-links to the real surface (sidebar section + sub-tab, or the Monitor overlay) and flashes a one-shot spotlight ring on the landing anchor. Progress ("N/12 used") persists in localStorage: clicking Try it marks a move *tried*; moves with a `detect()` probe self-complete from real usage data (e.g. "Chain agents" checks off once an `event_listener` trigger exists). | `sub_learning/HomeLearning.tsx`, `sub_learning/TourDetailModal.tsx`, `sub_learning/data.ts`, `sub_learning/powerMoves/{registry,launchPowerMove,flashSpotlight,powerMovesStore}.ts`, `sub_learning/powerMoves/{PowerMovesPanel,PowerMoveRow}.tsx` |
| What's New | Release notes and roadmap | `sub_releases/*` |
| System Check | Dev-only diagnostics entry. `SystemHealthPanel` ships environment checks, a dev-only `CrashLogsSection`, and an always-visible `LogDiskUsageSection` (powered by `get_log_directory_stats`) that reports tracing-log + crash-log directory bytes/file counts and the configured retention caps. | added to `homeItems` only in `import.meta.env.DEV` |

### Quick-Navigation live status chips

The Welcome quick-nav cards are no longer illustration-only — each surfaces its module's current state as compact corner chips (number + type-icon + tone, plus a 24h-vs-prior-24h trend arrow where it applies). Driven by `sub_welcome/lib/useNavCardStatus.ts`, rendered by `sub_welcome/NavStatChips.tsx`:

| Card | Chips |
| --- | --- |
| Overview | open incidents · unread messages · pending reviews (non-zero only) |
| Teams | number of teams (this card was added to the grid) |
| Agents | distinct agents active in the last 24h + trend vs prior day |
| Events | event volume in the last 24h + trend vs prior day |
| Connections | external (3rd-party) connections + built-in/local connectors |
| Templates / Plugins / Settings | none |

Attention counts (messages/reviews) come from the shared attention registry (the Sidebar already polls them). The windowed metrics (incidents, active-persona window, event window) and the fleet-health strip's metrics ride the **Overview spine** — `stores/slices/overview/homeSpineSlice.ts` centralizes those fetches behind a per-source TTL + in-flight guard, and Welcome reads store selectors + triggers the shared fetch (`primeHomeSpine`) when cold, so it owns no IPC of its own and repeated mounts share one cached fetch. Credentials come from the single canonical `vaultStore` via `sub_welcome/lib/useVaultCredentials.ts` (used by both the nav chip and the fleet strip). The local-vs-3rd-party split for Connections is a coarse display-only label (`sub_welcome/lib/connectorScope.ts`) — the canonical readiness model is the backend `ConnectorClass`.

### "Since you left" briefing

`sub_welcome/SinceYouLeftBriefing.tsx` (compute in `sub_welcome/lib/sinceLeftBriefing.ts`) shows a compact, dismissible debrief at the top of Welcome of what happened while the user was away: runs since the last visit (and how many failed), alerts raised, and approvals waiting. Every line is a one-click jump to the right Overview surface; all deltas are derived from the Overview spine (no new IPC). The "last visit" anchor is a localStorage timestamp advanced on a heartbeat + on unload/hide. It stays quiet when nothing happened or on first run.

### First-screen lifecycle discipline

The fleet-health strip's 30s metrics poll and the live-roadmap hourly poll pause when Welcome/Roadmap isn't the visible Home tab or the window is hidden, and resume/refresh on return (`lib/usePausableInterval.ts`). `HomePage.tsx` uses **keep-alive** panes (visited tabs stay mounted, hidden) instead of a per-switch remount, so returning to Welcome is instant with no refetch; only ever-visited tabs are mounted. The fleet strip renders a shaped skeleton while its first snapshot loads.

## Resume and prefetch

`sub_welcome/useResumeContext.ts` detects unfinished work and drives the resume banner/cards. `lib/prefetch.ts` preloads likely next views so the home-to-workflow transition is fast.

## Releases and live roadmap

`HomeReleases.tsx` and `HomeRoadmapView.tsx` render bundled releases plus the live roadmap. `useLiveRoadmap.ts` calls the Rust live-roadmap command, falls back to bundled data, and surfaces status through `LiveRoadmapStatusPill`.

### Release picker is a left rail inside the content

As of 2026-06-09 the release picker lives in the content area as a left rail (`sub_releases/ReleaseNavRail.tsx`), beside the release/roadmap content it scopes. This replaced the sidebar **Level 3 push pane** (2026-05-17 → 2026-06-09), which in turn had replaced the in-page `ReleasesNavBar` pill row. The Home **Level 2** list now stays visible the whole time — clicking "What's New" just selects the tab; it no longer pushes a pane over the sidebar.

The rail lists each release plus the roadmap entry. The selected version is held in `systemStore.homeReleaseVersion` and persisted to `sessionStorage` (`home-releases-selected-version`) via `sub_releases/releaseSelection.ts`. `HomeReleases.tsx` lays out the rail beside a `ContentBody` and renders whichever release is selected (`HomeRoadmapView` for the roadmap entry, `ReleaseDetailView` for a shipped release).

### "What's New" update dot

When the running app version (`getVersion()`) differs from the version the user last acknowledged (`systemStore.whatsNewSeenVersion`, persisted), a dismissable cyan dot lights on the **Home** (Level 1) and **Roadmap** (Level 2) sidebar entries — a nudge to check the release notes after an update. A fresh install records a silent baseline (no dot); the dot only appears after a genuine version change. Clicking the dot, or simply opening the "What's New" page, re-acknowledges the current version and clears it. Logic lives in `src/hooks/sidebar/useWhatsNewIndicator.ts`; the L2 dot rides the generic `indicators` prop on `SidebarSubNav`.

Implementation contract: [live-roadmap/live-roadmap.md](live-roadmap/live-roadmap.md).

## First-run guidance

Welcome surfaces a `ResumeBanner` for unfinished work plus the `SetupCards` "Role → Tool → Goal" stepper. The deeper feature walkthroughs live in the guided tours panel (`TourLauncher` → `GuidedTour`) — see [onboarding.md](onboarding.md) for the tour registry and authoring contract.

For a **fresh profile** (no personas, onboarding not completed), the hero shows a `WelcomeGetStarted` call-to-action band (`sub_welcome/WelcomeGetStarted.tsx`) — a primary **"Build your first agent"** button that launches the onboarding overlay (see [onboarding.md](onboarding.md)) and a secondary **"Ask the assistant"** that opens the companion chat. It hides once the user has a persona (and never renders during the initial persona fetch), so returning users don't see it. This is the deliberate cold-start entry point; the overlay is not auto-popped.
