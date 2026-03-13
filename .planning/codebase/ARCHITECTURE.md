# Architecture

**Analysis Date:** 2026-03-13

## Pattern Overview

**Overall:** Tauri desktop application with layered architecture separating frontend React/TypeScript UI, IPC command layer, and Rust backend engine.

**Key Characteristics:**
- **Desktop-first**: Electron alternative using Tauri for lightweight native bindings
- **Bidirectional IPC**: Frontend invokes Tauri commands; backend emits typed events to frontend
- **Modular domains**: Core functionality (personas, executions, credentials) split into independent subsystems
- **State synchronization**: Zustand stores on frontend synchronized via EventBridge listener pattern
- **Execution engine**: Rust backend manages persona execution queue, tool invocation, and automation workflows

## Layers

**Frontend UI Layer:**
- Purpose: React components and user interactions for agent/persona management
- Location: `src/features/`, `src/components/`
- Contains: React components, hooks, feature modules (agents, vault, templates, etc.)
- Depends on: Zustand stores, API module, Tauri IPC
- Used by: User interactions in browser/Tauri window

**API/IPC Bridge Layer:**
- Purpose: Type-safe wrappers around Tauri command invocations and Rust bindings
- Location: `src/api/`, `src/lib/bindings/`
- Contains: Command invocation functions, type definitions generated from Rust
- Depends on: Tauri invoke, type bindings from Rust
- Used by: Zustand slices, hooks, components

**State Management Layer:**
- Purpose: Centralized Zustand stores for UI state and cached data
- Location: `src/stores/`, `src/stores/slices/`
- Contains: Domain-specific slices (agents, vault, pipeline, overview, system)
- Depends on: API module for data fetching
- Used by: Components via React hooks

**Event Bridge Layer:**
- Purpose: Declarative subscription manager for backend → frontend events
- Location: `src/lib/eventBridge.ts`
- Contains: Event listener registration, payload validation, store updates
- Depends on: Tauri event listeners, Zustand stores
- Used by: App root on mount; manages execution status, credential events, etc.

**Tauri Command Layer:**
- Purpose: Rust-side IPC endpoints that receive frontend requests
- Location: `src-tauri/src/commands/`
- Contains: Command handlers with auth checks, structured by domain (core, credentials, execution, etc.)
- Depends on: Database module, engine module
- Used by: Frontend API invocations

**Database Layer:**
- Purpose: SQLite schema, migrations, and repository pattern for data access
- Location: `src-tauri/src/db/`
- Contains: Models, migrations, repository functions organized by domain
- Depends on: SQLite via rusqlite, r2d2 connection pooling
- Used by: Commands, engine modules

**Engine Layer:**
- Purpose: Business logic for persona execution, tool running, automation, and integration with external services
- Location: `src-tauri/src/engine/`
- Contains: Execution queue, runner, tool orchestration, design, credential negotiation, healing, etc.
- Depends on: Database, external SDKs (MCP, n8n, GitHub, GitLab, etc.)
- Used by: Commands, background jobs

## Data Flow

**User Creation → Execution:**

1. User enters persona name/prompt in `ChatCreator.tsx`
2. Frontend calls `createPersona()` API (wraps Tauri command)
3. Rust command `create_persona` inserts to database, returns `Persona`
4. Frontend updates `personaSlice` via store
5. User selects persona, triggers execution via `executePersona()` or chat
6. Command `execute_persona` queues execution in engine's `ExecutionQueue`
7. Engine runner processes queue, invokes tools, streams output
8. Backend emits `execution-status` and `stream-output` events
9. EventBridge listeners update `executionSlice` and append output
10. Components subscribe to slice state and render live updates

**Credential Design Flow:**

1. User creates credential in vault, selects service (GitHub, Slack, etc.)
2. Frontend calls `start_credential_design` command
3. Rust spawns design process via CLI subprocess
4. Engine's `CredentialDesign` module manages form generation
5. User fills form, frontend calls `submit_credential_design`
6. Backend validates, calls service API, stores encrypted token
7. Emits `credential-designed` event to update frontend
8. Credential available for personas to use

**Automation Flow:**

1. User sets up automation trigger + action in UI
2. Frontend calls `create_automation` command
3. Database stores automation rule
4. Background scheduler (cron) periodically checks triggers
5. When triggered, engine's `AutomationRunner` executes the automation
6. Output and errors stored in execution history
7. Emits events for metrics/healing

**State Management:**

- **Zustand stores** cache fetched data and UI state (selectedPersonaId, expanded sections, etc.)
- **Persist middleware** saves UI preferences (selectedPersonaId) to localStorage
- **EventBridge** keeps stores synced with backend in real-time via Tauri events
- **Slices** are domain-specific (PersonaSlice, ExecutionSlice, CredentialSlice, etc.)
- **Error handling** in slices uses `reportError()` helper that updates state AND fires toast notification

## Key Abstractions

**Persona:**
- Purpose: Agent definition with name, system prompt, tools, triggers
- Examples: `src/lib/bindings/Persona.ts`, `src-tauri/src/db/models/persona.rs`
- Pattern: Modeled in Rust, auto-exported to TypeScript via ts-rs, synced via database

**Execution:**
- Purpose: Single run of a persona (triggered by event, schedule, or manual)
- Examples: `src-tauri/src/engine/runner.rs`, `src/stores/slices/agents/executionSlice.ts`
- Pattern: Queued, processed by engine, streamed output via events

**Tool:**
- Purpose: External service action (Slack send, GitHub issue create, etc.)
- Examples: `src-tauri/src/engine/tool_runner.rs`, `src/lib/bindings/PersonaToolDefinition.ts`
- Pattern: Defined in database, invoked dynamically at execution time

**Trigger:**
- Purpose: Event that initiates persona execution (webhook, schedule, app focus, clipboard, etc.)
- Examples: `src/features/triggers/`, `src-tauri/src/engine/subscription.rs`
- Pattern: Configured per persona, monitored by background job

**Credential:**
- Purpose: Encrypted OAuth token or API key for external service authentication
- Examples: `src/features/vault/`, `src-tauri/src/engine/credential_negotiator.rs`
- Pattern: Designed via interactive flow, stored encrypted, rotated via policies

**Automation:**
- Purpose: Reactive rule combining trigger, condition, and action
- Examples: `src/features/agents/sub_connectors/components/automation/`, `src-tauri/src/engine/automation_runner.rs`
- Pattern: Stored in database, executed by background scheduler

## Entry Points

**Frontend:**
- Location: `src/main.tsx`
- Triggers: Browser loads Vite dev server or Tauri window
- Responsibilities: React hydration, Sentry init, event bridge setup, auth initialization

**App Component:**
- Location: `src/App.tsx`
- Triggers: After React root rendered
- Responsibilities: Consent modal, onboarding, theme setup, middleware registration, store hydration

**Tauri Command Handler:**
- Location: `src-tauri/src/main.rs`
- Triggers: Tauri app startup
- Responsibilities: Sentry init, database init, background job start, app state setup

**App State Initialization:**
- Location: `src-tauri/src/lib.rs` (app_lib::run())
- Triggers: Tauri builder setup
- Responsibilities: Database pool creation, command registration, IPC auth setup, active process registry

**Background Job:**
- Location: `src-tauri/src/background_job.rs`
- Triggers: Spawned at startup, runs independently
- Responsibilities: Cron scheduling, trigger monitoring, automation execution, health checks

## Error Handling

**Strategy:** Layered error handling with typed `AppError` on backend, automatic Sentry capture, and dual-channel frontend feedback (inline state + toast toast notification).

**Patterns:**

- **IPC Errors**: Rust commands return `Result<T, AppError>`. Frontend receives error serialized as AppError struct.
- **State Error**: Zustand slices store `error: string | null`. Update via `reportError()` helper which also fires toast.
- **Toast Notification**: Most user-facing errors fire a toast via `useToastStore.addToast()` for visibility.
- **Sentry Capture**: Backend Tauri commands wrapped with Sentry guards; frontend errors via Sentry error boundary.
- **PII Scrubbing**: Sentry events scrub UUIDs, credential names, and sensitive breadcrumb data before sending.

## Cross-Cutting Concerns

**Logging:**
- Approach: Rust uses `tracing` crate with structured logging. Frontend uses console.warn/console.error. Logs in dev mode written to `.claude/logs/`.
- Pattern: Error-level logs in Rust include context (execution_id, persona_id, trigger_id, etc.) for debugging.

**Validation:**
- Approach: Rust models use serde for JSON deserialization; frontend validates payloads via schema validation (e.g., `ExecutionStatusSchema`).
- Pattern: Frontend validates Tauri event payloads before updating state to prevent corrupt data propagation.

**Authentication:**
- Approach: App requires user login (via IPC auth). Desktop cloud deployments use OAuth. Commands check `require_auth_sync()`.
- Pattern: `ipc_auth` module gates all Tauri commands. Offline mode bypasses auth for local-only operations.

**Concurrency:**
- Approach: Rust uses `tokio` async runtime. Database connection pool (r2d2) manages SQLite connections. Frontend uses React hooks for concurrent renders.
- Pattern: ExecutionQueue enforces single-execution-per-persona, multi-run domains track concurrency with `AtomicBool` flags.

**Timeout & Safety:**
- Approach: Engine hard-caps execution at 30 minutes. Tauri invoke has configurable timeout (default 10s). Database queries have `busy_timeout`.
- Pattern: User can cancel running executions via `cancel_execution` command, which kills subprocess.

---

*Architecture analysis: 2026-03-13*
