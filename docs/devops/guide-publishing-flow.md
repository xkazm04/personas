# Publishing Flow

How Personas Desktop packages are built, signed, and delivered to users across Windows, macOS, and Linux.

> ### ⚠ Current state (verified 2026-07-30): the pipeline has never published a release
>
> `gh api repos/xkazm04/personas/releases` returns **0 releases**. Tags `v0.1.6`,
> `v0.2.0`, `v0.4.0`, `v1.0.0`, `v1.1.0` exist on origin, but **every** Release
> workflow run to date has failed — the bump/tag job succeeds and pushes the tag,
> then the platform builds fail, so no GitHub Release is ever created.
>
> Consequences to be aware of before reading the rest of this document as
> operational truth:
>
> - The updater endpoint `.../releases/latest/download/latest.json` **404s**. Every
>   installed app's update check fails silently (`useAutoUpdater` swallows errors by
>   design), so no user has ever received an update.
> - Version files on master are at `1.1.0` and a `v1.1.0` tag already exists, so the
>   next release run bumps past it normally — but see the tag-collision guard.
> - A junk tag **`v0.1.NaN.1`** is on origin, left by the pre-fix bump bug (now
>   guarded by the `Number.isNaN` check in `bump-version.mjs`). It sorts oddly in
>   `git tag --sort=-v:refname` and should be deleted.
> - The most recent failure (2026-07-16, run `29533053634`) was a genuine Rust
>   compile error on a feature branch — ``&Arc<Vec<NoteEntry>>` is not an iterator``
>   in `commands::obsidian_brain::graph` — not a pipeline defect.
>
> Before trusting a release run, build locally first (see **Ad-Hoc Local Builds**) so
> a compile error is caught in minutes rather than after 45 minutes × 4 runners.

---

## Architecture

```
Maintainer runs the Release workflow (workflow_dispatch on master)
         |
         v
  [bump-version]  ── conventional-commit bump in 4 files, tags vX.Y.Z
         |          (also: tag-collision guard, changelog generation)
         v
  [frontend]  ── builds dist/ ONCE, uploads as a shared artifact
         |
         v
  [build]  ── 4 parallel GitHub Actions runners (download dist/)
    ├── Windows x64     -->  .msi, .nsis.exe
    ├── Windows ARM64   -->  .msi, .nsis.exe
    ├── macOS universal -->  .dmg
    └── Linux x64       -->  .deb, .AppImage
         |
         v
  [updater-manifest]  ── assembles latest.json from .sig files
         |
         v
  GitHub Release (vX.Y.Z)  ── all installers + latest.json
         |
         v
  Running app checks latest.json every 6 hours
         |
         v
  User sees UpdateBanner --> clicks "Install & Restart"
```

---

## Trigger

**`workflow_dispatch` is the primary release path.** Development lands directly on
`master` without PRs, so the `pull_request: [closed]` trigger — which is still wired
and still gated on `github.event.pull_request.merged == true` — effectively never
fires on the real workflow. Releasing is a deliberate manual act: run the **Release**
workflow from the Actions tab (or `gh workflow run release.yml`).

---

## Version Bumping

**Script**: `scripts/bump-version.mjs`

The bump is **driven by conventional commits since the last tag**, not a fixed patch
increment:

| Commit since last tag | Bump |
|---|---|
| `BREAKING CHANGE:` or `type(scope)!:` | major |
| `feat:` / `feat(scope):` | minor |
| anything else (`fix:`, `chore:`, …) | patch |

On each triggered run, the pipeline:

1. Reads the current version from `package.json` (source of truth), stripping any
   pre-release suffix before parsing
2. Computes the bump type from `getCommitsSinceLastTag()`
3. Writes the new version to **four** files:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock` (the `personas-desktop` package entry — a targeted regex
     bump, since the bump job has no Rust toolchain. Skipping it would permanently
     lag master's lockfile and break `--locked` builds.)
4. **Guards against tag collision** — fails in seconds with an actionable message if
   `vX.Y.Z` already exists locally or on origin, instead of failing after 45 minutes
   of platform builds. A collision means the version files on master lag the tag
   history; fix by aligning them to `git tag --sort=-v:refname | head -1`.
5. Generates release notes via `scripts/generate-changelog.mjs` (groups commits;
   `chore/ci/test/style/build` are filtered out of user-facing notes)
6. Commits `chore: bump version to X.Y.Z`, tags `vX.Y.Z`, pushes commit + tag

---

## Frontend Job

Before the platform matrix runs, a single `frontend` job on `ubuntu-latest` runs
`npm run build` once and uploads `dist/` as a 1-day artifact. Each of the four
platform runners downloads it and passes `beforeBuildCommand: ""` to `tauri-action`,
so the web bundle is built once rather than four times. `SENTRY_DSN` /
`VITE_SENTRY_DSN` are injected here.

---

## Build Matrix

| Target | Runner | Rust Target | Artifacts |
|--------|--------|-------------|-----------|
| Windows x64 | `windows-latest` | `x86_64-pc-windows-msvc` | `.msi`, `.nsis.exe` |
| Windows ARM64 | `windows-latest` | `aarch64-pc-windows-msvc` | `.msi`, `.nsis.exe` |
| macOS universal | `macos-latest` | `universal-apple-darwin` | `.dmg` |
| Linux x64 | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.deb`, `.AppImage` |

Each runner uses the official `tauri-apps/tauri-action@v0` action which:
- Builds the Rust backend and React frontend
- Packages platform-specific installers
- Signs updater bundles with the Ed25519 private key
- Uploads all artifacts to the GitHub Release

### Platform-specific build steps

- **Linux**: installs `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libgtk-3-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`
- **macOS**: adds both `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets for universal binary

### Build caching

Every matrix leg runs `sccache` (`RUSTC_WRAPPER=sccache`, GHA backend) plus
`swatinem/rust-cache@v2` scoped to `src-tauri -> target`.

> The rust-cache **`key` is set to the Rust target triple, and must stay that way.**
> Both Windows legs run on `windows-latest`; without a per-target key whichever arch
> builds first poisons `target/debug/deps/` with arch-specific rlibs (e.g. `ort-sys`
> x64 objects) and the second arch dies at link time with
> `machine type x64 conflicts with arm64`.

### Post-build verification steps

| Step | Runs on | What it guards |
|---|---|---|
| `verify-onnxruntime-bundling.mjs --target <triple>` | both Windows legs | Linking-aware ORT check — reads the exe's PE import table; iff the exe imports `onnxruntime.dll`, that DLL must be bundled beside it. Catches a silent switch to `load-dynamic` that would boot-crash users with "ONNX Runtime binary not found". |
| `binary-size-report.mjs --target <triple> --budget 100` | windows-x64 only | Fails the release if any installer exceeds 100 MB. |
| Sentry source-map upload | linux-x64 only | Creates/finalizes the Sentry release and uploads `dist/` source maps. Skipped silently if `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` are unset. |

---

## Signing

Tauri 2 uses Ed25519 signatures to verify update integrity. Without valid signatures, the updater refuses to install.

### Key locations

| Item | Location |
|------|----------|
| Private key | GitHub Secret: `TAURI_SIGNING_PRIVATE_KEY` |
| Private key password | GitHub Secret: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Public key | `src-tauri/tauri.conf.json` under `plugins.updater.pubkey` |
| Local backup | `~/.tauri/personas.key` (developer machine only) |

### How signing works during build

1. `tauri-action` reads `TAURI_SIGNING_PRIVATE_KEY` from the environment
2. For each updater bundle (`.msi.zip`, `.app.tar.gz`, `.AppImage.tar.gz`), it generates a `.sig` file
3. Both the bundle and `.sig` are uploaded to the GitHub Release
4. The `updater-manifest` job reads the `.sig` contents and embeds them in `latest.json`

### Regenerating keys

If keys are lost, generate a new pair:

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/personas.key -p 'YOUR_PASSWORD' --ci --force
```

Then update `plugins.updater.pubkey` in `tauri.conf.json` and both GitHub secrets.

> **Warning**: Changing the public key means users on older versions cannot auto-update to the new version (signature mismatch). They must download the new version manually.

---

## Updater Manifest (latest.json)

After all 4 builds complete, the `updater-manifest` job assembles `latest.json` and uploads it to the release.

### Format

```json
{
  "version": "0.1.1",
  "notes": "Release notes from GitHub Release body.",
  "pub_date": "2026-02-19T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/xkazm04/personas/releases/download/v0.1.1/Personas_0.1.1_x64_en-US.msi.zip",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVy..."
    },
    "windows-aarch64": {
      "url": "https://...",
      "signature": "..."
    },
    "darwin-universal": {
      "url": "https://...Personas.app.tar.gz",
      "signature": "..."
    },
    "darwin-x86_64": {
      "url": "https://...Personas.app.tar.gz",
      "signature": "..."
    },
    "darwin-aarch64": {
      "url": "https://...Personas.app.tar.gz",
      "signature": "..."
    },
    "linux-x86_64": {
      "url": "https://...Personas_0.1.1_amd64.AppImage.tar.gz",
      "signature": "..."
    }
  }
}
```

### How the app finds it

The updater endpoint is configured in `src-tauri/tauri.conf.json`:

```
https://github.com/xkazm04/personas/releases/latest/download/latest.json
```

GitHub automatically resolves `/releases/latest/download/<filename>` to the most recent non-draft, non-prerelease release's asset with that name.

### Platform keys

The Tauri updater matches the running platform to a key in the `platforms` object:

| Running on | Key checked |
|-----------|-------------|
| Windows x64 | `windows-x86_64` |
| Windows ARM64 | `windows-aarch64` |
| macOS Intel | `darwin-x86_64` |
| macOS Apple Silicon | `darwin-aarch64` |
| macOS (universal) | `darwin-universal` |
| Linux x64 | `linux-x86_64` |

The macOS entries all point to the same universal binary URL.

---

## In-App Update Flow

### Automatic checking

- **Hook**: `src/hooks/utility/data/useAutoUpdater.ts`
- Checks 5 seconds after app launch, then every 6 hours
- Calls the Tauri updater plugin's `check()` function
- Silently ignores errors (endpoint may not exist for dev builds)

### User notification

- **Component**: `src/features/shared/components/feedback/UpdateBanner.tsx`
- Animated banner at the top of the app
- Shows new version number and truncated release notes (120 chars)
- Two buttons: **"Install & Restart"** and **"Dismiss"**

### Install process

1. User clicks "Install & Restart"
2. Tauri downloads the platform-specific updater bundle from the URL in `latest.json`
3. Verifies the Ed25519 signature against the public key in `tauri.conf.json`
4. Installs the update (replaces the current binary)
5. Restarts the app

### Version display

The current app version is shown at the bottom of the sidebar (Level 1 icon strip) as `v0.1.0`. This reads from `tauri.conf.json` at runtime via the `getVersion()` API from `@tauri-apps/api/app`.

---

## macOS Distribution Notes

Builds are currently **unsigned** (no Apple Developer certificate). This means:

- First launch: macOS Gatekeeper blocks the app
- User must right-click the app and select **"Open"** to bypass
- Subsequent launches work normally

To enable seamless launches, enroll in the Apple Developer Program ($99/year) and add these GitHub secrets:

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character team identifier |

Then update the `tauri-action` step in `release.yml` to pass these as environment variables.

---

## GitHub Secrets Reference

| Secret | Purpose | Required |
|--------|---------|----------|
| `TAURI_SIGNING_PRIVATE_KEY` | Ed25519 private key for update signing | Yes |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the private key | Yes |
| `APPLE_CERTIFICATE` | macOS code signing certificate | No (future) |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password | No (future) |
| `APPLE_SIGNING_IDENTITY` | Signing identity string | No (future) |
| `APPLE_ID` | Apple ID for notarization | No (future) |
| `APPLE_PASSWORD` | App-specific password | No (future) |
| `APPLE_TEAM_ID` | Apple Developer Team ID | No (future) |

---

## Key Files

| File | Role |
|------|------|
| `.github/workflows/release.yml` | CI/CD pipeline definition |
| `scripts/bump-version.mjs` | Patch version bumper (3 files) |
| `src-tauri/tauri.conf.json` | Updater pubkey, bundle config, endpoints |
| `src-tauri/capabilities/default.json` | Tauri permissions (includes `core:app:default`) |
| `.github/workflows/installer-test.yml` | Post-release installer acceptance (Windows x64/arm64, macOS, Linux) |
| `scripts/generate-changelog.mjs` | Release-notes generator (conventional commits since last tag) |
| `scripts/verify-onnxruntime-bundling.mjs` | Linking-aware ORT bundling gate (Windows) |
| `scripts/binary-size-report.mjs` | Installer size report + 100 MB CI budget |
| `scripts/check-tauri-configs.mjs` | Validates the three Tauri config files agree |
| `scripts/ensure-ort-cache.mjs` | Pre-build ORT cache arch guard (`pretauri:build`/`pretauri:dev`) |
| `scripts/test-installer.ps1` | Local/CI installer acceptance test (**destructive — see below**) |
| `src/hooks/utility/data/useAutoUpdater.ts` | Frontend update checking logic |
| `src/features/shared/chrome/UpdateBanner.tsx` | Update notification UI |
| `src/features/shared/chrome/sidebar/Sidebar.tsx` | Version display |
| `.env.example` | Environment variable documentation |

---

## Ad-Hoc Local Builds

When you need a production installer without going through CI (e.g., for manual testing or a quick demo).

### Build Profiles

The project supports multiple build configurations via Cargo profiles and Tauri feature flags. Choose based on your situation:

| Command | Features | Bundles | Build Time | Use Case |
|---------|----------|---------|------------|----------|
| `npm run tauri:build` | `desktop-full` (ml + p2p) | NSIS + MSI | ~27 min | CI / production release |
| `npm run tauri:build:lite` | `desktop` (no ml/p2p) | NSIS only | ~20 min | Quick local testing, UI work |
| `npm run tauri:build:stable` | `desktop-full` | NSIS + MSI | ~30 min | Milestone builds (explicit config) |
| `npx tauri build` | `desktop-full` (from tauri.conf.json) | NSIS + MSI | ~27 min | Default, same as CI |

> Build times measured 2026-07-30 on a warm cache (Windows 11, `npm run tauri:build`,
> v1.1.0): **24m40s** for the Rust release profile plus ~2 min for WiX + makensis
> bundling. The older "~10-15 min" figures in this doc were stale. A cold cache is
> considerably slower. `pretauri:build` also runs `ensure-ort-cache.mjs` first
> (seconds when the cache is already correct).

### Feature Flag Architecture

```
desktop-full          ← CI and production builds use this
├── desktop           ← Core desktop: UI, tray, updater, clipboard, keyring, etc.
│   ├── tauri/tray-icon
│   ├── arboard, notify, keyring, which, xcap, image
│   └── tauri-plugin-{window-state, updater, single-instance}
├── ml                ← Vector Knowledge Base (ONNX, embeddings)
│   ├── sqlite-vec
│   ├── fastembed
│   └── ort (ONNX Runtime)
└── p2p               ← LAN Discovery & Transport (Invisible Apps)
    ├── ed25519-dalek, bs58
    ├── mdns-sd, quinn
    └── rcgen, rmp-serde
```

The `desktop` feature includes all 186+ desktop-specific code gates. The `desktop-full` feature adds `ml` and `p2p` on top. When building with `desktop` alone (lite mode), ML-powered knowledge base search and P2P LAN discovery are disabled, but all UI, triggers, execution engine, vault, and observability features work normally.

### Cargo Release Profiles

| Profile | Command | LTO | Codegen Units | Strip | Use Case |
|---------|---------|-----|---------------|-------|----------|
| `release` | `cargo tauri build` | thin | 2 | yes | Daily builds (default) |
| `stable` | `cargo tauri build --profile stable` | full | 1 | yes | Milestone releases (~20% slower build, ~2% smaller binary) |
| `ci` | `cargo build --profile ci` | thin | 4 | no | CI test + clippy (faster, keeps debug symbols) |
| `dev-release` | `cargo build --profile dev-release` | thin | inherited | no | Fast local perf testing (~3x faster than release) |

### Combining Flags

You can mix features and profiles for specific scenarios:

```bash
# Lite build with stable profile (smallest possible binary)
npx tauri build --config src-tauri/tauri.lite.conf.json -- --profile stable

# Full build, NSIS only (skip MSI generation)
npx tauri build --bundles nsis

# Lite build for quick UI testing
npm run tauri:build:lite

# Dev mode with lite features (faster iteration)
npm run tauri:dev:lite
```

### Config Override Files

| File | Features | Bundles | Purpose |
|------|----------|---------|---------|
| `src-tauri/tauri.conf.json` | `desktop-full` | all | Base config (CI/production) |
| `src-tauri/tauri.lite.conf.json` | `desktop` | NSIS only | Fast local builds |
| `src-tauri/tauri.stable.conf.json` | `desktop-full` | NSIS + MSI | Milestone releases |

These override files are merged on top of the base config via the `--config` flag.

### Output Locations

On Windows, a successful build produces:

- **NSIS**: `src-tauri/target/release/bundle/nsis/Personas_<version>_x64-setup.exe`
- **MSI**: `src-tauri/target/release/bundle/msi/Personas_<version>_x64_en-US.msi`
- **Binary**: `src-tauri/target/release/personas-desktop.exe`

Note that a local build has **no `--target` flag**, so output lands in
`target/release/bundle/...`. CI passes `--target <triple>`, which shifts everything
to `target/<triple>/release/bundle/...` — this is why `binary-size-report.mjs` and
`verify-onnxruntime-bundling.mjs` take a `--target` argument in the workflow.

### `tauri build` exits 1 locally without a signing key — this is expected

`bundle.createUpdaterArtifacts` is `true` in `tauri.conf.json`. After both installers
are written, Tauri tries to produce the signed updater bundles and fails:

```
Finished 2 bundles at:
    .../bundle/msi/Personas_1.1.0_x64_en-US.msi
    .../bundle/nsis/Personas_1.1.0_x64-setup.exe

Error A public key has been found, but no private key. Make sure to set
`TAURI_SIGNING_PRIVATE_KEY` environment variable.
```

**The installers are complete and usable** — only the `.nsis.zip` / `.msi.zip` +
`.sig` updater artifacts are missing. But the command's exit code is **1**, so any
script or CI step that gates on it will treat the build as failed. Two options:

- Accept the non-zero exit and check for the bundle files instead of `$?`.
- Set `TAURI_SIGNING_PRIVATE_KEY` (+ `..._PASSWORD`) from `~/.tauri/personas.key`
  before building to get a clean exit and real updater artifacts.

Do **not** "fix" this by piping through `tee` — the pipe reports its own exit code
and masks the failure.

### What to expect

- The frontend build (`beforeBuildCommand: npm run build`, which runs the full
  `prebuild` codegen: command names, i18n types + section split, connector seed,
  template checksums, sprites, catalog, system skills) takes ~30s.
- The Rust release build takes **~25 minutes** on a warm cache; a cold cache is
  substantially slower.
- Lite builds skip ML (ONNX/fastembed) and P2P (quinn/mdns) crate compilation.
- The release build is memory-hungry — a single `rustc` process peaks around 1 GB+
  during the final crate. It coexists safely with a running `tauri dev` session,
  which uses `target/debug` (a separate profile directory with its own cargo lock).

### Verifying a local build

```bash
# Smoke-test the binary (runs before any Tauri/single-instance setup,
# so it cannot disturb a running dev instance)
./src-tauri/target/release/personas-desktop.exe --health-check

# Linking-aware ORT gate — locally you must pass --dir (CI passes --target)
node scripts/verify-onnxruntime-bundling.mjs --dir src-tauri/target/release

# Size report. NOTE: this scans the whole bundle directory, so stale installers
# from previous versions are listed too. Clear them out before trusting a
# --budget run locally; CI runs on a clean runner and doesn't have this problem.
node scripts/binary-size-report.mjs --budget 100
```

### Build Size Report

After building, run the size report to check for regressions:

```bash
node scripts/binary-size-report.mjs                    # Show current sizes
node scripts/binary-size-report.mjs --save-baseline     # Save as comparison baseline
node scripts/binary-size-report.mjs --budget 100        # Fail if any installer > 100 MB (matches CI)
```

The CI release pipeline runs this automatically with a 100 MB budget on Windows x64 builds (see `--budget 100` in `.github/workflows/release.yml`).

### Common build errors

- **Unused imports / dead code**: The release build enables `#[deny(unused)]` via the `desktop` feature flag. Fix any unused imports before building.
- **Type mismatches**: Ensure struct fields use the correct wrapper types (e.g., `Json<Vec<String>>` not bare `Vec<String>` for JSON columns).
- **Private module imports**: Use the re-exported path (e.g., `crate::db::models::Json`) not the internal module path.
- **Feature-gated modules**: If adding imports to `engine::embedder`, `engine::vector_store`, `engine::kb_ingest`, wrap them with `#[cfg(feature = "ml")]`. For `engine::identity` or `engine::p2p`, use `#[cfg(feature = "p2p")]`.

### Launch after build

```bash
# Run the NSIS installer
start "" "src-tauri/target/release/bundle/nsis/Personas_<version>_x64-setup.exe"

# Or run the binary directly (skips install)
./src-tauri/target/release/personas-desktop.exe

# Health check mode (verifies binary can initialize without GUI)
./src-tauri/target/release/personas-desktop.exe --health-check
```

---

## Health Check Mode

The binary supports a `--health-check` flag for smoke testing without launching the full GUI:

```bash
personas-desktop.exe --health-check
```

This verifies:
1. TLS provider initializes (rustls/ring)
2. SQLite opens an in-memory database and reports its version
3. Sentry initializes (no-op without DSN)
4. Local data directory is accessible

Exits with code 0 on success, non-zero on failure. Used by the installer acceptance test script and CI.

---

## Installer Acceptance Testing

Automated installer testing runs via `.github/workflows/installer-test.yml`.

### What the Windows script tests (`scripts/test-installer.ps1`)

1. **Silent install** — NSIS installer runs with `/S` flag into `%LOCALAPPDATA%\Personas`
2. **File verification** — binary exists, correct size (>20 MB), uninstaller present
3. **Registry** — uninstall registry key created, deep link protocol registered
4. **Health check** — binary launches with `--health-check` and exits cleanly
5. **Silent uninstall** — uninstaller removes files

### Jobs in the workflow

| Job | Trigger | What it does |
|---|---|---|
| `test-release` | after a **successful** Release run | Downloads the release NSIS installer and runs the acceptance script on a `windows-latest` **and** a `windows-11-arm` runner (`fail-fast: false`, so an arm64-runner outage doesn't mask a passing x64 leg) |
| `test-build` | `workflow_dispatch` with empty `tag` | Builds `--bundles nsis` from HEAD, then runs the acceptance script |
| `test-build-macos` | `workflow_dispatch` with empty `tag` | Builds `--bundles dmg` (host arch, not universal), mounts it, asserts binary-exists + an adhoc-or-real code signature, then *attempts* `--health-check`. `continue-on-error: true` during the soak period. |
| `test-build-linux` | `workflow_dispatch` with empty `tag` | Builds `--bundles deb,appimage`, `apt-get install`s the deb and health-checks it under `xvfb`, then health-checks the AppImage. `continue-on-error: true` during the soak period. |
| `test-tag` | `workflow_dispatch` with a `tag` | Downloads that tag's x64 installer and runs the acceptance script |

The macOS and Linux jobs are non-blocking gates today. Promotion bar: flip
`continue-on-error` to `false` once each has been green — or failed only on the
expected "headless launch didn't come up" degraded path, never on
build/mount/binary/sign — for 5 consecutive runs. (ADR
`2026-05-01-installer-test-cross-platform`.)

### Running locally

> **⚠ Destructive on a developer machine.** `test-installer.ps1` silently installs
> into `%LOCALAPPDATA%\Personas` (Phase 1) and then silently **uninstalls** it
> (Phase 5). If you have a real Personas install there, this script replaces it and
> then removes it — including the install directory. It does not touch the app's
> SQLite data directory, and it does not affect a `tauri dev` session (that runs out
> of `target/debug`), but do not run it casually on a machine whose installed
> Personas you care about. Prefer the CI job, or run it on a throwaway box.

```powershell
# After building — auto-discovers the newest matching installer
.\scripts\test-installer.ps1

# Or with an explicit installer path / architecture
.\scripts\test-installer.ps1 -Installer "path\to\Personas_1.1.0_x64-setup.exe" -Arch x64
```

### CI triggers

- **Automatic**: `workflow_run` after the Release workflow completes — but the
  `test-release` job is gated on `conclusion == 'success'`, so it silently does
  nothing when Release fails.
- **Manual**: `workflow_dispatch` — test from HEAD (all platforms) or a specific tag
  (Windows x64 only)

---

## Troubleshooting

### Pipeline skips on every push

Check if the latest commit message starts with `chore: bump version`. The pipeline intentionally skips these to prevent loops. Push a normal commit to trigger a release.

### Updater shows no updates available

1. Verify `latest.json` exists on the latest GitHub Release
2. Check that the `version` in `latest.json` is higher than the installed app version
3. Ensure `plugins.updater.pubkey` in `tauri.conf.json` matches the keypair that signed the release
4. Check the app console/logs for updater errors

### Signature verification failed

The public key in the running app doesn't match the private key that signed the release. This happens when keys are regenerated. Users must manually download the new version.

### macOS build fails with signing error

If `signingIdentity` is set but no certificate is available, the build fails. Keep it `null` for unsigned builds.

### Linux AppImage won't start

Ensure the file is executable: `chmod +x Personas_*.AppImage`
