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

Implementation contract: [live-roadmap/live-roadmap.md](live-roadmap/live-roadmap.md).

## Activation Quest

A persistent bottom-right pill (`OnboardingQuestPill`) tracks 7 first-run milestones and is rendered globally so it remains visible while the user navigates away from Home. It is owned by the onboarding feature — see [onboarding.md](onboarding.md) for the milestone list, store, and event listeners.
