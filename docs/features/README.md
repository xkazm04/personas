# Features

These documents describe the implemented product surface. They are written for users, developers, and automation/CLI agents that need a stable reference.

## Core app

| Area | Docs | Implementation roots |
| --- | --- | --- |
| Home and onboarding | [home.md](home.md), [onboarding.md](onboarding.md) | `src/features/home`, `src/features/onboarding`, `src/features/simple-mode` |
| Overview dashboard | [overview/README.md](overview/README.md) | `src/features/overview` |
| Agents / personas | [personas/README.md](personas/README.md) | `src/features/personas`, `src/features/agents`, `src-tauri/src/commands/core/personas.rs` |
| Templates and adoption | [templates/README.md](templates/README.md) | `src/features/templates`, `scripts/templates`, `src-tauri/src/commands/design` |
| Execution runtime | [execution/README.md](execution/README.md) | `src-tauri/src/commands/execution`, `src-tauri/src/engine` |
| Connections / Vault | [connections/README.md](connections/README.md) | `src/features/vault`, `src-tauri/src/commands/credentials` |
| Events and triggers | [events/README.md](events/README.md) | `src/features/triggers`, `src-tauri/src/commands/communication`, `src-tauri/src/engine` |
| Schedules | [schedules.md](schedules.md) | `src/features/schedules`, `src-tauri/src/engine/scheduler.rs`, `src-tauri/src/engine/cron.rs` |
| Pipeline (Teams Canvas) | [pipeline/README.md](pipeline/README.md) | `src/features/pipeline`, `src-tauri/src/commands/teams` |
| Recipes | [recipes/README.md](recipes/README.md) | `src/features/recipes`, `src-tauri/src/commands/recipes` |
| Deployment (Cloud + unified) | [deployment/README.md](deployment/README.md) | `src/features/deployment`, `src/api/system/cloud.ts`, `src-tauri/src/cloud` |
| Sharing (bundles + P2P) | [sharing/README.md](sharing/README.md) | `src/features/sharing`, `src-tauri/src/commands/network`, `src-tauri/src/engine/p2p` |
| Automation tools | [automation-tools.md](automation-tools.md) | `src-tauri/src/commands/tools` |
| Radio | [radio.md](radio.md) | `src/features/radio`, `src-tauri/src/commands/radio.rs` |
| Settings | [settings/README.md](settings/README.md) | `src/features/settings`, `src/stores/slices/system` |

## Plugins

| Plugin | Docs | Implementation roots |
| --- | --- | --- |
| Artist | [artist.md](artist.md), [artist/](artist/) | `src/features/plugins/artist`, `src-tauri/src/commands/artist` |
| Companion | [companion/README.md](companion/README.md) | `src/features/plugins/companion`, `src-tauri/src/commands/companion` |
| Dev Tools | [dev-tools.md](dev-tools.md) | `src/features/plugins/dev-tools`, `src-tauri/src/commands/infrastructure/dev_tools.rs` |
| Drive | [drive/README.md](drive/README.md) | `src/features/plugins/drive`, `src-tauri/src/commands/drive.rs` |
| GitLab | [gitlab.md](gitlab.md) | `src/features/plugins/gitlab`, `src-tauri/src/commands/infrastructure/gitlab.rs`, `src-tauri/src/gitlab` |
| Langfuse | [langfuse.md](langfuse.md) | `src/features/plugins/langfuse`, `src-tauri/src/commands/infrastructure/langfuse.rs`, `src-tauri/src/langfuse` |
| Obsidian Brain | [brain/README.md](brain/README.md) | `src/features/plugins/obsidian-brain`, `src-tauri/src/commands/obsidian_brain` |
| Research Lab | [research-lab.md](research-lab.md) | `src/features/plugins/research-lab`, `src-tauri/src/commands/infrastructure/research_lab.rs` |
| Twin | [twin.md](twin.md) | `src/features/plugins/twin`, `src-tauri/src/commands/infrastructure/twin.rs` |

## Maintenance notes

- Feature docs should name the UI entry point, primary user flows, backend command surface, data/storage model, and known limitations.
- Long future-looking sections belong in `docs/concepts`, not in feature docs. Keep only a short "Known gaps" section here.
- If a feature is hidden behind a tier or dev flag, state that explicitly.
- Use [../architecture/codebase-map.md](../architecture/codebase-map.md) when deciding where a newly discovered mechanism belongs.
