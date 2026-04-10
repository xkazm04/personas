# Mobile — Consolidated Concept

> Status: **Paused — pending strategy decision and MVP spike completion**
> Last active: 2026-03-10 (scaffolding committed, no work since)
> Consolidated from: mobile-mvp.md, mobile-strategy-a/b, guide-mobile-preview.md

---

## Decision Required

Two strategies were analyzed. Neither was chosen — the MVP spike that would inform the decision was started but not completed.

| Dimension | Strategy A: Cloud Backend | Strategy B: Tauri v2 Native |
|-----------|---------------------------|---------------------------|
| Approach | Extract Rust engine to server; mobile = thin HTTPS dashboard | Compile same codebase to Android APK via Tauri v2 |
| Code reuse | ~35% Rust, 0% frontend | ~50% Rust, ~70% frontend |
| Time to MVP | 3-4 months | 2-3 months |
| Production readiness | Higher (proven stack) | Lower (experimental Tauri mobile) |
| Offline capability | Requires sync layer | Works offline (local SQLite) |
| Background reliability | Server always on | Depends on Android scheduling APIs |
| Performance | Native-like (React Native) | WebView (slower on budget phones) |
| Maintenance | Two codebases (server + mobile) | One codebase (complex conditionals) |
| Cost to run | Server hosting costs | Free (user's device) |
| Desktop bridges | Possible via SSH | Not applicable |

**Decision criteria**: If Android WebView performance is acceptable and Tauri mobile is stable enough, continue with Strategy B. Otherwise fall back to Strategy A.

---

## What Was Built (~30% of Strategy B)

Work committed in `bf56d38d` (2026-03-10). All scaffolding, no execution layer.

### Rust feature gating (90%)

Desktop-only crates gated behind `desktop` feature in `Cargo.toml`:
- `arboard`, `notify`, `keyring`, `which`, `xcap`, `image`
- `tauri-plugin-window-state`, `tauri-plugin-updater`, `tauri-plugin-single-instance`
- `mobile = []` feature defined (auto-activated by Tauri for Android/iOS)

7 desktop modules gated in `engine/mod.rs`:
```
file_watcher, clipboard_monitor, app_focus, ambient_context,
context_rules, clipboard_error_detector, desktop_bridges,
desktop_discovery, desktop_runtime, desktop_security
```

Partial keyring gating (4 files have `#[cfg(feature = "desktop")]` with no-op mobile fallback):
- `cloud/config.rs`, `gitlab/config.rs`, `commands/infrastructure/auth.rs`, `engine/crypto.rs`

### Android project scaffold (100%)

- `src-tauri/tauri.android.conf.json` — identifier `com.personas.mobile`, minSdk 24
- `src-tauri/gen/android/` — full Gradle project, `MainActivity.kt`, manifest with permissions
- `src-tauri/capabilities/mobile.json` — minimal permissions (no desktop plugins)

### Build system (100%)

`vite.config.ts` detects `TAURI_ANDROID` / `TAURI_IOS` env vars, sets `VITE_PLATFORM`, applies WebView compat plugin.

### Mobile preview mode (100% — dev tool only)

- `Ctrl+Shift+M` in dev mode toggles mobile layout simulation
- Cyan "MOBILE PREVIEW" badge in top-right
- Shows 4 sidebar modules, collapsed rail, card-based views
- Files: `useMobilePreview.ts`, `platform.ts`, `App.tsx` key handler

### Responsive React (50%)

- `ContentLayout.tsx` — `IS_MOBILE` disables min-width, adjusts padding
- `PersonaOverviewResponsive.tsx` — swaps DataGrid for card list below 768px
- `DesktopFooter.tsx` — hidden on mobile

---

## What's Missing (~70% of Strategy B)

### Critical — no mobile execution without these

| Gap | Detail |
|-----|--------|
| **LLM HTTP client** | Current agent execution spawns CLI processes (`tokio::process::Command`). Mobile needs direct HTTP calls to LLM APIs. Proposed as `llm_http.rs` module — not implemented. |
| **Complete keyring fallback** | Only 4 of ~10 affected files gated. Need `keyring_compat` module with SQLite or Android Keystore fallback for credential storage. |
| **Process-spawning commands** | All commands using CLI must be gated or replaced with HTTP alternatives. |

### Required for production Android

| Gap | Detail |
|-----|--------|
| **ForegroundService** | Android kills background processes. Persistent notification + `START_STICKY` required for scheduler. |
| **WorkManager** | Guaranteed periodic background work (15-min minimum interval). Needed for cron triggers surviving app kill. |
| **AlarmManager (exact)** | For sub-15-min cron triggers. Requires `SCHEDULE_EXACT_ALARM` permission on Android 12+. |
| **Android Keystore bridge** | JNI bridge to hardware-backed key storage. Replaces OS keyring on Android. |
| **Battery optimization whitelist** | Prompt user to disable battery optimization. Without this, scheduler dies within minutes. |
| **Webhook cloud relay** | Phone is behind carrier NAT. Webhooks need a cloud relay to reach mobile. Options: push notification wake, long polling, WebSocket tunnel. |

### UI/UX for mobile

| Gap | Detail |
|-----|--------|
| Bottom navigation | Replace sidebar with tab bar on mobile |
| Touch targets | 44px minimum hit targets |
| Swipe gestures | Row actions (currently hover-reveal) |
| framer-motion detection | Reduce/lazy-load animations on mobile WebView |
| Skipped recovery as primary UX | Mobile sessions are short — recovery panel should be the landing experience |

### DevOps

| Gap | Detail |
|-----|--------|
| CI/CD pipeline | No Android builds in CI (`npx tauri android build` not wired) |
| Play Store packaging | Signing, ProGuard, release builds |
| Device testing | Android fragmentation, WebView version differences |

---

## Architecture — Strategy A (Cloud Backend)

If Strategy B fails the performance test, this is the fallback.

```
┌──────────────────┐         HTTPS/WSS          ┌─────────────────────────┐
│   Mobile Client   │ <------------------------> │    Cloud Orchestrator    │
│                    │                            │                          │
│  Schedule Timeline │  GET /schedules            │  Rust Engine (reused)    │
│  Recovery Panel    │  POST /execute/:id          │  ├─ scheduler + cron     │
│  Agent Dashboard   │  WS /events (live)         │  ├─ event bus            │
│  Credential Mgmt   │                            │  ├─ crypto/vault         │
│                    │                            │  ├─ SQLite -> Postgres   │
│  React Native      │                            │  └─ LLM API execution   │
└──────────────────┘                            └─────────────────────────┘
```

Key differences from Strategy B:
- Process spawning replaced by HTTP LLM calls server-side
- Keyring replaced by HashiCorp Vault / AWS Secrets Manager
- Tauri IPC replaced by Axum REST endpoints
- Adds multi-user auth (JWT + RBAC) — current app is single-user
- Needs data sync + offline queue for mobile
- Mobile client options: React Native (recommended), Flutter, or Tauri v2

### API surface (draft)

```
GET    /api/v1/schedules                 → ScheduleEntry[]
POST   /api/v1/schedules/:id/execute     → Execution
GET    /api/v1/agents                    → CronAgent[]
GET    /api/v1/executions?limit=50       → Execution[]
POST   /api/v1/triggers                  → PersonaTrigger
WS     /api/v1/events/stream             → live event feed
```

---

## Architecture — Strategy B (Tauri v2 Native)

```
┌─────────────────────────────────────────────┐
│              Android APK                      │
│  ┌─────────────────────────────────────────┐ │
│  │         WebView (React frontend)         │ │
│  └───────────────┬─────────────────────────┘ │
│                   │ Tauri IPC                  │
│  ┌───────────────┴─────────────────────────┐ │
│  │         Rust Backend (embedded)           │ │
│  │  scheduler · event_bus · crypto · sqlite  │ │
│  │  llm_http_client (new, replaces CLI)      │ │
│  └───────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────┐ │
│  │     Android Native Bridges (Kotlin/JNI)    │ │
│  │  Keystore · WorkManager · ForegroundService│ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

JNI bridge layer (Rust <-> Kotlin):
```
Rust (Tauri backend)
    │ JNI calls (jni crate v0.21)
Kotlin (Android APIs)
    ├── KeystoreBridge      → credential storage
    ├── WorkManagerBridge   → guaranteed background work
    ├── NotificationBridge  → push notifications
    ├── BatteryBridge       → optimization whitelist
    └── BiometricBridge     → fingerprint/face unlock
```

---

## Open Questions

1. **Tauri v2 mobile maturity** — Is it stable enough to ship, or wait for v2.x stable?
2. **WebView performance** — Can budget Android phones (~$150) handle our React app at acceptable FPS?
3. **Background execution guarantee** — Can we honor cron triggers within +/-1 min, or accept +/-15 min variance?
4. **Pricing model** — Cloud execution costs money (Strategy A). Desktop is free (user's own keys). How does mobile fit?
5. **Offline-first vs online-only** — Full offline is complex. Is "online with graceful degradation" enough?
6. **Biometric auth** — Should credential vault require fingerprint/face unlock on mobile?
7. **Tablet layout** — Support landscape/tablet, or phone-only?

---

## Next Steps to Unblock

1. **Complete the MVP spike** — implement `llm_http.rs`, gate remaining CLI commands, test `npx tauri android dev` on emulator
2. **Evaluate WebView performance** — measure FPS, memory, startup time on mid-range Android device
3. **Make the decision** — Strategy A vs B based on spike results
4. If Strategy B: implement ForegroundService + WorkManager + Keystore bridge
5. If Strategy A: extract Rust engine into standalone Axum server, build React Native client
