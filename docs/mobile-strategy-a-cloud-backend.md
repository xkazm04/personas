# Strategy A: Thin Mobile Client + Cloud Backend

> Status: **Analysis only — not implementing**
> Created: 2026-03-09

## Overview

Move the Rust execution engine to a server deployment. The mobile app becomes a
lightweight dashboard that monitors, triggers, and configures agents via HTTPS.
Agent execution happens server-side using LLM HTTP APIs instead of CLI process
spawning.

## Architecture

```
┌──────────────────┐         HTTPS/WSS          ┌─────────────────────────┐
│   Mobile Client   │ ◄────────────────────────► │    Cloud Orchestrator    │
│                    │                            │                          │
│  Schedule Timeline │  GET /schedules            │  Rust Engine (reused)    │
│  Recovery Panel    │  POST /execute/:id          │  ├─ scheduler + cron     │
│  Agent Dashboard   │  PATCH /triggers/:id        │  ├─ event bus            │
│  Notifications     │  WS /events (live stream)  │  ├─ crypto/vault         │
│  Credential Mgmt   │  POST /credentials          │  ├─ SQLite → Postgres    │
│                    │  GET /executions            │  ├─ webhook receiver     │
│  React Native      │                            │  ├─ HTTP polling engine  │
│  or Tauri v2 beta  │                            │  └─ LLM API execution    │
└──────────────────┘                            └─────────────────────────┘
                                                           │
                                                  ┌────────┴────────┐
                                                  │   LLM Providers  │
                                                  │  (Claude, Gemini, │
                                                  │   OpenAI — HTTP)  │
                                                  └─────────────────┘
```

## What gets reused from current codebase

### Fully reusable (~35% of Rust backend)

| Module | Current location | Notes |
|--------|-----------------|-------|
| Cron parser + scheduler | `src-tauri/src/engine/cron.rs` | Pure Rust, zero OS deps |
| Event bus + subscriptions | `src-tauri/src/engine/background.rs` | Tokio-based, portable |
| Trigger system (CRUD, chains, composite) | `src-tauri/src/engine/triggers.rs` | SQLite queries, portable |
| Crypto vault (AES-GCM, RSA) | `src-tauri/src/engine/crypto.rs` | Pure Rust crates |
| HTTP polling engine | `src-tauri/src/engine/polling.rs` | reqwest + rustls |
| Webhook receiver | `src-tauri/src/engine/webhook.rs` | Axum, already a server |
| Notification dispatch (Slack, Telegram, Email) | `src-tauri/src/notifications.rs` | HTTP-based channels |
| OAuth token management | `src-tauri/src/commands/infrastructure/auth.rs` | HTTP flows |
| Cloud client | `src-tauri/src/cloud/client.rs` | Already HTTP-based |
| Template system + design reviews | Various | Pure data logic |

### Requires modification (~15%)

| Module | Change needed |
|--------|--------------|
| **SQLite → Postgres** | r2d2_sqlite → sqlx/diesel with Postgres. Schema stays same but needs migration tooling. Or keep SQLite per-user with server-side file management |
| **Keyring → server vault** | Replace OS keyring with HashiCorp Vault, AWS Secrets Manager, or encrypted Postgres column |
| **IPC layer → HTTP API** | Replace Tauri invoke commands with Axum REST endpoints. The command signatures already return typed results — straightforward conversion |
| **Auth model** | Add multi-user auth. Current design is single-user desktop. Need JWT sessions, user isolation, RBAC |

### Dropped entirely (~50%)

| Module | Why |
|--------|-----|
| Process spawning (runner.rs) | Replaced by HTTP API calls to LLM providers |
| Desktop bridges (VS Code, Docker, Terminal, Obsidian) | No mobile equivalent |
| Clipboard monitor (arboard) | Desktop-only hardware |
| App focus trigger (Win32 API) | Desktop-only OS integration |
| File watcher (notify crate) | No equivalent in mobile/server context |
| System tray (tauri-plugin-tray-icon) | Desktop UI element |
| Window state management | Desktop UI element |
| Tauri IPC encryption (RSA handshake) | Replaced by HTTPS/TLS |

## Execution model change

### Current (desktop)
```
Trigger fires → spawn `claude --prompt "..." --output json` → parse stdout → store result
```

### Proposed (server)
```
Trigger fires → POST https://api.anthropic.com/v1/messages { ... } → parse JSON → store result
```

This eliminates the #1 mobile blocker. The tradeoff: no local CLI tool ecosystem,
but cloud execution is already how most production AI agents work.

### Multi-step agent plans

Current desktop runtime (`desktop_runtime.rs`) executes plans as sequential steps
with stdout piping between them. Server equivalent:

```
Step 1: Call LLM API → get structured output
Step 2: Inject step 1 output as context → call LLM API again
Step 3: Execute tool calls (HTTP-based tools only) → final result
```

Tool calls that currently shell out (run terminal command, docker exec) would need
to be replaced with:
- **SSH bridge** to user's desktop/server (if they opt in)
- **Cloud container execution** (AWS Lambda, Cloud Run)
- **Restricted to HTTP-only tools** (API calls, webhooks, data transforms)

## Mobile client technology options

### Option 1: React Native (recommended)

- Reuse existing React component logic and design system
- Share TypeScript types (already generated via ts-rs)
- Mature mobile ecosystem
- Push notifications via Firebase/APNs
- Background task support via Headless JS

### Option 2: Tauri v2 Mobile (experimental)

- Tauri v2 has alpha Android/iOS support (as of 2025)
- Would carry over the React webview frontend almost unchanged
- Rust backend compiles via Android NDK
- Risk: Tauri mobile is not production-ready, webview performance on older Android devices is poor
- Benefit: maximum code sharing with desktop

### Option 3: Flutter

- Strong mobile performance
- Would require full UI rewrite (Dart, not React)
- Good for if we want a native-feeling mobile app
- Loses all frontend code investment

**Recommendation:** React Native for mobile-first experience, with the option to
revisit Tauri v2 mobile when it matures.

## Schedule recovery on mobile

The `SkippedRecoveryPanel` we built becomes critical infrastructure on mobile.
Phones aggressively kill background processes. Additional mobile-specific
recovery mechanisms needed:

| Mechanism | Platform | Purpose |
|-----------|----------|---------|
| **WorkManager** | Android | Guaranteed periodic background work, survives app kill |
| **BGTaskScheduler** | iOS | Limited background execution windows |
| **Push notifications** | Both | Cloud orchestrator sends push when a cron fires server-side |
| **AlarmManager (exact)** | Android | For time-critical cron triggers |
| **Silent push + wake** | iOS | Server triggers app wake for critical schedules |

The server-side scheduler would become the source of truth for cron timing. Mobile
app syncs on launch and receives push notifications for important events.

## Data sync strategy

```
Server (source of truth)                    Mobile (cached view)
┌─────────────────────┐                    ┌─────────────────────┐
│ Postgres/SQLite DB   │ ──── sync ────►  │ Local SQLite cache   │
│                      │                    │                      │
│ • Full execution log │  Last-write-wins  │ • Recent executions  │
│ • All credentials    │  with conflict    │ • Cached agent list  │
│ • Complete history   │  resolution       │ • Offline queue      │
│ • Agent definitions  │                    │ • Pending actions    │
└─────────────────────┘                    └─────────────────────┘
```

Mobile needs to handle:
- **Offline queuing**: manual triggers queued locally, executed when online
- **Partial sync**: don't download entire execution history to phone
- **Conflict resolution**: if user edits cron on desktop and mobile simultaneously

## API surface (draft)

```
# Schedules
GET    /api/v1/schedules                    → ScheduleEntry[]
GET    /api/v1/schedules/skipped            → SkippedExecution[]
POST   /api/v1/schedules/:id/execute        → Execution
PATCH  /api/v1/schedules/:id/frequency      → { cron?, interval_seconds? }
POST   /api/v1/schedules/batch-recover      → { succeeded, failed }

# Agents
GET    /api/v1/agents                       → CronAgent[]
GET    /api/v1/agents/:id                   → AgentDetail
PATCH  /api/v1/agents/:id/toggle            → { enabled }

# Executions
GET    /api/v1/executions?limit=50          → Execution[]
GET    /api/v1/executions/:id               → ExecutionDetail
POST   /api/v1/executions/:id/rerun         → Execution

# Triggers
GET    /api/v1/triggers                     → PersonaTrigger[]
POST   /api/v1/triggers                     → PersonaTrigger
PATCH  /api/v1/triggers/:id                 → PersonaTrigger
DELETE /api/v1/triggers/:id

# Scheduler
GET    /api/v1/scheduler/status             → SchedulerStats
POST   /api/v1/scheduler/start
POST   /api/v1/scheduler/stop

# Live events
WS     /api/v1/events/stream                → Server-Sent Events or WebSocket
```

## Security considerations

- All traffic over HTTPS/TLS (reqwest already uses rustls)
- JWT authentication with refresh token rotation (existing Supabase flow)
- API keys stored server-side, never on device
- Credential encryption at rest (existing AES-GCM vault)
- Rate limiting per user (existing trigger rate limiter can be repurposed)
- Audit log for all mobile-initiated actions

## Effort estimate (rough)

| Work item | Scope |
|-----------|-------|
| Extract Rust engine into standalone server binary | Medium — remove Tauri deps, add Axum API layer |
| SQLite → Postgres migration (optional) | Medium — schema is clean, needs migration tooling |
| Replace process spawning with HTTP LLM calls | Large — complete execution model rewrite |
| Multi-user auth + isolation | Medium — add user_id to all queries |
| React Native mobile app | Large — new project, but can reuse TS types + design patterns |
| Push notification infrastructure | Small — Firebase + APNs setup |
| Data sync + offline queue | Medium — new mobile-specific concern |
| CI/CD for mobile builds | Small — standard React Native pipeline |

## Open questions

1. **Per-user SQLite vs shared Postgres?** SQLite-per-user is simpler but doesn't
   scale. Postgres is production-grade but requires migration work.
2. **Desktop bridge over SSH?** Could we let mobile users configure an SSH tunnel
   to their desktop to retain VS Code/Docker/Terminal bridges remotely?
3. **Local LLM on phone?** With on-device models (Gemma, Phi) improving, could
   some lightweight agents run locally on flagship phones?
4. **Pricing model?** Cloud execution has per-API-call costs. Desktop is free
   (user's own API keys). How does this change the economics?
5. **Offline-first or online-only?** Full offline support is significantly more
   complex. Is "online with graceful degradation" sufficient?
