# Home, Onboarding, and Simple Mode

The Home area is the user's entry point. It combines the welcome surface, cockpit, learning, "What's New" roadmap, and a dev-only system check.

## Implemented surfaces

| Surface | Purpose | Implementation |
| --- | --- | --- |
| Welcome | First-run orientation and navigation cards | `src/features/home/components/WelcomeLayout.tsx`, `NavigationGrid.tsx` |
| Cockpit | High-level command/dashboard entry | `src/features/home/components/HomePage.tsx` |
| Learning | Guided learning/onboarding content | `src/features/home` and `src/features/onboarding` |
| What's New | Live roadmap surface | `src/features/home`, backend `src-tauri/src/commands/live_roadmap.rs` |
| System Check | Dev-only environment diagnostics | gated in `sidebarData.ts` |
| Simple Mode | Starter-tier simplified experience | `src/features/simple-mode` |

## Notes for maintainers

- Home tabs are declared in `homeItems` in `sidebarData.ts`.
- Tier visibility uses `TIERS` and `isTierVisible`.
- Simple Mode is still present as a separate feature folder and exports through `src/features/simple-mode/index.ts`.
- Roadmap implementation notes live in [live-roadmap/live-roadmap.md](live-roadmap/live-roadmap.md).

