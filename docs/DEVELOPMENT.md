# Development Guide

This is the day-to-day reference for working on Personas Desktop locally. If you're setting up for the first time, start with the [README](../README.md#prerequisites) for platform-specific prerequisites, then come back here.

For the big-picture system overview, see [ARCHITECTURE.md](../ARCHITECTURE.md). For contribution rules, see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Quick Reference

```bash
# First-time setup
npm install

# Inner dev loop — Tauri desktop mode
npm run tauri dev

# Frontend-only (no Tauri, faster HMR for pure UI work)
npm run dev                          # http://localhost:1420

# Type checking and linting
npm run check                        # tsc --noEmit + eslint
npm run lint                         # eslint only

# Tests
npm run test                         # Vitest unit tests
npm run test:watch                   # Vitest in watch mode
npm run test:e2e:cli                 # End-to-end CLI tests
npm run test:integration:cli         # Integration tests

# Rust side
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo build --release

# Production builds
npm run build                        # Frontend build (all tiers)
npm run tauri build                  # Full desktop installer
```

---

## Project Structure (at a glance)

```
personas/
├── src/                    # Frontend (React + TypeScript)
├── src-tauri/              # Backend (Rust + Tauri 2)
├── scripts/                # Build, i18n, check-budget, etc.
├── docs/                   # This directory — developer docs
├── .github/workflows/      # CI pipeline definitions
├── ARCHITECTURE.md         # Top-level system overview
├── CONTRIBUTING.md         # How to contribute
├── README.md               # User-facing intro
└── package.json
```

The full layout with file counts is in [ARCHITECTURE.md](../ARCHITECTURE.md#top-level-shape).

---

## Running Locally

### Recommended — the helper script (Windows)

```powershell
.\scripts\desktop-dev.ps1 -Restart
```

This script handles the three common Windows pitfalls: missing clang on PATH, stale app process, and stale Vite process. Use `-CheckOnly` to preflight without running.

### Recommended — raw command (macOS / Linux)

```bash
npm run tauri dev
```

The first invocation builds ~200+ Rust crates and can take several minutes. Subsequent builds are incremental and much faster.

### Frontend-only mode

If you're only touching React components and don't need the Rust backend, `npm run dev` gives you pure Vite with hot-module reload. The IPC wrapper short-circuits to a mock when there is no Tauri runtime, so most UI flows still work.

---

## The Edit-Compile-Test Loop

### Frontend changes

1. Save a `.ts` or `.tsx` file — Vite hot-reloads automatically.
2. If TypeScript complains, the overlay surfaces it in the dev window.
3. Before committing, run `npm run check` to catch issues HMR doesn't show (e.g. unused imports, strict null checks on paths you didn't touch).

### Rust changes

1. Save a `.rs` file — Tauri rebuilds the backend and restarts the app.
2. Watch the terminal for `error[E...]` messages; Cargo's diagnostics are usually precise enough to fix in place.
3. Before committing, run `cargo clippy --all-targets -- -D warnings` — CI denies warnings, and it's much faster to catch them locally.

### Changing types that cross the IPC boundary

Types shared between Rust and TypeScript are generated, not hand-written. If you add or modify a type:

1. Edit the Rust struct in `src-tauri/src/...`. Make sure it derives `TS`, `Serialize`, `Deserialize` and has `#[ts(export)]` + `#[serde(rename_all = "camelCase")]`.
2. Build the backend — `ts-rs` regenerates `src/lib/bindings/<Type>.ts` automatically.
3. Import the new binding in your frontend code.
4. If CI fails on "bindings drift", re-run the build locally and commit the regenerated files.

---

## Testing

### Vitest (frontend)

- Unit tests live alongside source files as `*.test.ts(x)`.
- Use `@testing-library/react` for component rendering. Prefer querying by role or accessible name over `getByTestId`.
- Zustand stores can be reset between tests by calling the slice's reset action in a `beforeEach`.

### Cargo test (backend)

- Unit tests live in `#[cfg(test)] mod tests { ... }` blocks at the bottom of each module.
- Integration tests that need a real SQLite database use `tempfile::NamedTempFile` to create an ephemeral database file per test.
- For tests that spawn a provider CLI, gate them behind `#[ignore]` so they only run when explicitly requested (`cargo test -- --ignored`).

### Running a single test

```bash
# Vitest — by file path or test name
npm run test -- src/features/agents/foo.test.ts
npm run test -- --reporter=verbose -t "renders the editor"

# Cargo — by path substring
cargo test --package personas-desktop -- engine::runner::tests
```

---

## Internationalization Workflow

Every user-facing string must go through `t.section.key`. The ESLint rule `custom/no-hardcoded-jsx-text` catches regressions, but it's faster to build the habit of never typing raw English in JSX.

When you add a new string:

1. Open `src/i18n/en.ts`.
2. Find the appropriate section (`common`, `agents`, `vault`, etc.) or add a new one.
3. Add the key with a short translator comment explaining context:
   ```typescript
   // Button label in the agent editor toolbar — keep short (1-2 words)
   duplicate_agent: "Duplicate",
   ```
4. Use it: `t.agents.duplicate_agent`.
5. **Do not** add to non-English locale files. They fall back to English automatically via deep merge, and translation teams handle localization separately.

See the [README i18n section](../README.md#internationalization-i18n) for the full translator pipeline (extract → translate → merge → verify).

---

## Debugging

### Frontend

- **Chrome DevTools** — right-click inside the Tauri window and choose "Inspect Element". All the usual DevTools features work.
- **React DevTools** — install the standalone app (`npm install -g react-devtools`) and launch it; the WebView will connect automatically.
- **Zustand state** — every slice lives on the global store. In the console, `window.__store__?.getState()` (if exposed in dev) shows the current snapshot.

### Backend

- **Logs** — the Rust backend uses `tracing`. In dev mode, log output streams to the terminal where `npm run tauri dev` is running. Adjust verbosity with `RUST_LOG=debug`.
- **Per-execution logs** — every agent run writes a log file under the app-data directory. On Windows that's `%APPDATA%\com.personas.desktop\logs\`.
- **Breakpoints** — `rust-analyzer` in VS Code can attach a debugger to the running Tauri process. See [docs/devops/guide-desktop-troubleshooting.md](./devops/guide-desktop-troubleshooting.md) for the full setup.

### IPC tracing

If you suspect a command is misbehaving, add a `tracing::info!` at the top of the handler and another before the return. The logs will show you exactly when the call landed and what it returned.

---

## Build Tiers

The app has three audience tiers (Starter, Team, Builder) that tree-shake higher-tier features at build time. Unless you're working specifically on tier gating, use the default — every tier is built, and users switch at runtime via Settings.

```bash
npm run build:starter    # Only Starter features
npm run build:team       # Starter + Team
npm run build:builder    # All features (default)
```

For Tauri installers with a specific tier, set `VITE_APP_TIER`:

```bash
VITE_APP_TIER=starter npm run tauri build
```

---

## Common Tasks

### Add a new Tauri command

1. Write the handler in the appropriate `src-tauri/src/commands/<domain>/` file.
2. Register it in the `invoke_handler!` macro call in `src-tauri/src/lib.rs`.
3. Run `node scripts/generate-command-names.mjs` (runs automatically via `predev`/`prebuild`) to regenerate the TypeScript command-name constants.
4. Add a thin wrapper in `src/api/<domain>.ts` that calls `invokeWithTimeout`.
5. Use it from the feature module.

### Add a new connector to the vault

Connectors are defined as metadata + an auth strategy + optional health check. See `src-tauri/src/db/builtin_connectors.rs` for existing examples. The frontend catalog pulls from the Rust source, so once you register a connector it shows up in the UI automatically.

### Add a new integration (GitLab-style)

The `.claude/CLAUDE.md` file has a 9-step checklist under "Adding a New Integration" that covers the whole surface (Rust module, types, commands, AppState, errors, frontend API, store slice, bindings, sidebar).

### Investigate a failing CI run

1. Open the PR, click the failing check, and read the last ~50 lines of the job log.
2. Reproduce locally with the exact command from the workflow file (`.github/workflows/ci.yml`).
3. If it's platform-specific, spin up a GitHub Codespace or a matching VM — don't guess.

---

## Troubleshooting

Common issues and fixes live in [docs/devops/guide-desktop-troubleshooting.md](./devops/guide-desktop-troubleshooting.md). The highlights:

- **`cargo metadata` fails** — Rust isn't installed or isn't on PATH. Restart your terminal.
- **`clang not found` on Windows ARM64** — install LLVM via `winget install LLVM.LLVM`.
- **`windows.h` not found** — run from a Developer Command Prompt for VS so MSVC env vars are set.
- **First build is slow** — expected, Cargo is compiling ~200 crates. Subsequent builds are fast.
- **App window is blank** — Vite isn't running. Stop and restart with `-Restart`.
- **IPC calls hang** — check that `invokeWithTimeout` is being used (raw `invoke` doesn't time out).

---

## Getting Help

- **Small questions** — open a [Discussion](https://github.com/xkazm04/personas/discussions).
- **Bugs** — open an issue with the Bug Report template.
- **Security issues** — see [SECURITY.md](../SECURITY.md). Do not file a public issue.
