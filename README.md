# Personas Desktop

A cross-platform desktop application for building, orchestrating, and monitoring AI agent personas. Built with **Tauri 2** (Rust) and **React 19** (TypeScript).

---

## Overview

Personas Desktop provides a local-first environment for creating AI agents with distinct identities, connecting them to external services via encrypted credentials, and running them on schedules or event triggers. A visual team canvas lets you wire agents together into collaborative pipelines, while an observability dashboard tracks every execution in real time.

## Features

### Agent Management
- Create and configure AI personas with custom prompts, tools, and behaviors
- Version-controlled prompt editor with history and diff view
- Onboarding wizard for quick persona creation from built-in or n8n-imported templates
- Group and organize agents with drag-and-drop

### Team Canvas
- Visual node-based editor (React Flow) for composing multi-agent pipelines
- Define connections and data flow between personas
- Pipeline execution controls with real-time status

### Execution Engine
- Local Rust-powered execution runner with async scheduling (cron & event-driven)
- Execution terminal with live streaming output
- Global execution list with filtering and inspection
- Automatic healing system for self-recovering agents

### Credential Vault
- **AES-256-GCM** encryption at rest for all stored credentials
- OS-native keyring integration (Windows Credential Manager / macOS Keychain / Linux Secret Service)
- PBKDF2-HMAC-SHA256 fallback key derivation (600K iterations)
- Connector-based credential management with per-persona assignment
- Credentials injected as environment variables at runtime, never logged

### Observability & Monitoring
- Real-time event bus visualization with animated particle lanes
- Observability dashboard with execution metrics and charts
- Usage dashboard with budget tracking and cost controls
- Memory management for persistent agent context
- Structured logging with tracing

### Design Reviews
- Automated design review generation for agent configurations
- Manual review queue with approval workflow
- Test result tracking and quality scoring

### Cloud Integration
- Deploy personas to cloud orchestrator
- OAuth-based authentication with deep link callback (`personas://`)
- Auto-updater via GitHub Releases

### Desktop Integration
- System tray with quick actions
- Desktop notifications for execution events
- Window state persistence across sessions
- Single-instance enforcement with deep link routing

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Runtime | [Tauri 2](https://v2.tauri.app/) |
| Backend | Rust, Tokio, SQLite (r2d2 pool) |
| Frontend | React 19, TypeScript 5.9, Vite 7 |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Animations | Framer Motion |
| Visualizations | Recharts, React Flow (XYFlow) |
| Encryption | AES-GCM, PBKDF2, OS Keyring |
| Networking | Reqwest (rustls-tls) |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77.2
- Platform-specific Tauri dependencies ([see Tauri docs](https://v2.tauri.app/start/prerequisites/))

## Getting Started

```bash
# Install frontend dependencies
npm install

# Run in development mode (starts Vite + Tauri)
npm run tauri dev

# Build for production
npm run tauri build
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | TypeScript check + Vite production build |
| `npm run lint` | Run ESLint on `src/` |
| `npm run tauri dev` | Launch Tauri in development mode |
| `npm run tauri build` | Build distributable desktop app |

## Project Structure

```
personas-desktop/
├── src/                        # Frontend (React + TypeScript)
│   ├── api/                    # Tauri IPC bridge
│   ├── features/personas/      # Main feature module
│   │   └── components/         # UI components (~65 files)
│   │       ├── charts/         # Chart components
│   │       ├── realtime/       # Event bus visualization
│   │       └── team/           # Team canvas nodes & edges
│   ├── hooks/                  # Custom React hooks
│   ├── lib/
│   │   ├── bindings/           # Auto-generated TS types from Rust
│   │   ├── personas/           # Business logic utilities
│   │   ├── types/              # TypeScript type definitions
│   │   └── utils/              # Utility functions
│   ├── stores/                 # Zustand state stores
│   └── styles/                 # Global CSS
│
├── src-tauri/                  # Backend (Rust)
│   ├── src/
│   │   ├── commands/           # Tauri command handlers
│   │   ├── db/                 # SQLite database layer
│   │   │   └── repos/          # Repository pattern data access
│   │   ├── engine/             # Core execution engine
│   │   │   ├── runner.rs       # Agent execution
│   │   │   ├── scheduler.rs    # Cron scheduling
│   │   │   ├── crypto.rs       # AES-GCM encryption
│   │   │   ├── bus.rs          # Event bus
│   │   │   ├── healing.rs      # Self-healing logic
│   │   │   └── ...
│   │   └── cloud/              # Cloud deployment client
│   └── tauri.conf.json         # Tauri app configuration
│
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Security

- All credentials encrypted with **AES-256-GCM** before database storage
- Encryption keys stored in OS-native keyring, never on disk in plaintext
- No hardcoded secrets in source code
- Credentials passed to child processes as environment variables (not CLI args)
- API keys scrubbed from environment after execution
- Sensitive values never written to logs
- HTTPS-only external communication via rustls

## License

This project is licensed under the [MIT License](LICENSE).
