# Architecture Overview

Personas Desktop is a local-first Tauri 2 application. The frontend is React/Vite/TypeScript; the backend is Rust with SQLite-backed repositories, Tauri IPC commands, background workers, and optional desktop/network/ML feature gates.

## Runtime layers

| Layer | Responsibility | Main roots |
| --- | --- | --- |
| Shell | Tauri window, plugins, notifications, deep links, IPC auth | `src-tauri/src/lib.rs`, `src-tauri/src/ipc_auth.rs` |
| Frontend | Navigation, feature screens, optimistic state, i18n | `src/features`, `src/stores`, `src/i18n` |
| IPC APIs | Typed frontend wrappers over Tauri commands | `src/api`, `src/lib/tauriInvoke` |
| Commands | Backend boundary for user actions | `src-tauri/src/commands` |
| Engine | Execution, scheduling, prompt assembly, event bus, workflows | `src-tauri/src/engine` |
| Data | SQLite models, repositories, migrations | `src-tauri/src/db`, `supabase` |
| Assets and catalogs | Templates, connector icons, generated assets | `scripts/templates`, `public` |

## Product navigation

The sidebar is defined in `src/features/shared/components/layout/sidebar/sidebarData.ts`. Current top-level sections are Home, Overview, Agents, Events, Connections, Templates, Plugins, and Settings. Some entries are tier-gated through `src/lib/constants/uiModes`.

Plugins are enabled from `src/features/plugins/PluginBrowsePage.tsx` and currently include Artist, Dev Tools, Obsidian Brain, Research Lab, Drive, Twin, and Companion.

## Backend command map

Backend modules are grouped by domain under `src-tauri/src/commands`:

- `core`: personas, groups, memories, use cases, import/export.
- `execution`: execution lifecycle, schedules, lab/evaluation, knowledge, incidents.
- `design`: templates, design reviews, build sessions, n8n import.
- `credentials`: Vault, connectors, resources, API proxy, OAuth, discovery.
- `communication`: events, messages, observability, shared events, SLA.
- `infrastructure`: auth, settings, Dev Tools, Research Lab, Twin, cloud, setup.
- `artist`, `obsidian_brain`, `drive`, `companion`, `recipes`, `network`: plugin and system-specific command surfaces.

The invoke handler is registered in `src-tauri/src/lib.rs`. When adding a command, update the Rust module, the invoke handler, and the frontend API wrapper together.

## State and persistence

Frontend persistent UI state is in Zustand slices under `src/stores/slices/system` and composed in `src/stores/systemStore.ts`. Backend durable state is SQLite through Rust repositories. Feature docs should name the exact store slice and command/repo entry points they depend on.

## Source-of-truth docs

Current behavior belongs in [../features](../features/README.md). Cross-feature contracts belong in this folder. Future-only plans belong in [../concepts](../concepts/README.md).

