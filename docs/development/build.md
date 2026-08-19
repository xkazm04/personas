# Building Personas Desktop

End-to-end reference for building, packaging, and releasing Personas Desktop.
For day-to-day development workflow, see [development.md](./development.md).

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
npm run check:tauri-configs    # validates 3 of the 5 tauri*.conf.json files
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

**Five** tracked Tauri configs in `src-tauri/` (plus two generated at launch — see
below). A variant must be an *overlay*: the smallest possible delta over the canonical
config, never a fork.

| File | Features | Bundle | Use | Read by `check:tauri-configs` |
|------|----------|--------|-----|---|
| `tauri.conf.json`        | `desktop-full` (= desktop + ml + p2p) | all targets       | canonical full build | ✅ canonical |
| `tauri.lite.conf.json`   | `desktop`                              | nsis only         | fast Windows iteration | ✅ overlay |
| `tauri.stable.conf.json` | `desktop-full`                         | nsis + msi        | Windows release | ✅ overlay |
| `tauri.android.conf.json`| `[]` (none)                            | all targets       | `tauri android build` | ❌ |
| `.tauri-scraper-dev.conf.json` | `desktop,scraper,test-automation` | — | **no consumer** — referenced by no npm script, doc, hook or CI job | ❌ |

Two more configurations are written at launch and merged in as a second `--config`:
`scripts/dev/tauri-dev-test.mjs` (`.tauri-devtest.gen.conf.json`, gitignored) and
`scripts/test/launch-isolated.mjs` (a `devurl.config.json` in a throwaway data dir), both
because `devUrl` is hardcoded in the canonical config and has no environment-variable form.

`--config` is a **deep merge with whole-array replacement**, and Tauri then materializes
its own defaults into the result. So `tauri.android.conf.json`'s `"features": []`
*replaces* `["desktop-full"]` rather than adding to it. Anything under `src-tauri/gen/` is
build output with no provenance — never read a claim off it.
See [`docs/concepts/golden-paths/tauri-config-variants.md`](../concepts/golden-paths/tauri-config-variants.md).

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

`TASKS` has **15** entries; `predev` runs 14 and `prebuild` runs 14 (they differ by
exactly two, below). `scripts/run-codegen.mjs` is the authoritative list — the highlights:

- `commands` — extracts Tauri command names from `src-tauri/src/lib.rs` →
  `src/lib/commandNames.generated.ts`
- `i18n` / `i18n-split` — generated types from `src/i18n/locales/en.json`, plus the
  per-section locale chunks
- `connectors` / `shared-events` / `n8n-limits` / `sprites` / `catalog` /
  `scan-match` / `guidance-anchors` / `gp-index` / `system-skills` — the rest
- `checksums` (**prebuild only**) — template integrity hashes
- `host-check` (**predev only**) — detects Rust host-triple drift (see below). Note the
  asymmetry: the error it detects is a *link* error, which only happens during a build.
- `cache-budget` — advisory disk-pressure warning; exits 0 unconditionally by design

ts-rs binding generation is **not** part of this pipeline — it runs via
`cargo test export_bindings`. The `binding-drift` job in CI catches forgotten
regenerations.

## ARM64 vs x64 Windows

Both architectures share `src-tauri/target/debug/deps/` — Cargo doesn't
segregate the deps directory by triple. Switching default targets between
runs (e.g. via toolchain change, or restoring from another machine's cache)
poisons the cache: rlibs from arch A get linked into a build for arch B,
producing `lld-link: error: machine type x64 conflicts with arm64`.

Detection: the `host-check` codegen task writes `src-tauri/target/.last-build-host` at
the end of its own run — i.e. *before* cargo starts, so it records the host the last
`predev` saw, not the host of the last successful build. The next `predev` compares it to
`rustc -vV`'s host and fails loud on mismatch (without updating the marker) with the
recovery command:

```bash
npm run ensure:ort-cache       # repairs one vendor artifact; seconds, idempotent
npm run clean:ort              # surgical: ort + ort-sys artifacts + the vendor cache (~5 min)
npm run clean:rust             # nuclear: full cargo clean (~10 min rebuild)
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
3. If the cache is **already correct** for the host it exits immediately (and
   writes a sentinel if one was missing). **If it is wrong or absent**, it
   downloads Microsoft's official ONNX Runtime 1.20.0 release for the host
   arch, SHA-256-verifies it, and places it into pyke's expected cache slot.
   The `ort-sys` build script's `if !lib_dir.exists()` check then
   short-circuits the broken download.
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

**Production releases: the fix does NOT run on CI.** `release.yml` builds through
`tauri-apps/tauri-action` with `tauriScript: npx tauri` — not an `npm run`, so no
`pre*` lifecycle hook fires on any runner. And the matrix has **two** Windows legs
(`x86_64-pc-windows-msvc` **and `aarch64-pc-windows-msvc`**, both on `windows-latest`),
so the arm64 leg cross-compiles against whatever pyke ships. `ensure-ort-cache.mjs` is
host-scoped (`const target = host;`) and could not repair a cross-compile's target slot
even if it did run. See
[`docs/concepts/golden-paths/bundling-native-assets.md`](../concepts/golden-paths/bundling-native-assets.md).

If `pretauri:dev` is bypassed (e.g. running `cargo run` directly), the
broken binary will be re-downloaded and you'll see the link error.
Always go through the npm script entrypoints, or call
`npm run ensure:ort-cache` first.

## CI gates

See `.github/workflows/ci.yml`:

- **commit-lint** — Conventional Commits format
- **frontend-checks** — typecheck + lint + i18n parity + tier validation + bundle budget + tests
- **rust-tests** — `cargo test` + clippy + cargo-deny on Windows / macOS / Linux.
  ⚠ Measured 2026-08-17: all three steps currently fail. `cargo test` and `cargo clippy`
  stop at `personas-db` (fail-fast), so `app_lib` is compiled and never run or linted;
  `cargo deny check` dies deserializing `deny.toml`. See deferred-fixes #89 and #99.
- **command-name-drift** — regenerates `commandNames.generated.ts`, fails on diff
- **binding-drift** — runs `cargo test export_bindings`, fails on diff in `src/lib/bindings/`

`release.yml` runs on merged PRs to `master` and produces NSIS / MSI / .app /
AppImage artifacts plus the `latest.json` updater manifest. Per-target rust
cache key prevents x64/arm64 cross-contamination.

`installer-test.yml` (manual dispatch, or after `release.yml` completes) runs
installer acceptance smoke tests: Windows NSIS (blocking), plus macOS DMG and
Linux deb/AppImage (both `continue-on-error: true` during their soak period —
see the workflow file for the promotion bar). All three exercise the same
`--health-check` binary flag (`src-tauri/src/main.rs`).

## Android

Hardcoded NDK linker paths were removed from `src-tauri/.cargo/config.toml`
to keep the project portable across machines. See [android-build.md](./android-build.md)
for setup.
