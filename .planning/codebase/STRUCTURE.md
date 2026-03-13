# Codebase Structure

**Analysis Date:** 2026-03-13

## Directory Layout

```
personas/
├── src/                                # Frontend React/TypeScript
│   ├── api/                           # IPC command wrappers
│   │   ├── agents/                    # Persona, execution, test, tool APIs
│   │   ├── vault/                     # Credential, database, automation APIs
│   │   ├── pipeline/                  # Team, group, recipe, trigger APIs
│   │   ├── templates/                 # Template adoption, design APIs
│   │   ├── overview/                  # Event, message, memory, observability APIs
│   │   ├── system/                    # Cloud, GitLab, desktop bridge APIs
│   │   └── devTools/                  # Internal dev tools APIs
│   ├── features/                      # Domain-specific UI modules
│   │   ├── agents/                    # Persona management, chat, execution, design
│   │   ├── vault/                     # Credential management, database explorer
│   │   ├── templates/                 # Template gallery, adoption flow
│   │   ├── pipeline/                  # Teams, recipes, team memory
│   │   ├── overview/                  # Dashboard, analytics, events, memories
│   │   ├── triggers/                  # Trigger configuration UI
│   │   ├── deployment/                # Cloud deployment management
│   │   ├── shared/                    # Reusable components (buttons, forms, layouts)
│   │   └── [other modules]/           # Home, settings, GitLab, etc.
│   ├── stores/                        # Zustand state management
│   │   ├── agentStore.ts              # Personas, tools, executions, tests, lab
│   │   ├── overviewStore.ts           # Events, messages, memories, executions
│   │   ├── vaultStore.ts              # Credentials, databases, automations
│   │   ├── pipelineStore.ts           # Teams, recipes, triggers
│   │   ├── systemStore.ts             # UI, onboarding, cloud config
│   │   ├── authStore.ts               # User, auth state
│   │   ├── slices/                    # Slice definitions by domain
│   │   └── selectors/                 # Reusable state selectors
│   ├── hooks/                         # Custom React hooks
│   │   ├── execution/                 # usePersonaExecution, useAiHealingStream
│   │   ├── design/                    # useCredentialDesign, useOAuthPolling
│   │   ├── overview/                  # useExecutionDashboardPipeline
│   │   ├── lab/                       # useLabEvents
│   │   └── utility/                   # usePolling, useDevMode, etc.
│   ├── lib/                           # Utilities and shared logic
│   │   ├── bindings/                  # Auto-generated Rust type definitions
│   │   ├── tauriInvoke.ts             # Timeout wrapper around Tauri invoke
│   │   ├── eventBridge.ts             # Event listener registry
│   │   ├── commandNames.generated.ts  # Auto-generated command list
│   │   ├── execution/                 # Execution utilities, pipeline middleware
│   │   ├── design/                    # Design state sync helpers
│   │   ├── validation/                # Schema validators for event payloads
│   │   ├── sentry.ts                  # Error tracking setup
│   │   ├── analytics.ts               # Feature usage tracking
│   │   ├── models/                    # modelCatalog.ts (LLM provider definitions)
│   │   ├── types/                     # Shared TypeScript interfaces
│   │   └── utils/                     # Helper functions
│   ├── styles/                        # Global CSS
│   ├── assets/                        # SVG illustrations
│   ├── i18n/                          # Internationalization strings
│   └── App.tsx, main.tsx              # Entry points
│
├── src-tauri/                         # Rust backend (Tauri + engine)
│   ├── src/
│   │   ├── main.rs                    # Tauri app entry, Sentry setup
│   │   ├── lib.rs                     # App state, shared HTTP client, process registry
│   │   ├── commands/                  # Tauri command handlers
│   │   │   ├── core/                  # Personas, chat, memories, groups
│   │   │   ├── credentials/           # Credential CRUD, design, recipes, auto-discovery
│   │   │   ├── execution/             # Execution triggers, chat, runner status
│   │   │   ├── communication/         # Events, messages, observability
│   │   │   ├── tools/                 # Tool registration, invocation
│   │   │   └── [other domains]/
│   │   ├── db/                        # Database layer
│   │   │   ├── mod.rs                 # Pool init, migrations runner
│   │   │   ├── migrations.rs          # Schema definitions, version tracking
│   │   │   ├── models/                # Data model structs (Persona, Credential, etc.)
│   │   │   └── repos/                 # Repository functions by domain
│   │   ├── engine/                    # Execution and integration engine
│   │   │   ├── runner.rs              # Main execution loop
│   │   │   ├── queue.rs               # Execution queue, priority, concurrency
│   │   │   ├── tool_runner.rs         # Tool invocation orchestration
│   │   │   ├── automation_runner.rs   # Automation execution
│   │   │   ├── chain.rs               # Chain of thought execution
│   │   │   ├── connector_strategy.rs  # Service-specific connectors
│   │   │   ├── credential_design.rs   # Interactive credential flow
│   │   │   ├── credential_negotiator.rs
│   │   │   ├── db_query.rs            # DuckDB integration, query execution
│   │   │   ├── design.rs              # Persona design conversation
│   │   │   ├── healing.rs             # Error analysis and recovery
│   │   │   ├── ai_healing.rs          # AI-assisted error recovery
│   │   │   ├── healthcheck.rs         # Connectivity checks
│   │   │   ├── api_proxy.rs           # HTTP request interception
│   │   │   ├── api_definition.rs      # OpenAPI/API spec handling
│   │   │   ├── mcp_tools.rs           # Model Context Protocol tool support
│   │   │   ├── scheduler.rs           # Cron scheduling
│   │   │   ├── subscription.rs        # Event subscription management
│   │   │   ├── knowledge.rs           # Knowledge base integration
│   │   │   ├── kb_ingest.rs           # Vector knowledge ingestion
│   │   │   ├── vector_store.rs        # Embedding storage
│   │   │   ├── automation_runner.rs
│   │   │   ├── desktop_bridges.rs     # Desktop app integration
│   │   │   ├── app_focus.rs           # App focus trigger
│   │   │   ├── platforms/             # Platform-specific integrations
│   │   │   │   ├── github.rs
│   │   │   │   ├── gitlab.rs
│   │   │   │   └── n8n.rs
│   │   │   └── [other modules]/
│   │   ├── background_job.rs          # Background scheduler and monitors
│   │   ├── ipc_auth.rs                # IPC authentication checks
│   │   ├── notifications.rs           # Desktop notifications
│   │   └── utils/                     # Utility functions
│   ├── bindings/                      # Generated type bindings (serde_json, etc.)
│   └── Cargo.toml                     # Rust dependencies
│
├── .planning/codebase/                # GSD codebase analysis docs (this dir)
│   ├── ARCHITECTURE.md
│   ├── STRUCTURE.md
│   ├── STACK.md
│   ├── INTEGRATIONS.md
│   ├── CONVENTIONS.md
│   ├── TESTING.md
│   └── CONCERNS.md
├── scripts/                           # Build and template generation scripts
├── public/                            # Static assets (icons, illustrations)
├── docs/                              # Project documentation
└── package.json, Cargo.toml, etc.    # Configuration files
```

## Directory Purposes

**`src/api/`:**
- Purpose: Provide typed wrappers around Tauri IPC commands
- Contains: Functions that invoke backend commands and return promises
- Key files: `agents/personas.ts`, `vault/credentials.ts`, `overview/events.ts`
- Pattern: Each file groups related commands by domain; exports const functions

**`src/features/`:**
- Purpose: Domain-specific UI modules with components, hooks, utilities
- Contains: React components, hooks, helper functions organized by feature
- Pattern: Each feature has `components/` directory and optional `libs/` for hooks
- Examples: `features/agents/` contains persona creation, execution UI, design flow

**`src/stores/`:**
- Purpose: Centralized application state via Zustand
- Contains: Domain stores (`agentStore`, `overviewStore`, `vaultStore`) and slices
- Pattern: Store composed from multiple slices; slices export StateCreator functions
- Persistence: Selected state persisted to localStorage via Zustand persist middleware

**`src/hooks/`:**
- Purpose: Reusable custom React hooks for domain logic
- Contains: Hooks organized by concern (execution, design, overview, utility)
- Pattern: Export single hook per file; hooks use API module and Zustand stores
- Examples: `usePersonaExecution` orchestrates execution state; `usePolling` handles intervals

**`src/lib/bindings/`:**
- Purpose: Auto-generated TypeScript type definitions from Rust
- Contains: Type interfaces matching Rust structs (exported via ts-rs)
- Generation: Automatic via build process; do not edit manually
- Used by: API module and components for type safety

**`src/lib/execution/`:**
- Purpose: Execution-specific utilities and middleware
- Contains: `executionSink.ts` (stream parsing), `knowledgeMiddleware.ts`, pipeline tracing
- Pattern: Supports real-time output streaming and error handling

**`src/lib/validation/`:**
- Purpose: Schema validation for Tauri event payloads
- Contains: Zod schemas for execution status, credential events, etc.
- Pattern: Prevents corrupt data from propagating to stores

**`src-tauri/src/commands/`:**
- Purpose: Tauri command handlers that receive frontend requests
- Contains: Subdirectories by domain (core, credentials, execution, etc.)
- Pattern: Each command decorated with `#[tauri::command]`, includes auth check
- Auth: `require_auth_sync()` enforces user is logged in

**`src-tauri/src/db/models/`:**
- Purpose: Data structure definitions with serde for JSON serialization
- Contains: Structs for Persona, Credential, Execution, etc.
- Pattern: Models export to TypeScript via ts-rs; used by repositories
- Serialization: Includes `#[serde(rename_all = "camelCase")]` for JS conventions

**`src-tauri/src/db/repos/`:**
- Purpose: Database access layer using repository pattern
- Contains: Functions for CRUD operations, organized by domain
- Pattern: Accepts `&DbPool`, uses rusqlite for SQL, returns `Result<T, AppError>`
- Examples: `repos/core/personas.rs`, `repos/resources/credentials.rs`

**`src-tauri/src/engine/`:**
- Purpose: Core business logic for persona execution and integrations
- Contains: 50+ modules covering execution, tools, credentials, design, healing, etc.
- Pattern: Modules are services/strategies; used by commands and background jobs
- Key flows: `runner.rs` orchestrates; `tool_runner.rs` invokes tools; `healing.rs` recovers errors

**`src-tauri/src/engine/platforms/`:**
- Purpose: Service-specific integrations
- Contains: GitHub, GitLab, n8n, Deploy connector implementations
- Pattern: Each implements platform-specific API calls for deployment/integration

## Key File Locations

**Entry Points:**
- `src/main.tsx`: React root, Sentry/analytics init
- `src/App.tsx`: Zustand hydration, middleware setup, event bridge init
- `src-tauri/src/main.rs`: Tauri app startup, error handler setup
- `src-tauri/src/lib.rs`: Database pool, command registration, app state

**Configuration:**
- `src-tauri/Cargo.toml`: Rust dependencies and features
- `package.json`: Node dependencies, build scripts
- `vite.config.ts`: Frontend build config
- `src-tauri/tauri.conf.json`: Tauri app config

**Core Logic:**
- `src-tauri/src/engine/runner.rs`: Main execution orchestration
- `src-tauri/src/engine/tool_runner.rs`: Tool invocation
- `src-tauri/src/engine/automation_runner.rs`: Automation execution
- `src-tauri/src/engine/queue.rs`: Execution queuing and concurrency

**Credentials & Auth:**
- `src-tauri/src/engine/credential_design.rs`: Interactive credential flow
- `src-tauri/src/engine/credential_negotiator.rs`: OAuth/form filling
- `src-tauri/src/ipc_auth.rs`: IPC authentication guards
- `src/api/vault/credentials.ts`: Frontend credential API

**State & Events:**
- `src/lib/eventBridge.ts`: Event listener registry
- `src/stores/agentStore.ts`: Personas and executions state
- `src-tauri/src/engine/bus.rs`: Internal event publishing
- `src/hooks/execution/usePersonaExecution.ts`: Execution state handling

**Testing:**
- `src/stores/__tests__/`: Store unit tests
- `src/test/`: Test helpers and fixtures
- `src-tauri/src/engine/test_runner.rs`: Test execution logic

## Naming Conventions

**Files:**
- Components: PascalCase, `.tsx` extension (e.g., `ChatCreator.tsx`)
- Hooks: camelCase with `use` prefix, `.ts` extension (e.g., `usePersonaExecution.ts`)
- Stores/slices: camelCase ending in `Store` or `Slice`, `.ts` extension
- Utilities: camelCase, `.ts` extension (e.g., `parseJson.ts`)
- API modules: camelCase matching domain, `.ts` extension (e.g., `personas.ts`)

**Directories:**
- Feature domains: kebab-case (e.g., `sub_design`, `sub_connectors`, `sub_lab`)
- API domains: lowercase plural (e.g., `agents`, `vault`, `overview`)
- Rust modules: snake_case (e.g., `tool_runner.rs`, `credential_design.rs`)

**Component Props:**
- Event handlers: `on[Event]` (e.g., `onClick`, `onChange`)
- State setters: `set[Name]` (e.g., `setIsOpen`)
- Boolean flags: `is[State]` (e.g., `isLoading`, `isOpen`)

**API Functions:**
- List: `list[Resource]` or `get[Resource]s` (e.g., `listPersonas`)
- Get one: `get[Resource]` (e.g., `getPersona`)
- Create: `create[Resource]` (e.g., `createPersona`)
- Update: `update[Resource]` (e.g., `updatePersona`)
- Delete: `delete[Resource]` (e.g., `deletePersona`)

## Where to Add New Code

**New Feature (Agent/Template/Trigger):**
- Components: `src/features/agents/components/`
- Hooks: `src/features/agents/[sub_feature]/` or `src/hooks/[domain]/`
- Store updates: Add slice to `src/stores/slices/agents/`
- API wrappers: `src/api/agents/`
- Tauri commands: `src-tauri/src/commands/core/`
- Database: `src-tauri/src/db/models/` and `src-tauri/src/db/repos/core/`
- Engine logic: `src-tauri/src/engine/`

**New Component/Module:**
- Shared components: `src/features/shared/components/`
- Feature-specific: `src/features/[domain]/components/`
- Style: Co-locate CSS or use Tailwind classes

**Utilities:**
- Shared helpers: `src/lib/utils/`
- Domain-specific: `src/lib/[domain]/`
- Validation: `src/lib/validation/`
- Type definitions: `src/lib/types/`

**New Store Slice:**
- Create file: `src/stores/slices/[domain]/[resource]Slice.ts`
- Export StateCreator function matching interface
- Add import and spread to domain store (e.g., `agentStore.ts`)

**New Database Model:**
- Define struct: `src-tauri/src/db/models/[resource].rs`
- Add migration: Update `src-tauri/src/db/migrations.rs` with version
- Create repository: `src-tauri/src/db/repos/[domain]/[resource].rs`
- Export types in `src-tauri/src/lib.rs`

**New Engine Module:**
- Create file: `src-tauri/src/engine/[module].rs`
- Add to mod.rs: `pub mod [module];`
- Use shared types from `engine/types.rs`
- Called from commands or background job

## Special Directories

**`.planning/codebase/`:**
- Purpose: Generated by GSD codebase mapper
- Contains: ARCHITECTURE.md, STRUCTURE.md, STACK.md, INTEGRATIONS.md, etc.
- Generated: Not committed; regenerated on demand
- Committed: No

**`src/lib/bindings/`:**
- Purpose: Auto-generated from Rust via ts-rs
- Contains: TypeScript interfaces matching Rust models
- Generated: During Tauri build
- Committed: Yes (for IDE type hints in CI/pre-commit)
- Manual edits: Never; regenerate via build

**`src-tauri/bindings/`:**
- Purpose: Rust bindings for JSON types
- Generated: During Cargo build
- Committed: No (in .gitignore)

**`public/`:**
- Purpose: Static assets served by Vite dev server and bundled with app
- Contains: App icons (`icons/connectors/`), illustrations, empty states
- Pattern: Icons named after connector slugs (e.g., `slack.svg`, `github.svg`)

**`dist/`:**
- Purpose: Built frontend bundle
- Generated: During `npm run build`
- Committed: No (in .gitignore)

**`src-tauri/src/cloud/`:**
- Purpose: Cloud deployment specific logic
- Contains: Cloud client, runner, config for managed cloud instance
- Pattern: Used only when deployed to Personas cloud

---

*Structure analysis: 2026-03-13*
