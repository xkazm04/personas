# Mobile MVP Build Guide

> Status: **Feasibility spike — proof of concept**
> Created: 2026-03-09

## Goal

Minimal Android app proving the Tauri v2 mobile path works with:
1. React frontend rendering in Android WebView
2. Credential catalog displayed
3. One LLM feature: credential onboarding design (via cloud LLM API)
4. Manual API key input + connection testing

If this works → continue iterating. If it fails → fall back to Strategy A (cloud backend).

## Prerequisites

```bash
# Android SDK + NDK
# Install via Android Studio or sdkmanager
sdkmanager "platforms;android-34" "ndk;25.2.9519653" "build-tools;34.0.0"

# Set environment variables
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/25.2.9519653

# Rust Android targets
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

# Tauri CLI v2 (if not already installed)
cargo install tauri-cli --version "^2"
```

## What was already done (code changes in this repo)

### 1. Cargo.toml — Feature-gated dependencies

Desktop-only crates moved behind `desktop` feature (enabled by default):

```toml
[features]
default = ["desktop"]
desktop = [
    "dep:arboard",      # clipboard
    "dep:notify",       # file watcher
    "dep:keyring",      # OS credential store
    "dep:which",        # binary discovery
    "dep:tauri-plugin-window-state",
    "dep:tauri-plugin-updater",
    "dep:tauri-plugin-single-instance",
]
mobile = []
```

**Impact:** `cargo check --features desktop` passes. Desktop build unchanged.
When Tauri targets Android, it omits the `desktop` feature automatically.

### 2. Rust backend — Conditional compilation

Gated modules in `engine/mod.rs`:
```rust
#[cfg(feature = "desktop")]
pub mod file_watcher;
#[cfg(feature = "desktop")]
pub mod clipboard_monitor;
#[cfg(feature = "desktop")]
pub mod app_focus;
#[cfg(feature = "desktop")]
pub mod desktop_bridges;
#[cfg(feature = "desktop")]
pub mod desktop_discovery;
#[cfg(feature = "desktop")]
pub mod desktop_runtime;
#[cfg(feature = "desktop")]
pub mod desktop_security;
```

Gated in `lib.rs`:
- Tray module: `#[cfg(feature = "desktop")] mod tray;`
- Desktop-only plugins (window-state, updater, single-instance)
- Desktop fields in AppState (desktop_approvals, desktop_runtime)

Gated in `background.rs`:
- Desktop subscription imports (FileWatcher, Clipboard, AppFocus)
- Desktop subscription instantiation in `start_loops()`

Gated in `subscription.rs`:
- Struct definitions for desktop-only subscriptions
- `ReactiveSubscription` impl blocks

### 3. Capabilities — Platform-split

- `capabilities/default.json` — `platforms: ["linux", "macOS", "windows"]` with updater + window-state
- `capabilities/mobile.json` — `platforms: ["android", "iOS"]` without desktop plugins

### 4. Android config

- `src-tauri/tauri.android.conf.json` — mobile-specific overrides (identifier, min SDK 24)

## Next steps to complete the MVP

### Step 1: Initialize Android project

```bash
cd personas
npx tauri android init
```

This generates `src-tauri/gen/android/` with Gradle project, MainActivity, etc.

### Step 2: Remaining `keyring` gating

The `keyring` crate is used in 4 files that are NOT yet gated because they contain
mixed desktop+mobile logic:

| File | Usage | Mobile alternative |
|------|-------|-------------------|
| `cloud/config.rs` | Store/load cloud URL + API key | SQLite fallback |
| `gitlab/config.rs` | Store/load GitLab PAT | SQLite fallback |
| `commands/infrastructure/auth.rs` | OAuth refresh tokens | SQLite fallback |
| `engine/crypto.rs` | Master encryption key | SQLite or Android Keystore |

**Approach:** Create `keyring_compat` module with `#[cfg]` branches:

```rust
// src-tauri/src/engine/keyring_compat.rs

#[cfg(feature = "desktop")]
pub fn store(service: &str, key: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(service, key)
        .map_err(|e| format!("keyring: {e}"))?
        .set_password(value)
        .map_err(|e| format!("store: {e}"))
}

#[cfg(not(feature = "desktop"))]
pub fn store(service: &str, key: &str, value: &str) -> Result<(), String> {
    // For MVP: store encrypted in SQLite (already have AES-GCM)
    // For production: Android Keystore via JNI
    tracing::warn!("keyring not available on mobile, using fallback");
    Err("keyring not available on this platform".into())
}
```

### Step 3: Gate remaining process-spawning commands

Commands that spawn CLI processes need `#[cfg(feature = "desktop")]` or mobile
alternatives. For the MVP, most can simply return an error on mobile:

```rust
#[tauri::command]
async fn execute_persona(...) -> Result<...> {
    #[cfg(not(feature = "desktop"))]
    return Err("CLI execution not available on mobile".into());

    #[cfg(feature = "desktop")]
    { /* existing CLI spawn logic */ }
}
```

The credential catalog and testing commands (which use HTTP, not CLI) should
work without changes.

### Step 4: Test Android build

```bash
# Development (connected Android device or emulator)
npx tauri android dev

# Release build
npx tauri android build
```

### Step 5: Frontend mobile detection

Add to the React app for responsive behavior:

```typescript
// src/lib/utils/platform.ts
export const isMobile = () => {
  try {
    return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label === 'main'
      && /android|ios/i.test(navigator.userAgent);
  } catch {
    return false;
  }
};
```

For the MVP, the existing desktop layout will work in the WebView (scrollable).
Responsive improvements come later.

## MVP Use Case: Credential Catalog + Onboarding Design

### What already works on mobile (no code changes needed)

These Tauri commands are pure SQLite + HTTP operations:

```rust
// Credential catalog (SQLite reads)
list_connector_definitions    // ✅ lists catalog items
get_connector_definition      // ✅ single item detail
list_credentials              // ✅ user's saved credentials

// Credential testing (HTTP)
test_credential_connection    // ✅ validates API key via HTTP request

// Credential creation (SQLite writes)
create_credential             // ✅ saves credential to local DB
update_credential             // ✅ updates credential
delete_credential             // ✅ removes credential
```

### LLM feature for onboarding design

The credential onboarding AI feature currently spawns a CLI process. For mobile,
add an HTTP-based alternative that calls the LLM API directly:

```rust
// New: src-tauri/src/engine/llm_http.rs (mobile LLM execution)

use reqwest::Client;
use serde_json::{json, Value};

pub async fn call_llm(
    api_key: &str,
    provider: &str,  // "anthropic" | "openai" | "google"
    prompt: &str,
) -> Result<String, String> {
    let client = Client::new();

    let (url, body) = match provider {
        "anthropic" => (
            "https://api.anthropic.com/v1/messages",
            json!({
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}]
            }),
        ),
        // ... other providers
        _ => return Err(format!("Unknown provider: {provider}")),
    };

    let resp = client.post(url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    // Parse response...
    Ok(response_text)
}
```

This module works on both desktop and mobile — no process spawning required.
For the MVP, it replaces the CLI-based credential design flow.

## Success criteria

The MVP is successful if:

1. ✅ `npx tauri android dev` launches on emulator/device
2. ✅ React frontend renders (sidebar, navigation work)
3. ✅ Credential catalog page loads and displays connector items
4. ✅ User can input an API key and test the connection
5. ✅ LLM-based onboarding design generates steps via HTTP API
6. ✅ SQLite database persists across app restarts
7. ✅ Desktop build (`npm run tauri build`) is NOT broken

## Decision point

After MVP:
- **Continue with Strategy B** if WebView performance is acceptable and the
  build pipeline is stable
- **Fall back to Strategy A** if Android WebView is too slow, Tauri mobile
  is too unstable, or the cfg-gating complexity becomes unmanageable

## Files changed

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Feature-gated desktop deps |
| `src-tauri/tauri.android.conf.json` | New — Android config |
| `src-tauri/capabilities/default.json` | Added `platforms` filter |
| `src-tauri/capabilities/mobile.json` | New — mobile permissions |
| `src-tauri/src/lib.rs` | Gated tray, plugins, AppState fields |
| `src-tauri/src/engine/mod.rs` | Gated 7 desktop-only modules |
| `src-tauri/src/engine/background.rs` | Gated desktop subscriptions |
| `src-tauri/src/engine/subscription.rs` | Gated desktop subscription types |
