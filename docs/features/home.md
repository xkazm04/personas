# Home and Simple Mode

Home is the user's entry point. It combines setup resumption, language switching, learning, release/roadmap content, and primary navigation into the rest of the app.

## Tabs

Home tabs are declared in `homeItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`.

| Tab | Behavior | Implementation |
| --- | --- | --- |
| Welcome | First-run/home layout, hero header, setup cards, resume banner, fleet health strip, navigation grid | `HomeWelcome.tsx`, `WelcomeLayout.tsx`, `HeroHeader.tsx`, `SetupCards.tsx`, `ResumeBanner.tsx`, `NavigationGrid.tsx` |
| Cockpit | Operational home/cockpit view | `HomePage.tsx` |
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

## Simple Mode

Simple Mode is a separate starter-tier experience under `src/features/simple-mode`. It has a shell (`SimpleHomeShell.tsx`), variant views (`components/variants`), and system state in `simpleModeSlice.ts`. Tier visibility is controlled by `TIERS` and `isTierVisible`.

### Ambient mode

A fullscreen, always-on display variant of Simple Mode designed for second monitors and kitchen-tablet-style ambient surfaces. Triggered from the Maximize button in `SimpleHomeShell` (sets `simpleModeSlice.ambientMode = true` and best-effort maximizes the Tauri window) or by booting with a `#ambient` URL hash. The overlay is rendered globally by `AmbientCockpit.tsx` mounted at App root, and auto-rotates between Mosaic (when no critical/warning items in `useUnifiedInbox`) and Inbox (when items need attention). Auto-rotation pauses for 30s after any pointer/keyboard interaction. Esc or the X button exits.
