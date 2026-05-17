# Perf-walk test suite

Measurement-first perf testing for the Personas desktop app. Replaces audit-time estimates (subagent findings, hot-path guesses) with **real numbers per navigation stop**: render commits, IPC counts, per-command breakdowns, DOM node counts, and timing. The output is a structured JSON report under `docs/harness/perf-runs/` plus a generated Markdown summary.

## How it works

```
┌──────────────────────────┐    HTTP    ┌──────────────────────────┐
│ perf-nav-walk.spec.ts    │ ─────────▶ │ Rust test-automation     │
│ (Playwright runner)      │            │ HTTP server (port 17320) │
└──────────────────────────┘            └──────────────────────────┘
                                                     │
                                                     │ webview.eval()
                                                     ▼
                                          ┌──────────────────────────┐
                                          │ window.__TEST__ bridge   │ ← bridge.ts
                                          │ window.__PERF__          │ ← perfInstrument.ts
                                          └──────────────────────────┘
                                                     │
                                                     ▼
                                          ┌──────────────────────────┐
                                          │ Patched core::invoke     │ ← counts IPC
                                          │ Root <Profiler>          │ ← counts renders
                                          └──────────────────────────┘
```

Two instrumentation hooks live in the app, loaded only in test mode:

1. **`src/test/automation/perfInstrument.ts`** patches `window.__TAURI_INTERNALS__.invoke` to count + time every Tauri command (catches all import paths) and exposes `window.__PERF__.{reset, snapshot, mark}`. Idempotent across HMR.

2. **Root `<Profiler>` in `src/App.tsx`** forwards every React commit to `__PERF__.recordRender(...)`. The lookup is a single object access when `__PERF__` is absent (production) — no measurable cost.

The Rust side adds three endpoints in `src-tauri/src/test_automation.rs`:

- `POST /perf/reset` → zeroes counters for the next measurement window
- `GET  /perf/snapshot` → returns the structured `PerfSnapshot` JSON
- `POST /perf/mark` (`{ label }`) → emits a phase marker into the current window

The spec drives reset → navigate → wait-for-idle → snapshot per stop and writes the cumulative report.

## Running

### 1. Start the app with test automation enabled

```pwsh
npm run tauri:dev:test
```

This compiles the Tauri binary with `--features test-automation`, which binds the HTTP server to `127.0.0.1:17320`. To target a production install, run it with `PERSONAS_TEST_PORT=17321` and point Playwright at it via `COMPANION_TEST_PORT=17321`.

### 2. Run the perf walk

```pwsh
npx playwright test tests/playwright/perf-nav-walk.spec.ts
```

The spec walks every entry in the `STOPS` array (currently ~35 stops covering L1 sections + plugin tabs + settings tabs + twin/artist sub-tabs), captures metrics per stop, and writes:

```
docs/harness/perf-runs/<ISO-timestamp>.json
```

### 3. Render a report

```pwsh
# Markdown summary of the latest run to stdout
node scripts/perf/render-perf-report.mjs

# With diff against the previous run
node scripts/perf/render-perf-report.mjs --diff

# Specific run
node scripts/perf/render-perf-report.mjs --file docs/harness/perf-runs/2026-05-17T12-34-56-789Z.json

# Write to a file
node scripts/perf/render-perf-report.mjs --diff --output docs/harness/perf-runs/latest.md
```

The report includes:

- **Run totals** — sum of renders, IPC calls, and render time across all stops, with delta vs. previous run if `--diff`.
- **Top 15 stops by render-commit count** — where React is doing the most work.
- **Top 15 stops by IPC call count** — where the app is chattiest with the backend.
- **Top 15 stops by render actual ms** — where committed time is highest.
- **Top 10 IPC commands across all stops** — globally hottest backend commands.
- **Per-stop table** in walk order (with success/error and Δs).

## Adding stops

`tests/playwright/perf-nav-walk.spec.ts` has a `STOPS` array near the top. Each entry has:

```ts
{
  id: 'overview/analytics',        // unique key (forward-slash separates groups)
  group: 'overview',                // grouping for the report
  description: 'Overview → Analytics tab',
  setup: async () => {
    await navigate('overview');
    await bridgeExec('setOverviewTab', { tab: 'analytics' });
  },
}
```

The framework handles the rest — reset, wait-for-idle, snapshot, persist. For stops the existing bridge doesn't have a setter for, use `clickTestId` via the bridge or extend `bridge.ts` with a new method.

Stops that fail (e.g. plugin disabled in starter tier) are recorded with `setupError` rather than failing the suite. L1 stops are required to succeed; the spec fails if any L1 stop errors.

## Interpreting metrics

| Metric | What it measures | What a high value suggests |
|---|---|---|
| **render.commitCount** | React commit count during the measurement window | Cascading re-renders from a hot store, animation churn, unstable selectors |
| **render.totalActualDurationMs** | Sum of `actualDuration` across commits — *time React spent rendering* | Heavy component subtree on this stop |
| **render.totalBaseDurationMs** | Sum of `baseDuration` — *estimated cost without memoization* | Memoization headroom (compare actual vs base) |
| **ipc.totalCount** | Number of Tauri commands invoked during the window | Chatty pages: duplicate fetches, missing dedup, polling cascades |
| **ipc.totalDurationMs** | Sum of IPC awaited time | Backend slowness OR over-fetching |
| **ipc.byCommand** | Per-command breakdown (count + total + avg) | Specific commands to deduplicate / batch / cache |
| **dom.nodeCount** | `document.querySelectorAll('*').length` | Unvirtualized lists, oversized tree |

## Iteration model

Run the perf walk:

1. **Before** starting a fix wave to baseline the affected surface.
2. **After** the wave to see the delta.
3. **Periodically** (weekly?) to catch silent regressions.

The JSON files are tracked in git, so PRs touching a perf-sensitive area can show before/after numbers without anyone having to rerun the baseline.

**Don't aim to fix everything at the top of the renders list** — first ask:
- Is this stop one users actually visit?
- Is the absolute number user-perceivable jank, or theoretical waste?

The right targets are stops where (a) the metric is genuinely high, (b) users land on the surface frequently, and (c) the cost scales with data the user controls (event volume, list size, persona count).

## Limitations

- **One `<Profiler>` at root** captures totals only — you can see "this stop did 142 commits" but not "in 142 commits, ChartTooltip rendered 100 times". For per-component breakdown, add component-level Profilers locally for the investigation (Wave 2's Realtime fixes used this approach informally).
- **Wait-for-idle uses a 600ms IPC stability window.** Stops that emit periodic background IPC (telemetry pollers, websocket heartbeats) may register stable values rather than zero — that's a real cost reading, not a measurement bug.
- **The instrumentation runs in test mode only**, gated on `import.meta.env.DEV || window.__PERSONAS_TEST_MODE__`. Production builds carry the root Profiler (negligible cost) but skip patching `__TAURI_INTERNALS__` and never instantiate `__PERF__`.
- **Browser-only paths (fetch, XHR) are not instrumented.** Personas is overwhelmingly Tauri-IPC-driven, so this is acceptable. If a feature starts using `fetch()` heavily, add a wrapper in `perfInstrument.ts`.

## Future work

- **Per-feature Profilers** for high-cost stops where root-only is too coarse.
- **CI integration** — run the walk on every PR touching `src/`, attach the diff report to the PR.
- **Network HAR** for the few stops that hit external HTTP (OAuth gateways, model providers) — Tauri webview supports this via CDP, not yet wired.
- **Compare-three-runs view** — current vs. last-baseline vs. main-branch — to distinguish "this PR regressed" from "main has been drifting".
