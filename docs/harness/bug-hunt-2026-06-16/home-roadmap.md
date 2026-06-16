# Bug Hunter — Home & Roadmap

> Total: 5 findings (0 critical, 2 high, 3 medium, 0 low)
> Context: home-roadmap | Group: Onboarding, Home & Settings

## 1. Fleet health strip mounts once, never refreshes, and writes state after unmount
- **Severity**: High
- **Category**: Race condition / latent failure (stale state + unmount-write)
- **File**: `src/features/home/sub_welcome/FleetHealthStrip.tsx:24-48`
- **Scenario**: `useFleetMetrics` runs `load()` exactly once on mount (`useEffect(() => { load(); }, [load])`, `load` has an empty dep array so it is stable). There is no interval, no event subscription, and no refetch trigger. A user opens Home, runs several executions elsewhere, then returns to Home — the strip still shows "executions today: 0", "success rate 100%", "active agents 0". Separately, `setMetrics(...)` fires after `await Promise.all([...])` with **no `mounted` guard** (unlike the sibling `useLiveRoadmap`, which keeps a `mounted` ref). React 18 StrictMode double-mounts the component, and fast Home-tab switching (`HomePage` uses `key={homeTab}`, forcing a full remount on every tab change) can unmount the strip mid-`await`.
- **Root cause**: Fire-once data fetch with no liveness/refresh strategy and no unmount cancellation. The two metric sources (`getMetricsSummary(1)`, `listCredentials()`) are point-in-time reads cached only in component state.
- **Impact**: The home dashboard's headline health signal is silently stale for the entire session — including the red failure-spike pulse, which will not appear if the spike begins after the strip mounted. Plus a "Can't perform a React state update on an unmounted component" warning (and a wasted render) on every StrictMode mount and rapid tab switch.
- **Fix sketch**: Add a `mounted` ref guard around `setMetrics` (mirror `useLiveRoadmap`). Re-run `load()` on a visibility/focus trigger or subscribe to the execution event bus so the strip reflects new runs without a manual remount. At minimum, re-fetch when the Home tab regains focus.

## 2. "Active agents" pill shows agents that executed today, not agents that are active
- **Severity**: High
- **Category**: Silent failure (success theater / wrong number)
- **File**: `src/features/home/sub_welcome/FleetHealthStrip.tsx:38` + `src-tauri/src/db/repos/execution/metrics.rs:427`
- **Scenario**: The pill is labelled `fleet.active_agents` and bound to `summary.activePersonas`. The backend computes that field as `COUNT(DISTINCT persona_id) FROM persona_executions WHERE created_at >= datetime('now','-1 days')` (the strip passes `getMetricsSummary(1)`). So a fleet of 12 enabled personas that simply hasn't run anything in the last 24h reports **"0 active agents"** on the welcome screen. Conversely, deleting a persona that ran earlier today still counts it.
- **Root cause**: Semantic mismatch — `active_personas` means "personas with executions in the window", but the Home strip presents it as the count of currently-active/enabled agents. The 1-day window makes the divergence routine, not an edge case.
- **Impact**: First thing a returning user sees is "0 active agents", implying their fleet is gone/broken. Misleads onboarding and erodes trust in every other number on the strip. The pill also routes to `personas` on click, where the user will see a full list — directly contradicting the "0" they were just shown.
- **Fix sketch**: Either relabel the pill to "agents run today" / widen the window, or back the pill with an actual enabled-persona count (`COUNT(*) FROM personas WHERE enabled = 1`) so the label matches the data.

## 3. Roadmap fetched once on mount with a 1-hour disk TTL — no live polling
- **Severity**: Medium
- **Category**: Latent failure (roadmap never updating without user action)
- **File**: `src/features/home/sub_releases/useLiveRoadmap.ts:66-68` + `src-tauri/src/commands/live_roadmap.rs:45,177-186`
- **Scenario**: `useLiveRoadmap` calls `run(false)` once on mount. The Rust command short-circuits to the disk cache for `CACHE_TTL = 1h` whenever `force=false`. The only other refresh path is the manual `RefreshCw` button in `LiveRoadmapStatusPill`. A user who keeps the app open and sits on the roadmap tab will see cached content for at least an hour (longer if they never remount the view), with the status pill confidently reporting "cached · 4 minutes ago" — a healthy amber state, not a warning. The "Live" framing of the feature implies updates arrive on their own; they don't.
- **Root cause**: No background revalidation timer or app-focus refetch; freshness is entirely demand-driven, and the demand only occurs on component mount.
- **Impact**: The "live" roadmap is effectively a manual-refresh roadmap. Content the developer pushed to `personas.so/roadmap/v1.json` is invisible to long-running sessions until the user happens to remount the view or clicks refresh. Low blast radius (informational content) but contradicts the documented intent.
- **Fix sketch**: Add a lightweight interval (e.g. re-run `run(false)` every TTL, letting the Rust cache decide) or refetch on window focus / when the roadmap tab is re-selected. Cheap, since the Rust layer already gates the actual network call.

## 4. Empty fleet renders a confident green "100%" success rate
- **Severity**: Medium
- **Category**: Edge case / silent failure (misleading default on zero data)
- **File**: `src/features/home/sub_welcome/FleetHealthStrip.tsx:31-33`
- **Scenario**: When `summary.totalExecutions === 0`, the success-rate calculation deliberately returns `100` (the `: 100` branch). So a brand-new install, or any day with zero executions, shows a green `CheckCircle2` pill reading "100%". `hasFailureSpike` also returns false at `total < 3`, so the pill stays green.
- **Root cause**: A "no data" state is collapsed into a "perfect health" value rather than rendered as a distinct empty/neutral state. Division-by-zero itself is correctly guarded — the bug is the chosen sentinel.
- **Impact**: Success theater. A fleet that has executed nothing (possibly because every execution is failing to even start, or the user hasn't onboarded) is painted as 100% healthy emerald. The signal is most misleading exactly when the user most needs an accurate empty/neutral cue — first-run onboarding.
- **Fix sketch**: When `totalExecutions === 0`, render a neutral state ("—" / "no runs yet" with a muted dot) instead of green "100%". Keep the 100% only for `totalExecutions > 0 && failed === 0`.

## 5. Roadmap status pill clamps future timestamps but the green "fresh" dot can still misrepresent a clock-skewed cache
- **Severity**: Medium
- **Category**: Edge case / trust boundary (untrusted timestamp from disk cache)
- **File**: `src/features/home/sub_releases/LiveRoadmapStatusPill.tsx:30-40` + `src-tauri/src/commands/live_roadmap.rs:237-241`
- **Scenario**: `formatRelative` clamps `diffSec` to `<= 0` so a future `fetchedAt` degrades to "just now" instead of "in 4 minutes" — good. But the degraded `stale` path in Rust returns `fetched_at: c.cached_at.to_rfc3339()` (the *original* cache time), while the pill's color/label logic keys off `status` only. On a machine whose clock was rolled back (NTP correction, VM resume, manual change), a genuinely old stale payload can render as "stale · just now": the red dot says degraded, but the relative time says it was fetched moments ago, so the user reads it as recent. The two halves of the pill disagree.
- **Root cause**: `fetched_at` for the `stale` source is the cache write time, not the (failed) fetch attempt time, and the relative-time clamp masks backward skew rather than flagging it. The pill trusts a disk-persisted timestamp that survives across machines and clock changes.
- **Impact**: A user reading hours-old roadmap content during an outage may see "stale · just now" and conclude the content is current. Low severity (informational surface), but it defeats the explicitly-designed warning the `stale` state exists to convey.
- **Fix sketch**: When `Date.parse(iso) > Date.now()` by a meaningful margin, render an explicit "clock skew / time unknown" label rather than silently clamping to "just now". Alternatively have the `stale` path omit/neutralize the relative time entirely so the red dot stands alone.
