# Strategy B: Tauri v2 Native Mobile (Android)

> Status: **Analysis only — not implementing**
> Created: 2026-03-09

## Overview

Use Tauri v2's experimental Android/iOS support to compile the existing Rust
backend + React webview frontend directly to a mobile APK. This maximizes code
reuse but requires gutting desktop-only features and accepting webview performance
tradeoffs.

## Architecture

```
┌─────────────────────────────────────────────┐
│              Android APK                      │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │         WebView (React frontend)         │ │
│  │                                           │ │
│  │  Schedule Timeline · Agent Dashboard      │ │
│  │  Recovery Panel · Credential Manager      │ │
│  │  Execution Viewer · Trigger Config        │ │
│  └───────────────┬─────────────────────────┘ │
│                   │ Tauri IPC (invoke)         │
│  ┌───────────────┴─────────────────────────┐ │
│  │         Rust Backend (embedded)           │ │
│  │                                           │ │
│  │  scheduler · event_bus · crypto · sqlite  │ │
│  │  webhook_server · http_polling · cron     │ │
│  │  llm_http_client (new, replaces CLI)      │ │
│  └───────────────────────────────────────────┘ │
│                                               │
│  ┌───────────────────────────────────────────┐ │
│  │     Android Native Bridges (Kotlin/JNI)    │ │
│  │                                           │ │
│  │  Keystore · ClipboardManager · WorkManager │ │
│  │  NotificationManager · ForegroundService   │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Compilation chain

```
Rust source  ──►  Android NDK (aarch64-linux-android)  ──►  .so library
                                                              │
React source ──►  Vite build  ──►  static assets              │
                                        │                      │
                            Tauri v2 mobile bundler ──►  APK/AAB
```

### Tauri v2 mobile requirements
- Tauri CLI v2 with `tauri android init`
- Android SDK + NDK (r25+)
- Gradle build system
- Min API level: 24 (Android 7.0) for WebView features
- Target: API 34+ (Android 14)

## Module-by-module porting analysis

### Keep unchanged (compiles as-is)

| Module | File | Mobile notes |
|--------|------|-------------|
| Cron parser | `engine/cron.rs` | Pure computation |
| Crypto vault | `engine/crypto.rs` | aes-gcm, rsa, sha2 — all portable |
| Trigger CRUD | `commands/triggers.rs` | SQLite operations |
| Event bus core | `engine/background.rs` | Tokio runtime runs on Android NDK |
| HTTP polling | `engine/polling.rs` | reqwest+rustls, no OS deps |
| Notification dispatch | `notifications.rs` | HTTP to Slack/Telegram/Email |
| Cloud client | `cloud/client.rs` | HTTP only |
| Template/design system | Various | Pure data logic |
| IPC auth + encryption | `engine/crypto.rs` | RSA+AES handshake stays same |
| Database (SQLite) | `db/` | rusqlite bundled, Android has native SQLite too |

### Requires replacement

| Module | Current | Android replacement | Effort |
|--------|---------|---------------------|--------|
| **Process spawning** | `tokio::process::Command` | HTTP API calls to LLM providers | **Large** — entire runner.rs rewrite |
| **Keyring** | `keyring` crate (DPAPI) | Android Keystore via JNI | Medium |
| **Clipboard** | `arboard` crate | `ClipboardManager` via Kotlin bridge | Small |
| **File watching** | `notify` crate | `FileObserver` API (limited) or drop feature | Small |
| **App focus** | Win32 `GetForegroundWindow` | `AccessibilityService` (requires permission) or `UsageStatsManager` | Medium |
| **System tray** | `tauri-plugin-tray-icon` | Persistent notification / quick settings tile | Small |
| **Window state** | `tauri-plugin-window-state` | Not applicable — remove | Trivial |
| **Updater** | `tauri-plugin-updater` | Play Store / in-app update API | Small |
| **Desktop bridges** | VS Code, Docker, Terminal, Obsidian | See below | N/A |

### Must be dropped (no mobile equivalent)

| Feature | Why it can't exist on mobile |
|---------|------------------------------|
| VS Code bridge | No VS Code on Android |
| Docker bridge | No Docker daemon on Android |
| Terminal execution | No shell access without root |
| Obsidian file bridge | Could work via Obsidian mobile URI scheme (partial) |
| Deep process introspection | Android doesn't expose other app internals |

## New Android-specific modules needed

### 1. Foreground Service (background execution)

Android aggressively kills background processes. A `ForegroundService` with a
persistent notification is required to keep the scheduler running.

```kotlin
class SchedulerService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("Personas scheduler active")
        startForeground(SCHEDULER_ID, notification)
        // Rust backend continues running in the same process
        return START_STICKY
    }
}
```

**Tradeoff:** Users see a permanent notification while the scheduler runs. This is
an Android platform requirement, not optional.

### 2. WorkManager (guaranteed cron execution)

For cron triggers that must fire even if the app is killed:

```kotlin
class CronWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        // Call Rust via JNI to check & fire pending triggers
        val fired = RustBridge.firePendingTriggers()
        return if (fired) Result.success() else Result.retry()
    }
}
```

Scheduled via:
```kotlin
val cronWork = PeriodicWorkRequestBuilder<CronWorker>(15, TimeUnit.MINUTES)
    .setConstraints(Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build())
    .build()
WorkManager.getInstance(context).enqueueUniquePeriodicWork(
    "personas_cron", ExistingPeriodicWorkPolicy.KEEP, cronWork
)
```

**Limitation:** WorkManager minimum interval is 15 minutes. Cron expressions like
`*/5 * * * *` cannot be honored exactly — they'd fire at the next WorkManager
window.

### 3. AlarmManager (exact timing, limited)

For time-critical triggers, Android's `AlarmManager` with exact alarms:

```kotlin
alarmManager.setExactAndAllowWhileIdle(
    AlarmManager.RTC_WAKEUP,
    nextTriggerTimeMs,
    pendingIntent
)
```

**Restriction:** Android 12+ requires `SCHEDULE_EXACT_ALARM` permission, and
Android 14+ requires user opt-in via Settings. Battery optimization may still
defer alarms.

### 4. Android Keystore bridge

```kotlin
object KeystoreBridge {
    fun store(alias: String, data: ByteArray) {
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
        )
        keyGenerator.init(KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build())
        // ... encrypt and store in SharedPreferences
    }
}
```

### 5. Battery optimization whitelist prompt

```kotlin
if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
    startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:$packageName")
    })
}
```

Required for reliable background execution. Without this, Android will kill the
scheduler within minutes of the app going to background.

## Webhook server on mobile

The current Axum webhook server (localhost:9420) can technically run on Android,
but has significant limitations:

| Concern | Impact |
|---------|--------|
| **No public IP** | Phone is behind carrier NAT. Webhooks can't reach it |
| **Port blocked** | Most carriers block incoming connections |
| **Battery drain** | Keeping a TCP listener active drains battery |
| **IP changes** | Mobile networks reassign IPs frequently |

**Solutions:**
1. **Cloud relay**: Webhooks hit cloud server → push notification → app wakes and processes
2. **Long polling**: App polls cloud relay for pending webhooks (works offline-ish)
3. **WebSocket tunnel**: Persistent WS to cloud, cloud forwards webhooks through tunnel

For Strategy B, the webhook server would need a cloud relay component regardless.

## Frontend considerations

### WebView performance on Android

Tauri uses Android's system WebView (Chromium-based). Performance concerns:

| Aspect | Desktop (Chromium) | Android WebView |
|--------|-------------------|-----------------|
| JS engine speed | ~100% baseline | ~60-80% on flagship, ~40% on budget |
| DOM rendering | Smooth | May stutter with complex animations |
| Memory | 4-16 GB available | 2-4 GB total, ~200MB WebView budget |
| framer-motion animations | Smooth 60fps | May drop to 30fps on older devices |

**Mitigations:**
- Reduce framer-motion usage on mobile (detect via `navigator.userAgent`)
- Virtualize long lists (ScheduleTimeline with 100+ agents)
- Lazy-load heavy components (FrequencyEditor, SkippedRecoveryPanel)
- Use `will-change` CSS hints sparingly

### Responsive UI changes needed

Current UI assumes `min-width: 800px` (ContentBox). Mobile needs:

- Single-column layout below 768px
- Bottom navigation instead of sidebar
- Swipe gestures for row actions (instead of hover reveal)
- Touch-optimized hit targets (44px minimum)
- ScheduleRow action panel: always visible on mobile (no hover state)

## Skipped execution recovery — mobile implications

The `SkippedRecoveryPanel` becomes the **primary user interaction on mobile launch**.
Typical mobile session:

```
1. User opens app (hasn't been open for 6 hours)
2. App detects 12 skipped executions across 4 agents
3. SkippedRecoveryPanel shows prominently at top
4. User selects which to recover, which to skip
5. Batch recovery executes via cloud LLM APIs
6. User reviews results, closes app
```

Additional mobile recovery features needed:
- **Auto-recovery policy per agent**: "always recover", "always skip", "ask"
  stored in SQLite, persists across sessions
- **Smart batching**: don't fire 50 missed runs of "every 5 min" agent — collapse
  to 1 catch-up run with aggregated context
- **Priority ordering**: recover most-recently-missed first
- **Notification on recovery**: push notification when batch recovery completes
  in background

## JNI bridge layer

Rust ↔ Kotlin communication for Android-specific APIs:

```
Rust (Tauri backend)
    │
    │ JNI calls (via jni crate or Tauri android plugin)
    │
Kotlin (Android APIs)
    ├── KeystoreBridge      → credential storage
    ├── ClipboardBridge     → clipboard monitoring
    ├── WorkManagerBridge   → guaranteed background work
    ├── NotificationBridge  → push notifications
    ├── BatteryBridge       → optimization whitelist check
    └── BiometricBridge     → fingerprint/face unlock for vault
```

The `jni` Rust crate (v0.21) handles FFI. Each bridge is a Kotlin object
with `@JvmStatic` methods callable from Rust.

## Cargo.toml changes

```toml
[target.'cfg(target_os = "android")'.dependencies]
jni = "0.21"

[target.'cfg(not(target_os = "android"))'.dependencies]
arboard = "3"
notify = { version = "7", default-features = false, features = ["macos_kqueue"] }
keyring = "3"

[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = [...] }
```

Feature-gated compilation keeps desktop and mobile sharing the same codebase
while swapping OS-specific modules.

## Risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Tauri v2 mobile is experimental | **High** | Could break between releases; no production track record |
| WebView performance on budget phones | **Medium** | Progressive enhancement, reduce animations |
| Android background execution limits | **High** | ForegroundService + WorkManager + battery whitelist |
| No webhook support without cloud relay | **Medium** | Must build relay regardless |
| JNI bridge maintenance burden | **Medium** | Each Android API version may change |
| Play Store review for background usage | **Low** | Declare foreground service justification |
| 15-min WorkManager minimum interval | **Medium** | Use AlarmManager for sub-15min crons |

## Comparison with Strategy A

| Dimension | Strategy A (Cloud Backend) | Strategy B (Tauri Native) |
|-----------|---------------------------|---------------------------|
| Code reuse | ~35% Rust, 0% frontend | ~50% Rust, ~70% frontend |
| Time to MVP | 3-4 months | 2-3 months |
| Production readiness | Higher (proven stack) | Lower (experimental Tauri) |
| Offline capability | Requires sync layer | Works offline (local SQLite) |
| Background reliability | Server always on | Depends on Android scheduling |
| Performance | Native-like (React Native) | WebView (slower on budget phones) |
| Maintenance | Two codebases (server + mobile) | One codebase (but complex conditionals) |
| Scalability | Multi-user ready | Single-user (same as desktop) |
| Desktop bridges via SSH | Possible future add | Not applicable |
| Cost to run | Server hosting costs | Free (user's device) |

## Effort estimate (rough)

| Work item | Scope |
|-----------|-------|
| Tauri v2 Android project setup + NDK toolchain | Small |
| Conditional compilation for desktop-only features | Medium |
| LLM HTTP client (replace CLI spawning) | Large |
| JNI bridges (Keystore, Clipboard, WorkManager) | Medium |
| ForegroundService + battery optimization | Small |
| Responsive UI / mobile layout adaptation | Medium |
| Webhook cloud relay | Medium |
| Play Store build + signing pipeline | Small |
| Testing on real Android devices (fragmentation) | Large |

## Open questions

1. **Tauri v2 mobile stability**: Is it mature enough for a shipped product, or
   should we wait for v2.x stable releases?
2. **WebView vs native rendering**: If performance is too poor, do we pivot to
   Strategy A mid-development?
3. **Background execution reliability**: Can we guarantee cron triggers fire
   within ±1 minute on Android? Or do we accept ±15 minute variance?
4. **Biometric auth**: Should the credential vault require fingerprint/face unlock
   on mobile? (biometric API available via JNI)
5. **Tablet layout**: Do we support landscape/tablet mode, or phone-only?
6. **Wear OS companion**: Could a watch complication show next scheduled agent
   and allow one-tap manual trigger?
