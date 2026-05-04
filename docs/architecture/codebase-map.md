# Codebase Map

This map is generated from the implemented folder and command layout. Use it to decide where feature docs should live and which mechanisms a feature page must explain.

## Application shell

| Mechanism | Evidence | Documentation target |
| --- | --- | --- |
| Sidebar sections and sub-navigation | `src/features/shared/components/layout/sidebar/sidebarData.ts` | [features/README.md](../features/README.md) |
| Tier/dev-only visibility | `TIERS`, `isTierVisible`, `devOnly` flags in sidebar data | [features/settings/README.md](../features/settings/README.md), feature pages |
| Lazy page loading | Page hosts use React `lazy()` and `Suspense` | Feature-specific docs |
| IPC wrapper | `src/lib/tauriInvoke.ts`; API wrappers under `src/api/**` | [architecture/overview.md](overview.md) |
| Rust invoke handler | `src-tauri/src/lib.rs` | [architecture/overview.md](overview.md) |

## Feature roots

| Product area | Frontend root | Backend/API roots |
| --- | --- | --- |
| Home, releases, live roadmap | `src/features/home` | `src/api/liveRoadmap.ts`, `src-tauri/src/commands/live_roadmap.rs` |
| Onboarding and tour | `src/features/onboarding` | `onboardingSlice.ts`, `tourSlice.ts` |
| Overview dashboards | `src/features/overview` | `src-tauri/src/commands/communication`, `execution`, `notifications` |
| Agents/personas | `src/features/personas`, `src/features/agents` | `src/api/agents/**`, `src-tauri/src/commands/core/personas.rs` |
| Templates/adoption | `src/features/templates`, `scripts/templates` | `src-tauri/src/commands/design` |
| Execution runtime | `src/features/execution`, `src/features/pipeline`, `src/features/schedules` | `src-tauri/src/commands/execution`, `src-tauri/src/engine` |
| Connections/Vault | `src/features/vault` | `src/api/auth/**`, `src-tauri/src/commands/credentials` |
| Events/triggers | `src/features/triggers` | `src/api/pipeline/triggers`, `src/api/events`, `src-tauri/src/commands/communication`, `execution/scheduler.rs` |
| Recipes | `src/features/recipes` | `src/api/recipes/recipes.ts`, `src-tauri/src/commands/recipes` |
| Settings | `src/features/settings`, `src/features/sharing` | `src/api/system`, `src-tauri/src/commands/infrastructure`, `network` |
| Artist plugin | `src/features/plugins/artist` | `src/api/artist`, `src-tauri/src/commands/artist` |
| Companion plugin | `src/features/plugins/companion` | `src/api/companion.ts`, `src-tauri/src/commands/companion`, `src-tauri/src/companion` |
| Dev Tools plugin | `src/features/plugins/dev-tools` | `src/api/devTools/devTools.ts`, `src-tauri/src/commands/infrastructure/dev_tools.rs` |
| Drive plugin | `src/features/plugins/drive` | `src/api/drive.ts`, `src-tauri/src/commands/drive.rs`, `src/api/signing`, `src/api/ocr` |
| Obsidian Brain plugin | `src/features/plugins/obsidian-brain` | `src/api/obsidianBrain`, `src-tauri/src/commands/obsidian_brain` |
| Research Lab plugin | `src/features/plugins/research-lab` | `src/api/researchLab`, `src-tauri/src/commands/infrastructure/research_lab.rs` |
| Twin plugin | `src/features/plugins/twin` | `src-tauri/src/commands/infrastructure/twin.rs` |

## Store slices

System-level persisted or cross-page state lives in `src/stores/slices/system`. Current slices include ambient context, artist, cloud, companion plugin, deployment target, Dev Tools projects/context/scanner/tasks/triage, GitLab, Obsidian Brain, onboarding, Research Lab, setup, simple mode, tour, Twin, and global UI.

Feature docs should identify both the local React state and the persistent store slice when a UI survives navigation or app restart.

## Documentation expectation

Every feature page should cover:

- UI entry points and tier/dev gating.
- Main user flows.
- State ownership.
- IPC/backend command surface.
- Storage model or filesystem boundary.
- Event/notification side effects.
- Security, timeout, and validation constraints.
- Known gaps if the implementation is partial.

