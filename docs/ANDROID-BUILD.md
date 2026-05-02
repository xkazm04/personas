# Android build setup

Android linker paths are NOT committed to `src-tauri/.cargo/config.toml`
because they reference user-specific NDK installs (different versions,
install dirs, host OSes per machine). This file describes the portable
options.

## Recommended: `cargo-ndk`

```bash
cargo install cargo-ndk
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# Build (cargo-ndk auto-discovers ANDROID_NDK_HOME)
export ANDROID_NDK_HOME="$HOME/.android-ndk/25.2.9519653"   # adjust to your install
cargo ndk -t aarch64-linux-android -t armv7-linux-androideabi build
```

`cargo-ndk` configures the linker for each Android target on the fly — no
hardcoded paths in `.cargo/config.toml`.

## Alternative: per-user `~/.cargo/config.toml`

Cargo merges `~/.cargo/config.toml` (user-level) with the project's
`.cargo/config.toml`. To keep the old workflow without committing absolute
paths, drop these blocks into your **own** `~/.cargo/config.toml` (substitute
your NDK install path):

```toml
[target.aarch64-linux-android]
linker = "/path/to/ndk/toolchains/llvm/prebuilt/<host>/bin/aarch64-linux-android24-clang.cmd"
ar     = "/path/to/ndk/toolchains/llvm/prebuilt/<host>/bin/llvm-ar.exe"

[target.armv7-linux-androideabi]
linker = "/path/to/ndk/toolchains/llvm/prebuilt/<host>/bin/armv7a-linux-androideabi24-clang.cmd"
ar     = "/path/to/ndk/toolchains/llvm/prebuilt/<host>/bin/llvm-ar.exe"

[target.i686-linux-android]
linker = "/path/to/ndk/toolchains/llvm/prebuilt/<host>/bin/i686-linux-android24-clang.cmd"
ar     = "/path/to/ndk/toolchains/llvm/prebuilt/<host>/bin/llvm-ar.exe"

[target.x86_64-linux-android]
linker = "/path/to/ndk/toolchains/llvm/prebuilt/<host>/bin/x86_64-linux-android24-clang.cmd"
ar     = "/path/to/ndk/toolchains/llvm/prebuilt/<host>/bin/llvm-ar.exe"
```

`<host>` is `windows-x86_64` on Windows, `linux-x86_64` on Linux, `darwin-x86_64`
on Intel Macs, and `darwin-arm64` on Apple Silicon.

## Tauri Android

Tauri 2 has first-class Android support; once cargo-ndk and the targets are
installed, use:

```bash
npx tauri android init        # one-time scaffold
npx tauri android dev         # connect a device or start an emulator
npx tauri android build
```
