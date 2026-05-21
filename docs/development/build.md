# Building Personas Desktop

End-to-end reference for building, packaging, and releasing Personas Desktop.
For day-to-day development workflow, see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Quick reference

```bash
# Develop
npm run tauri:dev              # full app, all features
npm run tauri:dev:lite         # fast iteration (no ML/P2P)
npm run tauri:dev:test         # with test-automation HTTP server on :17320

# Build
npm run tauri:build            # canonical: all targets, desktop-full features
npm run tauri:build:lite       # lite: nsis-only, desktop features
npm run tauri:build:stable     # stable: nsis + msi, full LTO

# Frontend-only tier checks
npm run check:tiers            # builds starter + team + builder bundles
npm run check:tauri-configs    # validates the three tauri.conf.json files
```

## The two dimensions

A "build" is two independent choices: **frontend tier** × **backend variant**.

### Frontend tier (`VITE_APP_TIER`)

Tiers control which UI features are gated in the React bundle. The default
build (`npm run build`) produces the **builder** tier (everything visible).
For tier-specific builds:

```bash
npm run build:starter          # starter-tier UI gates only
npm run build:team             # adds team-tier features
npm run build:builder          # all features (default)
```

Tier compile failures don't show up in `npm run build` — run
`npm run check:tiers` locally before pushing if you've touched tier-gated
imports. CI also enforces this in `frontend-checks` (see `.github/workflows/ci.yml`).

### Backend variant (Cargo features × Tauri config)

Three Tauri configs in `src-tauri/`:

| File | Features | Bundle | Use |
|------|----------|--------|-----|
| `tauri.conf.json`        | `desktop-full` (= desktop + ml + p2p) | all targets       | canonical full build |
| `tauri.lite.conf.json`   | `desktop`                              | nsis only         | fast Windows iteration |
| `tauri.stable.conf.json` | `desktop-full`                         | nsis + msi        | Windows release |

The canonical config's `security.csp` is documented per-domain in
[`csp-inventory.md`](csp-inventory.md) — update that file in the same change
when you add or remove a network-using feature.

Cargo features in `src-tauri/Cargo.toml`:

| Feature | Implies | What it adds |
|---------|---------|--------------|
| `desktop`         | —                          | tray, clipboard, notifications, keyring, screen capture, window state, updater |
| `ml`              | —                          | sqlite-vec + fastembed + ort (ONNX Runtime) |
| `p2p`             | —                          | ed25519, mdns-sd, quinn, rcgen |
| `desktop-full`    | desktop + ml + p2p         | full production set |
| `test-automation` | (xcap + image)             | HTTP server on :17320 for MCP-driven UI testing |
| `daemon`          | desktop-full *             | headless daemon binary (`personas-daemon`) |

\* `daemon` implies `desktop-full` because of unresolved `#[cfg(feature="desktop")]`
gaps in four backend modules — see the comment on the `daemon` feature in
`Cargo.toml` for the cleanup plan.

## Codegen pipeline

`predev` and `prebuild` run codegen before Vite. Both go through
`scripts/run-codegen.mjs`, which runs each task **in parallel** with a per-task
60s timeout (override via `CODEGEN_TIMEOUT_MS`). Tasks:

- `commands` — extracts Tauri command names from `src-tauri/src/lib.rs` →
  `src/lib/commandNames.generated.ts`
- `i18n` — generates types from `src/i18n/locales/en.json` → `src/i18n/generated/types.ts`
- `connectors` — regenerates the connector seed
- `checksums` (prebuild only) — template integrity hashes
- `host-check` (predev only) — detects Rust host-triple drift (see below)

ts-rs binding generation is **not** part of this pipeline — it runs via
`cargo test export_bindings`. The `binding-drift` job in CI catches forgotten
regenerations.

## ARM64 vs x64 Windows

Both architectures share `src-tauri/target/debug/deps/` — Cargo doesn't
segregate the deps directory by triple. Switching default targets between
runs (e.g. via toolchain change, or restoring from another machine's cache)
poisons the cache: rlibs from arch A get linked into a build for arch B,
producing `lld-link: error: machine type x64 conflicts with arm64`.

Detection: `predev` writes `src-tauri/target/.last-build-host` after each
successful run. The next `predev` compares to `rustc -vV`'s host and fails
loud on mismatch with the recovery command:

```bash
npm run clean:rust             # nuclear: full cargo clean (~10 min rebuild)
npm run clean:ort              # surgical: just ort + ort-sys (often enough)
```

For *size* management — `target/` is uncapped and balloons across profiles,
triples, and per-worktree caches — see [build-cache.md](build-cache.md)
(`npm run cache:report` / `clean:cache` / `clean:worktrees`). `clean:rust`
above is for *correctness* recovery; the cache budget is for disk pressure.

CI was vulnerable to the same trap — `release.yml`'s build job has matrix
entries for `windows-x64` and `windows-arm64` both on `windows-latest`,
sharing a single GitHub Actions cache. The rust-cache action is now keyed
by `matrix.rust_target` (since 2026-05-02), so each arch has an isolated
cache.

## Linker

LLD-link is configured for both Windows targets in `src-tauri/.cargo/config.toml`
(2-5x faster link than MSVC's link.exe, no measurable codegen difference).
Stack size is bumped to 8 MB on both targets to match Linux/macOS defaults
— sync Tauri commands deserialize on the main thread, and the default 1 MB
stack overflows on deeply-nested payloads.

## Profiles

Defined in `src-tauri/Cargo.toml`:

| Profile | Inherits | LTO | codegen-units | Use |
|---------|----------|-----|---------------|-----|
| `dev`         | —          | off          | default | local development |
| `dev-release` | dev        | thin         | default | perf testing — ~3x faster than release |
| `release`     | —          | thin         | 2       | daily releases (default `cargo tauri build`) |
| `ci`          | release    | thin         | 4       | CI tests + clippy (faster, debug symbols kept) |
| `stable`      | release    | full         | 1       | milestone releases (`cargo tauri build --profile stable`) |

`panic = "unwind"` on release because `ort` panics on ONNX Runtime DLL
version mismatches; we want `catch_unwind` to handle them.

## ONNX Runtime bundling

`ort = { version = "2.0.0-rc.9" }` ships in `desktop-full` builds via the `ml`
feature. fastembed's default `ort-download-binaries` feature is the only path
placing `onnxruntime.dll` next to the exe — **do not enable** ort's
`load-dynamic` feature, which flips to runtime DLL lookup and panics at boot.

`scripts/verify-onnxruntime-bundling.mjs` runs in `release.yml` after each
Windows build and fails the release if the DLL is missing.

### Pyke `ort-sys 2.0.0-rc.9` aarch64-windows tarball is mislabeled (auto-fixed)

The pre-built ONNX Runtime tarball pyke ships for `aarch64-pc-windows-msvc`
in `ort-sys 2.0.0-rc.9` is named correctly but **contains x64 binaries
inside**. Verified via `dumpbin /HEADERS`:

```
File: %LOCALAPPDATA%\ort.pyke.io\dfbin\aarch64-pc-windows-msvc\C09BFF…27DE\onnxruntime\lib\onnxruntime.lib
File Type: LIBRARY
FILE HEADER VALUES
            8664 machine (x64)        ← should be AA64 / ARM64
```

The SHA256 of the tarball matches `dist.txt` so the download-time hash
check passes; the defect is the contents, not the integrity. Linking arm64
Rust code against it produces `lld-link: error: machine type x64 conflicts
with arm64`. `fastembed 4.9.1` pins ort to exactly `=2.0.0-rc.9`, so we
can't escape via a version bump without a major dep upgrade.

**Auto-fix (default):** `scripts/ensure-ort-cache.mjs` runs from the
`pretauri:dev` / `pretauri:build` npm lifecycle hooks before cargo starts.
It:

1. Reads `rustc -vV` to detect the host triple. Exits clean if not a known
   Windows MSVC target.
2. Sniffs the cached `onnxruntime.lib`'s first object member to read its
   actual COFF machine field (bypassing labels).
3. If the cache is correct for the host or absent, downloads Microsoft's
   official ONNX Runtime 1.20.0 release for the host arch and places it
   into pyke's expected cache slot. The `ort-sys` build script's
   `if !lib_dir.exists()` check then short-circuits the broken download.
4. Tracks state in a sentinel (`.personas-ort-fix-applied`) so subsequent
   runs are O(ms).
5. Detects stale cargo artifacts: if `target/<profile>/deps/libort_sys-*.rlib`
   was built before the sentinel was last written, the rlib was linked
   against the previous arch's lib and is evicted so cargo rebuilds.

This switches ORT from STATIC linkage (pyke's 290 MB onnxruntime.lib) to
DYNAMIC linkage (Microsoft's small import lib + onnxruntime.dll, ~12 MB).
The `ort` crate's `copy-dylibs` feature (on by default) ensures the DLL is
placed next to the exe in dev and release builds; tauri-bundler picks it up
from `target/release/` for installers.

**Manual recovery:** `npm run ensure:ort-cache` runs the fix on demand.
`npm run clean:ort` wipes the cache and forces a re-fix on next dev/build.

**Production releases:** CI builds run on x64 `windows-latest` runners.
Pyke's x64 tarball is correct, so the fix script is a no-op there — but
it still runs as a guard against future regressions in either tarball.

If `pretauri:dev` is bypassed (e.g. running `cargo run` directly), the
broken binary will be re-downloaded and you'll see the link error.
Always go through the npm script entrypoints, or call
`npm run ensure:ort-cache` first.

## CI gates

See `.github/workflows/ci.yml`:

- **commit-lint** — Conventional Commits format
- **frontend-checks** — typecheck + lint + i18n parity + tier validation + bundle budget + tests
- **rust-tests** — `cargo test` + clippy + cargo-deny on Windows / macOS / Linux
- **command-name-drift** — regenerates `commandNames.generated.ts`, fails on diff
- **binding-drift** — runs `cargo test export_bindings`, fails on diff in `src/lib/bindings/`

`release.yml` runs on merged PRs to `master` and produces NSIS / MSI / .app /
AppImage artifacts plus the `latest.json` updater manifest. Per-target rust
cache key prevents x64/arm64 cross-contamination.

## Android

Hardcoded NDK linker paths were removed from `src-tauri/.cargo/config.toml`
to keep the project portable across machines. See [ANDROID-BUILD.md](./ANDROID-BUILD.md)
for setup.
