# Architecture

This document is a one-page overview of the Personas Desktop system. It covers the big-picture components, how they talk to each other, and where to look in the code when you want to change something. Deeper dives for individual subsystems live in [`/docs`](./docs).

---

## Goals & Constraints

Personas Desktop is a **local-first desktop application** for building and running AI agents. The architecture is shaped by a small number of non-negotiable goals:

1. **Your data stays on your machine.** Personas, prompts, credentials, execution history — everything is stored in a local SQLite database. The only external calls are to AI providers and third-party services you explicitly configure.
2. **Credentials must be safe at rest and in transit.** AES-256-GCM at rest, OS-native keyring for the master key, RSA+AES envelope for IPC transport, zeroized on drop.
3. **Execution must be observable.** Every agent run produces a structured trace of spans, outputs, costs, and errors that the user can inspect in real time.
4. **The frontend must never block.** Long-running work happens on the Rust side; the React UI subscribes to streaming events instead of polling.
5. **Cross-platform without compromise.** Windows, macOS, and Linux are first-class — CI runs the full matrix on every PR.

Everything below follows from these.

---

## Top-Level Shape

```
 +-------------------------------------------------------------+
 |                        User                                |
 +-----------------------------+-------------------------------+
                               |
                  Tauri IPC (invoke + events)
                               |
 +-----------------------------+-------------------------------+
 |  Frontend (React 19 + TypeScript + Tailwind + Zustand)      |
 |                                                             |
 |   src/features/*       src/stores/slices/*                  |
 |   src/api/*            src/i18n/*                           |
 +-----------------------------+-------------------------------+
                               |
                  invokeWithTimeout(...) + event listeners
                               |
 +-----------------------------+-------------------------------+
 |  Backend (Rust + Tokio + Tauri 2)                           |
 |                                                             |
 |   src-tauri/src/commands/*     -- IPC surface               |
 |   src-tauri/src/engine/*       -- execution, scheduling     |
 |   src-tauri/src/db/*           -- SQLite + repositories     |
 |   src-tauri/src/<integration>/ -- gitlab, github, cloud...  |
 +-----+--------------+-------------------+--------------------+
       |              |                   |
       v              v                   v
 +-----+---+    +-----+-----+       +-----+------+
 | SQLite  |    | OS Keyring|       | AI Provider |
 | (local) |    |  (local)  |       | CLIs (spawn)|
 +---------+    +-----------+       +-------------+
```

The runtime is a single Tauri process with two halves: a WebView hosting the React frontend, and a Tokio-based Rust backend. They communicate over Tauri's IPC channel using two primitives:

- **Commands** (`#[tauri::command]`) — request/response calls from frontend to backend.
- **Events** — fire-and-forget messages the backend pushes to the frontend for streaming and notifications.

There is no HTTP server between them. The app is a single binary.

---

## Frontend

### Layout

```
src/
├── api/              # Thin invoke wrappers — one file per Rust module
├── features/         # Feature modules (~20 domains)
│   ├── agents/       # Agent CRUD, editor, chat, lab, team canvas
│   ├── vault/        # Credential management and connectors
│   ├── overview/     # Dashboard, metrics, observability
│   ├── triggers/     # Cron, webhook, clipboard, file watcher
│   ├── recipes/      # Multi-step workflow composition
│   └── ...
├── hooks/            # Cross-cutting React hooks
├── i18n/             # 14-language translation system
├── lib/
│   ├── bindings/     # Auto-generated TS types from Rust (via ts-rs)
│   ├── tauriInvoke.ts # `invokeWithTimeout` — the IPC wrapper
│   └── errors/       # Error registry + friendly message mapping
├── stores/
│   ├── personaStore.ts  # Root Zustand store
│   └── slices/          # One slice per domain
└── styles/           # Global CSS, semantic tokens
```

### Key conventions

- **Every IPC call goes through `invokeWithTimeout`.** Raw `invoke` is banned by ESLint. This gives us consistent timeout handling and error surfacing everywhere.
- **Zustand with slice pattern.** Each domain owns a slice in `src/stores/slices/`. Components subscribe with `useShallow` to avoid re-render storms.
- **Generated bindings are the contract.** Types in `src/lib/bindings/` are generated from Rust structs via `ts-rs` and committed to the repo. CI fails if they drift from the Rust side.
- **i18n is mandatory.** Every user-facing string goes through `t.section.key` from `useTranslation()`. ESLint enforces this. See the [i18n section of the README](./README.md#internationalization-i18n).
- **Errors flow through `toastCatch`/`silentCatch`.** User-facing errors get a toast + Sentry breadcrumb; background errors get Sentry only. Raw errors are mapped to friendly copy via `resolveError()`.

---

## Backend

### Layout

```
src-tauri/src/
├── main.rs           # Binary entry point — thin, calls lib::run()
├── lib.rs            # Tauri builder, AppState, invoke_handler registration
├── commands/         # IPC surface — organized by domain
│   ├── core/
│   ├── credentials/
│   ├── design/
│   ├── execution/
│   ├── infrastructure/
│   └── ...
├── engine/           # Core logic — ~100 modules, no Tauri dependencies
│   ├── runner.rs           # Agent execution (spawns provider CLI)
│   ├── dispatch.rs         # Trigger dispatch + event propagation
│   ├── scheduler.rs        # Cron scheduler (tokio intervals)
│   ├── crypto.rs           # AES-GCM envelope, key derivation
│   ├── bus.rs              # In-process event bus
│   ├── healing.rs          # Self-healing orchestrator
│   ├── cli_process.rs      # CliProcessDriver — streams NDJSON from child
│   ├── provider/           # Per-provider adapters (Claude, Codex, ...)
│   ├── pipeline_executor.rs # Team-canvas pipeline runtime
│   ├── intent_compiler.rs  # Natural-language → AgentIR
│   └── ...
├── db/
│   ├── schema.rs     # SQLite schema + migrations
│   ├── models/       # Row types
│   └── repos/        # Repository pattern — all SQL lives here
├── gitlab/           # GitLab API client (separate from commands)
├── cloud/            # Cloud orchestrator client
└── error.rs          # Central AppError enum with IPC Serialize impl
```

### Key conventions

- **Commands are thin.** A command handler validates input, delegates to a service or repo, and returns a typed result. No business logic lives in `commands/`.
- **Repository pattern.** All SQL is inside `db/repos/`. Commands and engine modules never write raw SQL.
- **Clippy clean, `-D warnings`.** Enforced in CI. Prefer `?` propagation over `unwrap`/`expect` outside of tests.
- **`AppState` carries the shared singletons** (connection pool, event emitter, scheduler handles) via `Arc<Mutex<...>>` or `Arc<RwLock<...>>`. Added in `lib.rs` and passed to command handlers via Tauri's state injection.
- **Errors centralize in `error::AppError`.** New integrations add a variant and update the `Serialize` impl so the frontend receives a structured object, not a stringified debug format.

---

## The Execution Path

This is the hot path — what happens when an agent runs. Understanding this flow is the fastest way to get productive in the codebase.

```
  Trigger fires           Engine loads            Provider CLI spawns
  (cron / webhook /       persona + creds         (claude / codex / ...)
   clipboard / chain)          |                         |
         |                     v                         v
         |              +------+-------+          +------+------+
         +------------> | dispatch.rs  +--------->+ runner.rs   |
                        |              |          | CliProcess  |
                        +------+-------+          | Driver      |
                               |                  +------+------+
                               |                         |
                               v                         v
                        +------+-------+          stream NDJSON
                        | bus.rs event |<---------stdout lines
                        | emitter      |          parsed, tokens
                        +------+-------+          counted, cost
                               |                  attributed
                               v
                        frontend receives
                        events via eventBridge
```

1. **Trigger** — cron, webhook, clipboard, file watcher, chain, or manual button click. Each source registers with `dispatch.rs`.
2. **Dispatch** — resolves the trigger to a persona, loads its config, and hands off to the execution engine.
3. **Runner** — `runner.rs` builds the provider command, injects credentials as env vars (scrubbed after spawn), and launches `CliProcessDriver`.
4. **Streaming** — the driver reads NDJSON from stdout line by line, parses token counts, and emits events on the in-process bus.
5. **Event bridge** — `eventBridge.ts` on the frontend subscribes to Tauri events and fans them out to Zustand slices.
6. **Post-processing** — healing engine inspects failures, chain triggers fire dependent personas, notifications fire, and the execution record is committed to SQLite.

Every step is observable: the same event stream drives the real-time dashboard, the execution history list, and the trace view.

---

## Data Layer

- **SQLite** via `r2d2` connection pool. The database file lives in the OS-specific app-data directory.
- **Migrations** are embedded in the binary and run at startup. Schema lives in `src-tauri/src/db/schema.rs`.
- **Credentials** are the only AES-encrypted rows. The rest of the schema is plaintext — prompts, config, execution history, metrics. This is intentional: encrypting everything buys no extra security (the attacker model for local-first is "your disk is compromised", which the keyring already addresses) and harms queryability and debuggability.

---

## Security Model

See [SECURITY.md](./SECURITY.md) for the full threat model. Key points:

- **At rest** — credentials encrypted with AES-256-GCM. Key in OS keyring, never on disk.
- **In transit (IPC)** — hybrid RSA-2048 + AES-256-GCM envelope. Session keys regenerated on every app launch.
- **In transit (external)** — HTTPS via `rustls-tls`. No cleartext HTTP.
- **Memory** — sensitive values zeroized on drop via `ZeroizeOnDrop`.
- **Child processes** — credentials passed as env vars, not CLI args. Env vars scrubbed after spawn.
- **Local webhook** — binds `127.0.0.1` only. Does not expose on the network.

---

## Cross-Cutting Concerns

### Internationalization
14 languages, single source of truth in `src/i18n/en.ts`. Non-English bundles lazy-load and deep-merge over English, so missing keys never break the app. Backend sends language-agnostic status tokens; the frontend maps them via `tokenMaps.ts`. See the [README i18n section](./README.md#internationalization-i18n) for the translator pipeline.

### Observability
An in-process event bus (`engine/bus.rs`) broadcasts every execution-lifecycle event. The frontend subscribes via `eventBridge.ts` and renders three views of the same stream: live dashboard charts, a scrolling event log, and a tracing waterfall. Errors opt-in to Sentry reporting.

### Self-Healing
The `engine/healing.rs` orchestrator watches for transient failure patterns (timeouts, rate limits, flaky connector responses) and automatically retries with backoff. Repeated failures trip a per-provider circuit breaker so the app stops throwing good requests at a sick provider.

### Automation Surfaces
The app can export personas out to external orchestrators: GitHub Actions (repository dispatch), GitLab CI/CD (generated pipeline YAML), n8n workflows, and a webhook-based cloud orchestrator. Each integration lives in its own Rust module (`gitlab/`, `cloud/`, etc.) with a thin command wrapper.

---

## Where to Look Next

- **Adding an integration** — see the "Adding a New Integration" checklist in `.claude/CLAUDE.md`.
- **Adding a new UI feature** — start in the relevant `src/features/<domain>/` directory. Check the store slice first.
- **Changing the execution pipeline** — start at `engine/dispatch.rs`, then follow the call into `runner.rs` and `cli_process.rs`.
- **Changing the database schema** — `db/schema.rs` for the migration, `db/models/` for the row type, `db/repos/` for the query.
- **Debugging a failing agent run** — check the execution trace view in the dashboard first, then dig into the log file under the app-data directory.
- **Troubleshooting the dev loop** — see [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) and [docs/devops/guide-desktop-troubleshooting.md](./docs/devops/guide-desktop-troubleshooting.md).

For a walkthrough of local build and the inner dev loop, continue to **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)**.
