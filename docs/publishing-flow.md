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

The release pipeline runs on every push to the `master` branch.

Commits starting with `chore: bump version` are skipped to prevent infinite loops (since the pipeline itself creates a version bump commit).

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

- **Hook**: `src/hooks/useAutoUpdater.ts`
- Checks 5 seconds after app launch, then every 6 hours
- Calls the Tauri updater plugin's `check()` function
- Silently ignores errors (endpoint may not exist for dev builds)

### User notification

- **Component**: `src/features/personas/components/UpdateBanner.tsx`
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
| `src/hooks/useAutoUpdater.ts` | Frontend update checking logic |
| `src/features/personas/components/UpdateBanner.tsx` | Update notification UI |
| `src/features/personas/components/Sidebar.tsx` | Version display |

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
