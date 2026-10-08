# Personas Desktop

> A local-first desktop app for building AI agents, connecting them to your tools, running them on triggers, and putting teams of them to work on real software projects. Credentials are encrypted, state lives in SQLite on your machine, and nothing leaves it unless you send it.

[![CI](https://github.com/xkazm04/personas/actions/workflows/ci.yml/badge.svg)](https://github.com/xkazm04/personas/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/xkazm04/personas?display_name=tag&sort=semver)](https://github.com/xkazm04/personas/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#prerequisites)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)](./package.json)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)](./package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](./CONTRIBUTING.md)

Built with **Tauri 2** (Rust) and **React 19** (TypeScript).

**Jump to:**
[What it does](#what-it-does) · [Tour of the app](#tour-of-the-app) · [How a run works](#how-a-run-works) · [Quickstart](#getting-started) · [Docs](./docs/README.md) · [Contributing](./CONTRIBUTING.md) · [Changelog](./CHANGELOG.md)

---

## What it does

Personas is built around one loop. You define **agents** (personas), give them **connections** to the services they need, let **triggers** run them, and **watch and govern** what they do. On top of that loop sit three larger things: a way to point **teams of agents at your own codebases**, three built-in **Companions** that look after the app itself, and **plugins** for adjacent jobs.

| If you want to… | Go to | Short version |
| --- | --- | --- |
| Create an agent and tune its prompt, tools and model | [Agents](#2-build-agents) | Describe it in plain language; the app builds the spec |
| Give agents access to Slack, GitHub, a database… | [Connections](#3-connect-services) | Encrypted vault, 130+ built-in connectors |
| Run agents on a schedule, a webhook or an event | [Events & Schedules](#4-automate-and-trigger) | Ten ways a run can start, plus chains between agents |
| See what agents did, what it cost, and what needs you | [Overview](#5-observe-and-govern) | Dashboard, approvals, incidents, memory |
| Point agents at your repos and steer them by goals and KPIs | [Projects](#6-ship-software-with-agents) | Context map, goals, KPIs, task runner, fleet |
| Get help running all of the above | [Companions](#7-companions-the-apps-own-agents) | Athena, Overseer, Curator |
| Extend it | [Plugins](#8-plugins) | Dev Tools, Obsidian Brain, Drive, Twin |

**Why local-first?** Your personas, prompts and credentials never leave your machine unless you explicitly send them. Outbound traffic goes only to the AI providers and third-party services you configure. No cloud account is required.

---

## Tour of the app

The sidebar has two levels: an icon rail of top-level sections and a panel of grouped pages inside each section. The sections below follow the rail from top to bottom, regrouped by the job each one does. Which sections you see depends on your [interface tier](#interface-tiers) and on whether you run a dev build.

### 1. Start here

**Home** is the entry point: a cockpit for what needs attention, a learning area, and guided tours that walk through first-run setup (first agent, first credential, first execution). **Simple Mode** is a reduced interface for non-technical users; see [tiers](#interface-tiers).

Docs: [home](./docs/features/home.md) · [onboarding](./docs/features/onboarding.md) · [simple mode](./docs/features/interface-modes/simple-mode.md)

### 2. Build agents

**Agents** is where personas are created and edited. You describe what you want and the build session asks clarifying questions, then resolves a spec you can refine.

- Persona editor with system prompt, tools, behavioural rules, model and reasoning effort, and a version history with diffs
- **Templates** (under Connections → Templates): adopt a ready-made agent from the catalog, import one from **n8n**, or start from a generated draft
- **Recipes**: reusable, parameterized capabilities you adopt onto a persona
- **Presets**: pre-assembled teams of agents for a common job
- Lab for testing a persona against scenarios, with quality scoring and prompt benchmarking
- Chat tab as an **operations hub**: run, check health, edit prompts and assign tools without leaving the conversation

Docs: [personas](./docs/features/personas/README.md) · [templates](./docs/features/templates/README.md) · [recipes](./docs/features/recipes/README.md) · [operations hub](./docs/features/agents/operations-hub.md)

### 3. Connect services

**Connections** is the credential vault and everything around it.

- **AES-256-GCM** encryption at rest, with the key held in the OS keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **130+ built-in connectors** (Slack, GitHub, Linear, Discord, Jira, Notion, Airtable, PostgreSQL, MongoDB, Stripe, Vercel and more), each with credential health checks and guided setup
- Catalog, **Databases**, a **Dependencies** graph of what uses which credential, and a **Broker**
- Credentials are handed to an execution as environment variables and scrubbed afterwards, never passed as CLI arguments

Docs: [connections](./docs/features/connections/README.md) · [integrations](./docs/features/integrations/README.md)

### 4. Automate and trigger

**Events** is the routing layer. **Schedules** (a calendar overlay from the title bar) holds cron jobs.

- A run can start from a manual click, a cron **schedule**, an inbound **webhook** (`localhost:9420`), an **event** on the bus, a polling check, a **chain** from another persona, a file watcher, the clipboard, app focus, or a composite of these
- **Chain Studio** wires personas together by the signals they emit and listen for
- Live Stream, speed limits (rate limits), dead-letter queue and a test panel for maintaining the event flow
- **Marketplace** for shared events; **automation tools** (n8n, GitHub Actions) for outbound steps

Docs: [events & triggers](./docs/features/events/README.md) · [schedules](./docs/features/schedules.md) · [execution entry points](./docs/features/execution/01-entry-points.md) · [automation tools](./docs/features/automation-tools.md)

### 5. Observe and govern

**Overview** answers "what are my agents doing, and what needs me?"

| Group | Pages |
| --- | --- |
| **Monitoring** | Dashboard (Mission control: vitals, status monitor, leaderboard, self-healing), Activity (every execution with model, tokens and cost), Events |
| **Operations** | Approvals (manual-review queue), Incidents (one triage inbox over seven failure streams), Observability (alerts, health issues, trends, IPC performance), Messages |
| **Memory** | Memories (what agents remember, with dispute and recall controls) and Graph |

Also here: the **Director**, a built-in coach that scores each persona and suggests improvements, and the **Persona Monitor**, a full-screen grid of the whole fleet.

The runtime protects itself: per-run, daily and monthly **budget limits**, **circuit breakers** that disable an unhealthy provider, and a **self-healing** engine that detects and recovers from transient failures. Execution traces record spans, durations and cost.

Docs: [overview](./docs/features/overview/README.md) · [execution](./docs/features/execution/README.md) · [persona monitor](./docs/features/monitor.md) · [Director](./docs/features/companions/overseer/README.md)

### 6. Ship software with agents

**Projects** turns the app from "run some agents" into "run a team on my repository." Register a codebase, map it, define what success means, and let agents work toward it.

| Group | What it is |
| --- | --- |
| **Teams** | Assemble a team from a preset, give it a goal, decompose, assign and run. Moderated multi-persona **deliberations** end in an approved assignment |
| **Goals / KPIs** | KPIs define outcomes; a KPI off its critical line derives goals; goals are what teams advance |
| **Development** | **Lifecycle** (each project's practice: Solo or Team), **Factory** (project readiness and KPI matrix), **Contest** (run several model seats on one brief and keep the winner), **Mastermind** (portfolio view across projects), **Features**, and **Studio** (an app builder, dev builds only) |
| **Browser** | Lets Athena and your personas open and control allow-listed web pages, with each write passing the approval orb |

The supporting tooling lives in **Plugins → Dev Tools**: Context Map (scan a repo into groups and contexts), Task Runner, **Fleet** (observe and steer many Claude Code CLI sessions in one window; dev builds), Workspaces (group projects into an org), and Skills. A **Notepad** (footer toggle) turns notes into dispatched work or goals.

An **App Master** is the accountable agent for one registered project. It can be adopted headlessly and driven from a terminal; see [Headless bridge](./docs/development/headless-bridge.md).

Docs: [Teams & orchestration](./docs/features/teams/README.md) · [Dev Tools](./docs/features/plugins/dev%20tools/README.md) · [notepad](./docs/features/notepad.md) · [browser](./docs/features/browser.md)

### 7. Companions: the app's own agents

**Companions** are three built-in agents, distinct from the personas you create. Each has its own pages and an on/off switch.

| Companion | Role |
| --- | --- |
| **Athena** | The assistant. Plans, builds, remembers and answers across the whole app, by chat or voice, with an orb overlay and guided walkthroughs |
| **Overseer** | Keeper of the fleet. Keeps starred agents running without error and worth what they cost; audits each wave of work. Needs at least one starred agent |
| **Curator** | Keeper of the knowledge registry. Keeps a mapped registry current and applied in the projects that subscribe to it. Needs a workspace with a registry |

Docs: [companions](./docs/features/companions/README.md) · [Athena](./docs/features/companions/athena/README.md) · [Curator](./docs/features/companions/curator/blueprint.md)

### 8. Plugins

Enable plugins from **Plugins**. Each adds a group of pages to the sidebar.

| Plugin | What it gives you |
| --- | --- |
| **Dev Tools** | The codebase tooling described in [section 6](#6-ship-software-with-agents) |
| **Obsidian Brain** | A two-way bridge between agent memory and an Obsidian vault, as plain markdown, optionally backed up to your own Google Drive |
| **Drive** | A sandboxed local file manager for what agents, OCR, signing and exports produce |
| **Twin** | A digital identity (bio, per-channel tone, voice, curated memory) that your agents adopt so they speak as you |

Also in the tree: a built-in **Scraper** that emits change events onto the bus (dev builds), **GitLab** CI/CD export and deployment, and the **Cloud** orchestrator for pushing personas to a remote runtime.

Docs: [plugins](./docs/features/plugins/) · [Twin](./docs/features/plugins/twin.md) · [Drive](./docs/features/plugins/drive/README.md) · [Obsidian Brain](./docs/features/plugins/brain/README.md) · [deployment](./docs/features/deployment/README.md) · [GitLab](./docs/features/gitlab.md)

### 9. Settings and the desktop shell

**Settings** groups into General (account, appearance, data portability, radio, notifications), Connect (API keys for inbound MCP/HTTP access, paired devices, network sharing) and LLM (engine, custom models, limits). Data export and import can carry personas, connectors, twins and Athena's memory between machines; **Sharing** covers bundles, `personas://` deep links and peer-to-peer transfer (needs a full build).

The desktop shell adds a system tray with scheduler pause/resume, native notifications, window-state persistence, a single-instance lock with deep-link routing, an in-footer **Radio**, and an auto-updater via GitHub Releases.

Docs: [settings](./docs/features/settings/README.md) · [sharing](./docs/features/sharing/README.md) · [radio](./docs/features/radio.md) · [navigation](./docs/features/navigation.md)

### Interface tiers

One codebase, three audiences. Each tier is a strict superset of the one before.

| Tier | Label in the app | Audience | Adds |
| --- | --- | --- | --- |
| `starter` | Simple | Non-technical users | Agents, connections, messages, templates |
| `team` (default) | Power | Teams and enterprises | Events, projects and teams, deployment, analytics, scheduling, databases, plugins, companions |
| `builder` | (dev builds) | Developers | Dev-only surfaces, raw JSON editing |

Switch at runtime in **Settings → Appearance → Interface Mode**. Builder is a compile-time gate with no runtime path to it. To build a tier-locked bundle, see [Build tiers](#build-tiers).

---

## How a run works

```
 You define a persona          A trigger fires              The provider returns
 (prompt + tools + creds)      (cron / webhook / event /     structured output
         |                      chain / file / clipboard)           |
         v                              |                         v
  +--------------+               +------v-------+          +-------------+
  | SQLite DB    | ------------> | Rust engine  | -------> | Post-process|
  | (encrypted   |     load      | (Tokio async)|  parse   | (healing,   |
  |  credentials)|               | spawns CLI   |          |  chain,     |
  +--------------+               +--------------+          |  notify)    |
                                        |                  +-------------+
                                 Credentials injected
                                 as env vars, scrubbed
                                 after the run
```

1. **Define.** Create a persona, pick a model, assign tools, attach vault credentials.
2. **Trigger.** Start it by hand, on a schedule, from a webhook or event, or from another persona.
3. **Execute.** The Rust engine spawns the **Claude Code** CLI as a subprocess, streams its output, counts tokens and cost, and writes a trace. Custom or local model endpoints can be configured under Settings → Custom Models (dev builds).
4. **Observe.** Executions land in Overview; approvals and incidents queue for you; healing retries what it safely can.
5. **Deploy (optional).** Push personas to the cloud orchestrator, GitHub Actions, GitLab CI/CD, or n8n.

### Data flow and privacy

| Data | Where it goes | Encryption |
|------|--------------|------------|
| Persona prompts and config | Local SQLite | Plaintext (not secrets) |
| Credential values | Local SQLite | AES-256-GCM (key in OS keyring) |
| Execution output | Local SQLite + log files | Plaintext |
| AI provider requests | Provider API (HTTPS) | TLS in transit |
| Connector API calls | Third-party service (HTTPS) | TLS in transit |
| Error reports (opt-in) | Sentry | PII stripped before send |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | [Tauri 2](https://v2.tauri.app/) |
| Backend | Rust, Tokio, SQLite (r2d2 pool) |
| Frontend | React 19, TypeScript 6, Vite 8 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 |
| Animation | Framer Motion |
| Visualization | Recharts, React Flow (XYFlow) |
| Encryption | AES-GCM, OS keyring |
| Networking | Reqwest (rustls-tls) |

---

## Prerequisites

| Dependency | Version | Check command |
|-----------|---------|---------------|
| [Node.js](https://nodejs.org/) | >= 20 | `node --version` |
| [Rust](https://www.rust-lang.org/tools/install) | via `rustup`; the repo pins its toolchain in `rust-toolchain.toml` | `rustc --version` |
| WebView2 Runtime | bundled with Windows 10+ | none |
| C++ Build Tools | MSVC (Visual Studio) | none |

### Windows setup

1. **Install Node.js**:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

2. **Install Rust** via rustup, then **restart your terminal** so `cargo` and `rustc` are on your PATH:

   ```powershell
   winget install Rustlang.Rustup
   rustc --version
   cargo --version
   ```

3. **Install Visual Studio C++ Build Tools**: download [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and select the **"Desktop development with C++"** workload. It provides the MSVC compiler and Windows SDK that Tauri needs.

4. **Install LLVM/Clang** (required on Windows ARM64 for the `ring` crypto crate):

   ```powershell
   winget install LLVM.LLVM
   ```

   Make sure `C:\Program Files\LLVM\bin` is on your PATH, and restart your terminal.

5. **Run from a Developer shell.** Launch your terminal from **"Developer PowerShell for VS"** so `cl.exe`, `INCLUDE` and `LIB` are set, or load the environment into the current session:

   ```powershell
   & "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\Launch-VsDevShell.ps1" -Arch arm64
   ```

### macOS setup

```bash
xcode-select --install
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart your terminal, then verify with `node --version && rustc --version && cargo --version`.

### Linux setup (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

---

## Getting started

```bash
npm install                  # 1. frontend dependencies
npm run tauri:dev:lite       # 2. daily-driver dev mode (desktop features, no ML/P2P)
```

On Windows, the helper script avoids the usual startup problems (clang missing from PATH, a stale app process, a stale Vite process):

```powershell
.\scripts\desktop-dev.ps1 -Restart      # run the app
.\scripts\desktop-dev.ps1 -CheckOnly    # preflight only
```

> The first run compiles all Rust dependencies, which takes several minutes. Later builds are incremental.

**Lite or full?** Use `tauri:dev:lite` for almost everything: UI, IPC wiring, schema, triggers, recipes, observability. Switch to `npm run tauri:dev` (full) only when you are working on the vector knowledge base, embeddings, ONNX inference, or P2P, which are compiled only in the full build.

### Build tiers

To build a tier-locked variant (higher-tier features are tree-shaken from the bundle):

```bash
npm run build:starter    # Simple tier only
npm run build:team       # Simple + Power
npm run build:builder    # everything (default)
```

For desktop installers:

```bash
VITE_APP_TIER=starter npm run tauri build   # Simple installer
VITE_APP_TIER=team npm run tauri build      # Power installer
npm run tauri build                         # Builder installer (default)
```

When `VITE_APP_TIER` is unset, the build includes every tier and users switch at runtime.

### Common scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Vite dev server only (port 1420), frontend without Tauri |
| `npm run tauri:dev` / `:lite` | Tauri dev mode, full or lite feature set |
| `npm run tauri:dev:test` | Lite dev mode plus the test-automation HTTP server (`:17320`) and DevInspector |
| `npm run build` | TypeScript check + Vite production build |
| `npm run tauri:build` | Full installer (all targets, `desktop-full`) |
| `npm run tauri:build:lite` | NSIS-only installer with `desktop` features |
| `npm run tauri:build:stable` | NSIS + MSI installer for a Windows release |
| `npm run check` | The full pre-push gate chain: project checks, type check, ESLint and the golden-path census |
| `npm run gate` | Fast per-commit check (tsc, changed-file ESLint, census) from a warm local daemon |
| `npm run test` | Vitest |
| `npm run test:rust` | Rust unit tests (use this on Windows rather than raw `cargo test`) |
| `npm run check:tiers` | Compile-check all three frontend tiers |
| `npm run analyze` / `check:budget` | Bundle treemap / chunk-size budget |
| `npm run clean:rust` / `clean:ort` | Full Rust wipe / surgical ONNX Runtime cache clean |

Build internals (ARM64 vs x64 on Windows, the codegen pipeline, profiles, ONNX bundling) are in **[docs/development/build.md](./docs/development/build.md)**; Android setup is in **[docs/development/android-build.md](./docs/development/android-build.md)**.

### DevInspector: click a component, copy its source path

A dev-only overlay for grabbing a component's `src/.../File.tsx:line` and pasting it into an AI coding CLI. Off by default and never present in production builds.

```bash
npm run tauri:dev:test        # full app + test bridge, source mapping on
npm run dev:inspect           # frontend only, faster iteration
```

In the app press **`;`** then **`i`** to arm it. Hover highlights an element and pins a path chip; **click** copies the call-site path, **Alt+click** copies the element, **Esc** exits. See [docs/development/dev-inspector.md](./docs/development/dev-inspector.md).

### Driving the app from a terminal

The running app exposes a loopback **dev-tools bridge** for creating projects, scanning codebases, adopting an App Master and writing results back, with no GUI. The full route reference is in **[docs/development/headless-bridge.md](./docs/development/headless-bridge.md)**.

---

## Repository layout

```
personas/
├── src/                        # Frontend (React + TypeScript)
│   ├── api/                    # Tauri IPC bridge (typed command wrappers)
│   ├── features/               # One folder per product surface
│   │   ├── agents/ personas/   #   persona builder and editor
│   │   ├── templates/          #   templates, recipes, design reviews
│   │   ├── vault/              #   credentials and connectors (the "Connections" section)
│   │   ├── triggers/ schedules/#   events, webhooks, cron
│   │   ├── overview/           #   observability, approvals, incidents, memory
│   │   ├── teams/               #   projects, teams, goals, KPIs, factory, contest
│   │   ├── companions/         #   Athena, Overseer, Curator
│   │   ├── plugins/            #   dev-tools, obsidian-brain, drive, twin, fleet, gitlab, radio
│   │   ├── browser/ studio/ notepad/ scraper/ cloud/ fleet/
│   │   └── home/ onboarding/ settings/ shared/
│   ├── i18n/                   # Localization (locales, codegen, useTranslation)
│   ├── lib/                    # Business logic; bindings/ holds Rust-generated TS types
│   ├── stores/                 # Zustand state (slice pattern)
│   └── styles/                 # Global CSS and themes
│
├── src-tauri/                  # Backend (Rust)
│   ├── src/commands/           # Tauri command handlers (the IPC surface)
│   ├── src/engine/             # Execution engine, scheduler, healing, event bus
│   ├── db/                     # SQLite schema, migrations, repos (extracted crate)
│   └── tauri.conf.json
│
├── docs/                       # Feature, architecture, development docs
├── scripts/                    # Codegen, census, i18n, templates, connector catalog
├── cloud-worker/ supabase/ sdk/ evals/ tests/
└── package.json
```

The system map, with the runtime layers and which command module owns what, is [docs/architecture/overview.md](./docs/architecture/overview.md) and [docs/architecture/codebase-map.md](./docs/architecture/codebase-map.md).

---

## Internationalization (i18n)

The app ships in **14 languages**: English (source of truth) plus Arabic, Bengali, Czech, German, Spanish, French, Hindi, Indonesian, Japanese, Korean, Russian, Vietnamese and Simplified Chinese.

- `src/i18n/locales/en.json` is the only file you edit for new strings. Each section of every locale is lazy-loaded as its own chunk, and a missing key falls back to English at runtime.
- `src/i18n/section-locales/` and `src/i18n/generated/types.ts` are generated on `predev` / `prebuild`. Do not edit them by hand.
- Strings are looked up through `useTranslation()`; the backend sends language-agnostic status tokens that the frontend maps in `src/i18n/tokenMaps.ts`.

```typescript
import { useTranslation } from '@/i18n/useTranslation';

function MyComponent() {
  const { t, tx } = useTranslation();
  return (
    <div>
      <h1>{t.common.save}</h1>
      <p>{tx(t.common.agent_count_other, { count: 5 })}</p>
    </div>
  );
}
```

Hardcoded English in JSX is a bug (ESLint `custom/no-hardcoded-jsx-text`), and a key added to `en.json` must be translated into all 13 other locales in the same change.

```bash
npm run check:i18n                       # CI gate: keysets match en.json, no stale keys
npm run check:i18n:strict                # also fails on missing translations
node scripts/i18n/check-coverage.mjs     # coverage report
```

The full pipeline and translation workflow is in [docs/i18n](./docs/i18n/contract.md) and `.claude/rules/i18n.md`.

---

## Troubleshooting

**`failed to run 'cargo metadata'` / `program not found`.** Rust is not installed. Run `winget install Rustlang.Rustup` (Windows) or install `rustup`, then restart your terminal.

**`failed to find tool "clang": program not found` (Windows ARM64).** The `ring` crate needs Clang for ARM64 assembly: `winget install LLVM.LLVM`, then restart your terminal.

**`Cannot open include file: 'windows.h'`.** The MSVC environment is not loaded. Build from **Developer PowerShell for VS**.

**`Port 1420 is already in use`.** A previous `tauri dev` died mid-startup and orphaned Vite. Find it with `netstat -ano | findstr :1420` and stop that PID.

**`lld-link: machine type x64 conflicts with arm64`.** Host-triple drift, usually the mislabeled ONNX Runtime download. Run `npm run ensure:ort-cache`; if it persists, `npm run clean:ort`.

**`cargo test` exits silently with code 127 on Windows.** That is the loader failing on a missing manifest, not a failing test. Use `npm run test:rust`.

**The first build is very slow.** Expected: Cargo compiles 200+ crates the first time. Later builds are incremental.

More in [docs/development/build.md](./docs/development/build.md) and [docs/devops/guide-desktop-troubleshooting.md](./docs/devops/guide-desktop-troubleshooting.md).

---

## Security

- Credentials are encrypted with **AES-256-GCM** before they reach the database; keys live in the OS keyring, never in plaintext on disk
- Credentials reach child processes as environment variables (not CLI arguments) and are scrubbed after the run
- Sensitive values are not written to logs
- External traffic is HTTPS through rustls
- The dev-tools bridge binds to loopback and requires a token

Architecture details: [docs/architecture](./docs/architecture/README.md). Please do not file security issues publicly; contact the maintainers directly through the [repository](https://github.com/xkazm04/personas).

---

## For contributors

- **[docs/README.md](./docs/README.md)**: documentation entry point and where each kind of doc belongs
- **[docs/features](./docs/features/README.md)**: what each feature does today, one folder per area
- **[docs/architecture](./docs/architecture/README.md)**: system overview, frontend/backend boundaries, execution path, data layer, security model
- **[docs/development](./docs/development/README.md)**: the day-to-day loop (running, testing, debugging)
- **[CONTRIBUTING.md](./CONTRIBUTING.md)**: coding standards, PR workflow, commit style
- **[AGENTS.md](./AGENTS.md)** and **[CLAUDE.md](./CLAUDE.md)**: instructions for AI coding agents working in this repo
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** · **[CHANGELOG.md](./CHANGELOG.md)**

Before opening a PR, run `npm run check`, `npm run test`, and (if Rust changed) `cargo clippy` and `npm run test:rust`. Good first issues are labelled `good first issue` on the [issue tracker](https://github.com/xkazm04/personas/issues); translation work is a friendly place to start.

## License

[MIT](./LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
