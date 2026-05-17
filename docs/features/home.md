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

## Activation Quest

A persistent bottom-right pill (`OnboardingQuestPill`) tracks 7 first-run milestones and is rendered globally so it remains visible while the user navigates away from Home. It is owned by the onboarding feature — see [onboarding.md](onboarding.md) for the milestone list, store, and event listeners.

Above the hero on the Welcome tab, `NextStepCoachCard` (in `src/features/home/components/`) promotes the same quest into a first-class "Next step" coach card. While the onboarding wizard is open it stays hidden; once the wizard closes, it reads `useOnboardingQuestStore` and renders the next unfinished milestone in `QUEST_MILESTONE_IDS` order with a primary CTA that deep-links into the relevant surface (e.g. Save memory → Overview > Knowledge, Schedule trigger → Agents > Design > Triggers, Try a recipe → Templates > Recipes, Share a deployment → Agents > Cloud). The card auto-advances as `completeMilestone` fires from the existing CDC and event listeners; once all 7 are done or the user dismisses the quest it disappears.
