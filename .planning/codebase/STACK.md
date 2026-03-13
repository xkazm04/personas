# Technology Stack

**Analysis Date:** 2026-03-13

## Languages

**Primary:**
- TypeScript 5.9.3 - Frontend (React components, hooks, API layer)
- Rust (Edition 2021, 1.77.2+) - Desktop backend (Tauri application, engine, database)

**Secondary:**
- JavaScript (ES2021) - Build scripts, configuration, tooling
- SQL - Database queries via rusqlite

## Runtime

**Environment:**
- Node.js >= 20.0.0 (JavaScript/TypeScript tooling, build)
- Tauri 2.x (desktop application framework, IPC bridge)
- Rust standard library with tokio async runtime

**Package Manager:**
- npm (JavaScript/TypeScript)
- Cargo (Rust)
- Lockfiles: package-lock.json present, Cargo.lock present

## Frameworks

**Core:**
- React 19.2.4 - UI framework for desktop application
- Tauri 2 - Hybrid desktop app framework (Rust backend + React frontend)
- Zustand 5.0.11 - State management (Redux-like store)

**Styling:**
- Tailwind CSS 4.2.1 - Utility-first CSS framework
- Framer Motion 12.35.1 - Animation and motion library

**UI Components:**
- Lucide React 0.577.0 - Icon library
- React Router 7.13.1 / React Router DOM 7.13.1 - Client-side routing
- @xyflow/react 12.10.1 - Node/edge graph visualization
- Recharts 3.8.0 - React charting library
- React Markdown 10.1.0 - Markdown rendering with rehype-highlight 7.0.2 and remark-gfm 4.0.1

**Testing:**
- Vitest 4.0.18 - Test runner (unit, integration, e2e)
- Testing Library React 16.3.2 - Component testing utilities
- Testing Library Jest-DOM 6.9.1 - DOM matchers
- JSDOM 28.1.0 - DOM simulation for Node environment

**Build/Dev:**
- Vite 7.3.1 - Frontend build tool, dev server
- TypeScript Compiler (tsc) - Type checking
- @vitejs/plugin-react 5.1.4 - Fast Refresh for React
- @tailwindcss/vite 4.2.1 - Tailwind CSS integration
- Tauri CLI 2.10.1 - Tauri app builder

**Linting/Formatting:**
- ESLint 10.0.3 - JavaScript/TypeScript linting
- @eslint/js 10.0.1 - ESLint recommended rules
- typescript-eslint 8.56.1 - TypeScript linting
- Custom ESLint rules in `eslint-rules/` (enforce-base-modal)

## Key Dependencies

**Critical:**
- @tauri-apps/api 2.10.1 - Rust ↔ JavaScript IPC layer, event system, window management
- @tauri-apps/plugin-dialog 2.6.0 - Native file dialogs
- @tauri-apps/plugin-notification 2.3.3 - Native notifications
- @tauri-apps/plugin-shell 2.3.5 - Shell command execution
- @tauri-apps/plugin-updater 2.10.0 - Application auto-updates
- @tauri-apps/plugin-deep-link 2.4.7 - Deep link protocol (personas://)

**Database:**
- rusqlite 0.38 - SQLite bindings (bundled)
- r2d2 0.8 - Connection pooling
- r2d2_sqlite 0.32 - r2d2 SQLite adapter
- better-sqlite3 12.6.2 - Fast SQLite for Node (optional)

**Cryptography & Security:**
- aes-gcm 0.10 - AES-GCM encryption (Rust)
- pbkdf2 0.12 - Key derivation (Rust)
- sha2 0.10 - SHA-256 hashing (Rust)
- base64 0.22 - Base64 encoding (Rust)
- zeroize 1.x - Memory zeroization (Rust)
- rsa 0.9 - RSA encryption (Rust)
- ed25519-dalek 2.x - EdDSA signatures (Rust, P2P identity)
- keyring 3.x - OS credential storage (Rust, desktop feature)
- dompurify 3.3.2 - XSS prevention (JavaScript)

**P2P & Networking:**
- mdns-sd 0.11 - mDNS service discovery (Rust, desktop feature)
- quinn 0.11 - QUIC protocol (Rust, desktop feature)
- rustls 0.23 - TLS (Rust)
- rcgen 0.13 - Certificate generation (Rust)
- axum 0.8 - Async HTTP framework (webhook server)
- reqwest 0.12 - HTTP client (Rust, with rustls-tls, stream)
- rmp-serde 1.3 - MessagePack serialization (Rust, P2P)

**Data & Serialization:**
- serde 1.x - Serialization framework (Rust)
- serde_json 1.x - JSON serialization (Rust)
- serde_yaml 0.9 - YAML parsing (Rust)
- ts-rs 10.x - TypeScript type generation from Rust (with chrono-impl, serde-json-impl)
- js-yaml 4.1.1 - YAML parsing (JavaScript)

**Vector Knowledge Base:**
- sqlite-vec 0.1 - Vector storage in SQLite
- fastembed 4.x - Fast embedding model inference
- ort 2.0.0-rc.9 - ONNX Runtime (dynamic loading)

**Async & Concurrency:**
- tokio 1.x - Async runtime (multi-threaded, macros, sync, time, process, io-util, fs, net)
- tokio-util 0.7 - Tokio utilities
- async-trait 0.1 - Async trait support (Rust)

**Error Handling & Observability:**
- thiserror 2.x - Error type derivation (Rust)
- sentry 0.34 - Error tracking (Rust backend)
- @sentry/react 10.42.0 - Error tracking (React frontend)
- sentry-tracing 0.34 - Tracing integration with Sentry
- tracing 0.1 - Structured logging (Rust)
- tracing-subscriber 0.3 - Tracing implementation (env-filter, json)
- tracing-appender 0.2 - Log file appending (Rust)

**Utilities:**
- uuid 1.x - UUID generation (Rust)
- chrono 0.4 - Date/time handling (Rust)
- dirs 6.x - User directories (Rust)
- whoami 1.x - OS user/hostname (Rust)
- regex 1.x - Regular expressions (Rust)
- jsonschema 0.28 - JSON Schema validation (Rust)
- tempfile 3.x - Temporary files (Rust)
- zip 2.x - ZIP archive handling (Rust)
- url 2.x - URL parsing (Rust)
- urlencoding 2.x - URL encoding (Rust)
- open 5.x - Open files in default applications (Rust)
- dotenvy 0.15 - .env file loading (Rust)
- @dnd-kit/core 6.3.1 - Drag-and-drop primitives
- @tanstack/react-virtual 3.13.21 - Virtual scrolling
- hmac 0.12 - HMAC generation (Rust, webhook validation)
- hex 0.4 - Hex encoding (Rust)

**Desktop-only (feature-gated "desktop"):**
- tauri-plugin-window-state 2.x - Window state persistence
- tauri-plugin-single-instance 2.x - Single instance enforcement
- notify 7.x - File system watcher (macOS kqueue) (Rust)
- arboard 3.x - Clipboard access (Rust)
- which 8.0.1 - Executable path resolution (Rust)
- windows 0.58 - Windows API bindings (Rust, Win32 UI/threading/process/crypto)

## Configuration

**Environment:**
- Development: `.env` file at project root (not committed)
- Production: Environment variables set at compile time via `option_env!()` for Supabase, Google OAuth, Sentry
- Configuration reads from: .env files, environment variables, compile-time constants
- Key env vars documented in `.env.example`

**Build:**
- `tsconfig.json` - TypeScript compiler options (ES2021 target, strict mode, path aliases via @/*)
- `vite.config.ts` - Frontend build config (React plugin, Tailwind, platform detection, WebView2 compat)
- `vitest.config.ts` - Unit test config (jsdom environment)
- `vitest.e2e.config.ts` - E2E test config (custom CLI reporter)
- `vitest.integration.config.ts` - Integration test config (node environment, forked pools)
- `eslint.config.js` - ESLint configuration (typescript-eslint, custom enforce-base-modal rule)
- `.cargo/config.toml` - Cargo configuration for Rust builds
- `tauri.conf.json` - Tauri application configuration (windows, security CSP, plugins, bundle settings)

**Source Control:**
- `.gitignore` - Excludes dist/, node_modules/, .env, build artifacts
- `.gitlab-ci.yml` - GitLab CI/CD pipeline configuration

## Platform Requirements

**Development:**
- Node.js >= 20.0.0
- Rust 1.77.2+
- Cargo (comes with Rust)
- npm (or yarn/pnpm compatible)
- Operating system: Windows, macOS, or Linux (development supported on all)

**Production (Desktop):**
- Windows 7+ (NSIS installer)
- macOS 10.15+ (x64/ARM64)
- Linux (AppImage, deb)
- Minimum window size: 900x600 (default 1280x800)
- Auto-updates via GitHub releases (signed Ed25519 keypair)

**Deployment:**
- Desktop binary packaged via Tauri (platform-specific installers)
- Frontend bundled into binary via Vite
- Database (personas.db) stored in user app data directory
- Optional cloud backend for execution (CloudClient integration)

---

*Stack analysis: 2026-03-13*
