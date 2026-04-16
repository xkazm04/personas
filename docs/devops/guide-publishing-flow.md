# Publishing Flow

How Personas Desktop packages are built, signed, and delivered to users across Windows, macOS, and Linux.

---

## Architecture

```
Developer merges PR to master
         |
         v
  [bump-version]  ── bumps 0.1.x patch in 3 files, commits, tags vX.Y.Z
         |
         v
  [build]  ── 4 parallel GitHub Actions runners
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

The release pipeline runs when a pull request is **merged** to the `master` branch.

The bump-version job only runs when `github.event.pull_request.merged == true`, preventing accidental triggers on closed-but-not-merged PRs.

---

## Version Bumping

**Script**: `scripts/bump-version.mjs`

On each triggered run, the pipeline:

1. Reads the current version from `package.json` (source of truth)
2. Increments the patch number: `0.1.0` -> `0.1.1` -> `0.1.2`
3. Writes the new version to all three files:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
4. Commits with message `chore: bump version to X.Y.Z`
5. Creates git tag `vX.Y.Z`
6. Pushes commit + tag to origin

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
| `src/hooks/utility/data/useAutoUpdater.ts` | Frontend update checking logic |
| `src/features/shared/components/feedback/UpdateBanner.tsx` | Update notification UI |
| `src/features/shared/components/layout/sidebar/Sidebar.tsx` | Version display |
| `.env.example` | Environment variable documentation |

---

## Ad-Hoc Local Builds

When you need a production installer without going through CI (e.g., for manual testing or a quick demo).

### Build Profiles

The project supports multiple build configurations via Cargo profiles and Tauri feature flags. Choose based on your situation:

| Command | Features | Bundles | Build Time | Use Case |
|---------|----------|---------|------------|----------|
| `npm run tauri:build` | `desktop-full` (ml + p2p) | NSIS + MSI | ~15 min | CI / production release |
| `npm run tauri:build:lite` | `desktop` (no ml/p2p) | NSIS only | ~10 min | Quick local testing, UI work |
| `npm run tauri:build:stable` | `desktop-full` | NSIS + MSI | ~15 min | Milestone builds (explicit config) |
| `npx tauri build` | `desktop-full` (from tauri.conf.json) | NSIS + MSI | ~15 min | Default, same as CI |

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

### What to expect

- The frontend build takes ~5s, the Rust release build takes **10-15 minutes** on a typical machine (first build is slower due to no incremental cache).
- Lite builds skip ML (ONNX/fastembed) and P2P (quinn/mdns) crate compilation, saving ~5 minutes.
- No signing occurs locally unless `TAURI_SIGNING_PRIVATE_KEY` is set in the environment. Unsigned builds work fine for local testing but cannot be used with the auto-updater.

### Build Size Report

After building, run the size report to check for regressions:

```bash
node scripts/binary-size-report.mjs                    # Show current sizes
node scripts/binary-size-report.mjs --save-baseline     # Save as comparison baseline
node scripts/binary-size-report.mjs --budget 55         # Fail if any installer > 55 MB
```

The CI release pipeline runs this automatically with a 60 MB budget on Windows x64 builds.

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

### What it tests

1. **Silent install** — NSIS installer runs with `/S` flag
2. **File verification** — binary exists, correct size (>20 MB), uninstaller present
3. **Registry** — uninstall registry key created, deep link protocol registered
4. **Health check** — binary launches with `--health-check` and exits cleanly
5. **Silent uninstall** — uninstaller removes files

### Running locally

```powershell
# After building
.\scripts\test-installer.ps1

# Or with a specific installer path
.\scripts\test-installer.ps1 -Installer "path\to\Personas_0.0.1_x64-setup.exe"
```

### CI triggers

- **Automatic**: runs after every successful Release workflow
- **Manual**: `workflow_dispatch` — test from HEAD or a specific tag

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
