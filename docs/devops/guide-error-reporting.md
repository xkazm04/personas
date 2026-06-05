# Error Reporting

Personas Desktop uses Sentry for passive error monitoring. This document describes what is collected, what is never collected, and how to work with the system.

---

## Architecture

```
Rust backend                          React frontend
┌─────────────────────┐              ┌──────────────────────┐
│ main.rs             │              │ main.tsx             │
│  sentry::init()     │              │  initSentry()        │
│  └─ guard held      │              │  └─ Sentry.init()    │
│     for app life    │              │  window.onerror      │
│                     │              │  unhandledrejection   │
│ logging.rs          │              │  ErrorBoundary(App)   │
│  tracing subscriber │              │                      │
│  ├─ stdout (dev)    │              │ lib/sentry.ts        │
│  └─ sentry layer    │              │  beforeSend PII      │
│     ERROR → Issue   │              │  filter              │
│     WARN  → Crumb   │              │                      │
└─────────────────────┘              └──────────────────────┘
         │                                    │
         └──────────┐    ┌────────────────────┘
                    ▼    ▼
              Sentry Cloud (errors + sessions)
```

### Rust side

- `sentry::init()` in `src-tauri/src/main.rs` — guard held for entire app lifetime
- `sentry-tracing` layer in `src-tauri/src/logging.rs` — routes existing `tracing::error!` as Sentry Issues, `tracing::warn!` as breadcrumbs
- Panic hook registered automatically by the `sentry` crate's `panic` feature

### Frontend side

- `initSentry()` in `src/lib/sentry.ts` — called from `src/main.tsx` before React renders
- `Sentry.withErrorBoundary(App)` — catches React render crashes, shows fallback UI
- `window.onerror` + `unhandledrejection` — catches errors outside the React tree

---

## What Is Collected

| Data | Collected | Purpose |
|------|-----------|---------|
| Error message | Yes | Identify the issue |
| Stack trace | Yes | Locate the code path |
| OS and architecture | Yes | Reproduce platform-specific bugs |
| App version | Yes | Track regressions per release |
| Navigation breadcrumbs | Yes | Understand user flow leading to error |
| Console errors/warnings | Yes | Context trail (breadcrumbs only) |
| Rust panic message | Yes | Catch fatal crashes |
| Rust `tracing::error!` events | Yes | Backend error reporting |
| Rust `tracing::warn!` events | Yes | Stored as breadcrumbs for context |
| App sessions | Yes | Active user counts per release (Release Health) |
| Feature visits (section + tab) | Yes | Identify popular and underused features |
| Session summary (visited **and** ignored) | Yes | Aggregate usage + features never opened, per session |
| Interaction events (key actions) | Yes | Track adoption of specific workflows |

## What Is Never Collected

| Data | Status | Enforcement |
|------|--------|-------------|
| IP address | Stripped | `before_send` / `beforeSend` |
| Email address | Stripped | `before_send` / `beforeSend` |
| Username | Stripped | `before_send` / `beforeSend` |
| Request bodies | Stripped | `before_send` / `beforeSend` |
| Request headers | Stripped | `beforeSend` |
| Performance traces | Disabled | `traces_sample_rate: 0` |
| Session replay | Disabled | `replaysSessionSampleRate: 0` |
| User identity | Never set | No `Sentry.setUser()` calls |
| Persona content | Never in events | Not included in tracing spans |
| Credentials/API keys | Never in events | Encrypted at rest, never logged |

---

## Privacy Guarantees

1. **`send_default_pii: false`** (Rust) and **`sendDefaultPii: false`** (JS) prevent the SDK from attaching any PII automatically
2. **`before_send`** hooks run on every event before transmission and delete user email, IP, username, and request data
3. **No performance monitoring** means no URL or network request recording
4. **Sentry is not initialized in local dev** — the DSN is only present in CI-built release binaries
5. **Removing `SENTRY_DSN`** from GitHub secrets and rebuilding fully disables all error reporting

---

## DSN and Local Development

The Sentry DSN is a compile-time constant:

- **Rust**: `option_env!("SENTRY_DSN")` — only present when set as env var at `cargo build` time
- **Frontend**: `import.meta.env.VITE_SENTRY_DSN` — only present when set at Vite build time

In local development, neither variable should be set — keep them out of `.env`. As defense in depth, both entry points also hard-gate on build mode:

- **Rust** (`src-tauri/src/main.rs` → `sentry_options()`): `cfg!(debug_assertions)` forces `dsn = None` in debug builds, so even if `SENTRY_DSN` leaked into the shell env at compile time, a `cargo tauri dev` build will never ship events.
- **Frontend** (`src/lib/sentry.ts` → `initSentry()`): `import.meta.env.PROD` gates DSN use, so `vite dev` / non-production modes never initialize with a real DSN.

Only release/installer builds (`cargo tauri build` + `vite build` with `MODE=production`) report.

In CI, the `SENTRY_DSN` GitHub secret is injected as both `SENTRY_DSN` (Rust) and `VITE_SENTRY_DSN` (Vite) in the `release.yml` build step.

---

## Capturing Errors Manually

### In Rust

Use the existing `tracing::error!` macro — the sentry-tracing layer picks it up automatically:

```rust
tracing::error!(error = %e, persona_id = %id, "Execution failed");
```

For direct capture without a tracing event:

```rust
sentry::capture_message("Something unexpected happened", sentry::Level::Error);
```

### In TypeScript / React

For caught errors that should still reach Sentry:

```typescript
import * as Sentry from "@sentry/react";

try {
  await someOperation();
} catch (err) {
  Sentry.captureException(err);
  setError(errMsg(err, "Operation failed"));
}
```

With extra context:

```typescript
Sentry.withScope((scope) => {
  scope.setTag("feature", "persona-runner");
  scope.setExtra("personaId", id);
  Sentry.captureException(err);
});
```

---

## Error Boundary

The React Error Boundary wraps `<App />` in `src/main.tsx`. When an unhandled render error occurs:

1. Sentry captures the error automatically
2. A fallback UI appears: "Something went wrong" with the error message and a "Try again" button
3. Clicking "Try again" resets the error boundary and re-renders `<App />`

The fallback uses the app's CSS custom properties (`--foreground`, `--background`) to match the current theme.

---

## Source Maps

Vite generates hidden source maps (`sourcemap: "hidden"` in `vite.config.ts`). These are:

- **Not exposed** in the browser — users cannot see unminified code in DevTools
- **Uploaded to Sentry** during CI release (if `SENTRY_AUTH_TOKEN` is configured)
- **Used by Sentry** to unminify JavaScript stack traces server-side

Source map upload is optional. Without it, errors are still captured but stack traces show minified function names.

---

## CI Secrets Reference

| Secret | Purpose | Required |
|--------|---------|----------|
| `SENTRY_DSN` | Public ingest key — baked into binaries | Yes |
| `SENTRY_AUTH_TOKEN` | CLI auth for source map upload | Optional |
| `SENTRY_ORG` | Organization slug for CLI | Optional (with AUTH_TOKEN) |
| `SENTRY_PROJECT` | Project slug for CLI | Optional (with AUTH_TOKEN) |

Add these at `github.com/<owner>/<repo>/settings/secrets/actions`.

The DSN is obtained from your Sentry project's Settings > Client Keys. The auth token is created under Settings > Developer Settings > Internal Integrations.

---

## Disabling Sentry

1. Remove `SENTRY_DSN` from GitHub repository secrets
2. Push any commit to trigger a rebuild
3. The new binary and frontend will contain no DSN — Sentry becomes a complete no-op

No code changes are required to disable monitoring.

---

## Key Files

| File | Role |
|------|------|
| `src-tauri/src/main.rs` | Sentry guard initialization, Rust `before_send` PII filter |
| `src-tauri/src/logging.rs` | `sentry-tracing` layer in subscriber registry |
| `src/lib/sentry.ts` | Frontend Sentry init, JS `beforeSend` PII filter, `trackFeature`/`trackInteraction`/`trackSessionSummary` |
| `src/lib/analytics/navCatalog.ts` | Declarative catalog — every sidebar section + tab dimension (source of truth for coverage and "ignored") |
| `src/lib/analytics/sink.ts` | Transport abstraction (`AnalyticsSink`) — default `sentrySink`; swap point for future local-first / product-analytics backends |
| `src/lib/analytics/summary.ts` | Pure `buildSessionSummary` — diffs visited counts against the full catalog |
| `src/lib/analytics/index.ts` | Multi-store Zustand navigation subscriber, session-summary flush, `initAnalytics` |
| `src/main.tsx` | Error Boundary, global error handlers, telemetry-gated analytics bootstrap |
| `vite.config.ts` | Hidden source map generation |
| `.github/workflows/release.yml` | DSN injection + source map upload step |

---

## Release Health (Active Users)

Session tracking is enabled on both Rust and frontend sides. Sentry's Release Health dashboard provides:

- **Active users per release** — how many unique devices are running each version
- **Crash-free session rate** — percentage of sessions that did not encounter an error
- **Adoption curve** — how quickly users update to new releases
- **Session duration** — how long users keep the app open

Sessions use anonymous device IDs generated by the Sentry SDK. No user identity, email, or IP is attached to sessions. The `send_default_pii: false` / `sendDefaultPii: false` setting ensures this.

### Where to view

In Sentry: **Releases** > select a version > **Release Health** tab.

### How it works

- **Rust**: `auto_session_tracking: true` + `session_mode: SessionMode::Application` in `main.rs`. A session starts when `sentry::init()` runs and ends when the app exits (guard drops).
- **Frontend**: `autoSessionTracking: true` in `src/lib/sentry.ts`. The JS SDK tracks page visibility — a session starts on load and ends after inactivity.

Both sides report independently. Sentry deduplicates by device ID, so one app launch = one session in the dashboard.

---

## Feature Usage Tracking

Anonymous feature usage events are sent alongside error events to help identify which features are popular and which are underused. No PII, persona content, or credentials are included — only section and tab name strings.

### Architecture

```
Zustand stores (system + overview, state change)
  └─ analytics/index.ts subscriber  ── driven by navCatalog (full coverage)
       ├─ getAnalyticsSink().feature({ section, tab, action })  ── sink seam
       │    └─ sentrySink → trackFeature(...)
       │         └─ Sentry.captureMessage("feature_visit: overview.executions", "info")
       │              tags: event_type=feature_visit, feature.section=overview, feature.tab=executions
       │
       └─ beforeunload → buildSessionSummary(counts) → sink.session(...)
            extras: { visit.*: n, sections_ignored: "...", tabs_ignored: "...", ... }
```

The **sink** (`analytics/sink.ts`) is the transport seam: instrumentation emits
structured events to the active `AnalyticsSink` rather than calling Sentry
directly. Today the only sink is `sentrySink`; a future local-first SQLite sink
or product-analytics sink can be dropped in via `setAnalyticsSink()` with zero
changes to instrumentation.

### Event Types

| Event | Sentry Tag | When Fired |
|-------|-----------|------------|
| `feature_visit` | `event_type: feature_visit` | User navigates to a section or switches a tab |
| `interaction` | `event_type: interaction` | User performs a key action (create, execute, deploy, etc.) |
| `session_summary` | `event_type: session_summary` | Once on app close — visit counts **plus** the ignored set (`sections_ignored`, `tabs_ignored`) computed against the full catalog |

### Deduplication & Sampling

- **Deduplication**: Identical `feature_visit` events within 5 seconds are suppressed (prevents tab-bouncing noise)
- **Sampling**: Configurable `FEATURE_SAMPLE_RATE` in `sentry.ts` (default 1.0 = 100%). Reduce to lower Sentry quota usage on large install bases

### Sentry Discover Queries

To view feature usage data in Sentry:

1. **Most visited features**: Discover → `event_type:feature_visit` → Group by `feature.section` → Count
2. **Tab usage within a section**: Discover → `event_type:feature_visit AND feature.section:overview` → Group by `feature.tab`
3. **Session depth**: Discover → `event_type:session_summary` → Avg of `visit.*` extras
4. **Feature adoption over time**: Discover → `event_type:feature_visit` → Group by `feature.section`, Time series

### Auto-Tracked Navigation

Coverage is **declarative and complete** — every `SidebarSection` and every
store-backed tab dimension is enumerated in `analytics/navCatalog.ts`, and the
subscriber in `analytics/index.ts` tracks all of them. (This replaced the old
hand-maintained `TAB_SECTION_MAP`, which tracked only 6 of ~16 tab dimensions
and was blind to non-system stores.)

The catalog is the single thing to update when adding a navigable surface:

| Source | Coverage |
|---|---|
| `sidebarSection` (system store) | All 10 sections → `feature_visit: {section}` |
| 12 system-store tab dimensions | `homeTab`, `goalsTab`, `templateTab`, `agentTab`, `editorTab`, `designSubTab`, `cloudTab`, `settingsTab`, `pluginTab`, `devToolsTab`, `eventBusTab`, `researchLabTab` |
| `overviewTab` (overview store) | Attached lazily on first visit to the `overview` section |

Counts are keyed `<dimension>:<value>` (e.g. `editorTab:use-cases`) so dimensions
that share a value within one section never collide. Because the catalog is the
denominator, the session summary reports the **ignored** set — sections and tabs
that were never opened — not just what was visited. Adding a tab to the store and
listing it in the catalog is all that's needed; the `satisfies` guards in
`navCatalog.ts` fail the typecheck if a value drifts from the union in `types.ts`.

### Manual Interaction Tracking

For key actions beyond navigation, use `trackInteraction` from `src/lib/analytics.ts`:

```typescript
import { trackInteraction } from "@/lib/analytics";

// When a persona is created
trackInteraction("persona", "create", "from-template");

// When an execution starts
trackInteraction("execution", "start", personaId ? "manual" : "trigger");

// When a credential is added
trackInteraction("credential", "create", connectorType);
```

These fire `interaction` events in Sentry with `ix.category`, `ix.action`, and `ix.label` tags.

---

## Future Enhancements

- **Store-level capture**: Add `Sentry.captureException` in Zustand store catch blocks to track IPC errors that are currently caught and displayed but not reported
- **Rust file logging**: Activate `tracing-appender` (already in `Cargo.toml`) for local diagnostic log files alongside Sentry
- **User opt-in**: Done — the first-use consent modal has a telemetry checkbox and Settings → Account has a toggle (`telemetryPreference.ts`); `main.tsx` gates Sentry + analytics on `isTelemetryEnabled()`. Follow-up: switch the active sink to `noopSink` on a mid-session toggle-off so usage tracking stops without a restart.
- **Local-first usage sink (Option B)**: Implement an `AnalyticsSink` backed by a SQLite `feature_usage` table + an in-app "used vs ignored" panel, using the catalog as the denominator. The sink seam means no instrumentation changes.
- **Product-analytics sink (Option C)**: Implement an `AnalyticsSink` for a dedicated/self-hosted backend (PostHog/Umami) for cross-install funnels and retention.
- **Supabase hybrid**: Forward critical crash reports to a Supabase `crash_reports` table for self-hosted visibility
