# Home and Cockpit

Home is the user's entry point. It combines setup resumption, language switching, learning, release/roadmap content, and primary navigation into the rest of the app.

## Tabs

Home tabs are declared in `homeItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`.

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Welcome | First-run/home layout, hero header, setup cards, resume banner, fleet health strip, navigation grid | `HomeWelcome.tsx`, `WelcomeLayout.tsx`, `HeroHeader.tsx`, `SetupCards.tsx`, `ResumeBanner.tsx`, `NavigationGrid.tsx` |
| Cockpit | Companion-driven dynamic UI surface — Athena composes the page contents via `compose_cockpit`. See [cockpit.md](cockpit.md). | `home/components/cockpit/CockpitPanel.tsx` + widget registry |
| Learning | Learning resources and guided education | `HomeLearning.tsx` |
| What's New | Release notes and roadmap | `components/releases/*` |
| System Check | Dev-only diagnostics entry. `SystemHealthPanel` ships environment checks, a dev-only `CrashLogsSection`, and an always-visible `LogDiskUsageSection` (powered by `get_log_directory_stats`) that reports tracing-log + crash-log directory bytes/file counts and the configured retention caps. | added to `homeItems` only in `import.meta.env.DEV` |

## Resume and prefetch

`useResumeContext.ts` detects unfinished work and drives the resume banner/cards. `lib/prefetch.ts` preloads likely next views so the home-to-workflow transition is fast.

## Releases and live roadmap

`HomeReleases.tsx` and `HomeRoadmapView.tsx` render bundled releases plus the live roadmap. `useLiveRoadmap.ts` calls the Rust live-roadmap command, falls back to bundled data, and surfaces status through `LiveRoadmapStatusPill`.

### Release picker lives in the sidebar Level 3 push pane

As of 2026-05-17 the in-page `ReleasesNavBar` (top-of-page pill row) was retired. Clicking "What's New" in the Home sidebar (Level 2) now slides the sidebar into a Level 3 panel listing each release plus the roadmap entry — see `src/features/shared/components/layout/sidebar/SidebarLevel3.tsx` (the generic primitive) and the `HomeRoadmapL3` sub-component in `SidebarLevel2.tsx`. The selected version is held in `systemStore.homeReleaseVersion` and persisted to `sessionStorage` (`home-releases-selected-version`); `HomeReleases.tsx` reads from the store and is purely a renderer for whichever release the sidebar has selected. The back-arrow header returns to the Home L2 list.

Implementation contract: [live-roadmap/live-roadmap.md](live-roadmap/live-roadmap.md).

## First-run guidance

Welcome surfaces a `ResumeBanner` for unfinished work plus the `SetupCards` "Role → Tool → Goal" stepper. The deeper feature walkthroughs live in the guided tours panel (`TourLauncher` → `GuidedTour`) — see [onboarding.md](onboarding.md) for the tour registry and authoring contract.
