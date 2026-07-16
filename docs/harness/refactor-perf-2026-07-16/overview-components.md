# overview/components — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 2 high / 2 medium / 1 low)
> Context group: Observability & Monitoring | Files read: 30 | Missing: 0

## 1. IPC_FALLBACKS is missing the 'environment' entry — fallback path crashes and the health panel spins forever
- **Severity**: High
- **Lens**: code-refactor
- **Category**: correctness
- **File**: src/features/overview/components/health/useHealthChecks.ts:11-28 (crash at :68 and :40)
- **Scenario**: The Tauri IPC bridge is down (the exact scenario the fallbacks were built for). All six checks reject; for index 1 (`environment`) the code does `IPC_FALLBACKS['environment']!` which is `undefined` because the map only defines local/agents/cloud/account/subscriptions. `sortSections` then reads `a.id` on `undefined` and throws inside the `.then`.
- **Root cause**: `CHECKS` has 6 ids but `IPC_FALLBACKS` has 5; the non-null assertion (`IPC_FALLBACKS[checkId]!`) hides the gap from the type checker.
- **Impact**: `setSections`/`setLoading(false)`/`setIpcError(true)` are never called (only the `.finally` clearing `inFlightRef` runs), so SystemHealthPanel shows skeleton spinners forever and the "IPC unavailable" message — the whole point of the fallback table — never appears.
- **Fix sketch**: Add an `environment` fallback section (mirroring the others), and replace the assertion with a safe default: `IPC_FALLBACKS[checkId] ?? makeFallback(checkId, checkId, [{ id: 'ipc', label: 'Check unavailable', status: 'error', detail: 'IPC unavailable', installable: false }])`. Optionally derive `CHECKS` and `IPC_FALLBACKS` from one array so they can't drift again.

## 2. Half of the health-check IPC calls fetch sections that are never rendered (environment/agents/subscriptions dropped by the 3-stub grid)
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: wasted-queries
- **File**: src/features/overview/components/health/SystemHealthPanel.tsx:86 (with healthPanelConstants.ts:19-23)
- **Scenario**: Every mount, refresh click, auth change, and post-install re-check runs all 6 IPC health checks (`healthCheckEnvironment`, `healthCheckAgents`, `healthCheckSubscriptions` included), but the grid iterates `SKELETON_SECTIONS` which only contains `local`, `cloud`, `account` — so the other three sections are fetched, sorted, and thrown away.
- **Root cause**: `SKELETON_SECTIONS` drifted from `CHECKS`/`SECTION_ORDER` (both list 6 ids) when sections were added; the render loop keys off the stale stub list instead of the fetched sections.
- **Impact**: 3 of 6 backend IPC round-trips are pure waste on a panel that re-runs checks frequently. Worse than the waste: `hasIssues` still counts the invisible sections (a warning banner can appear for an issue the user cannot see), and the Ollama/LiteLLM configure buttons in SectionCard are keyed to `ollama_api_key`/`litellm_proxy` checks that live in the never-rendered `agents` section — so `onShowOllama`/`onShowLiteLLM` are unreachable from this panel. (Verify against the Rust side that these checks weren't re-homed into `local`/`cloud`; the IPC fallback table says they weren't.)
- **Fix sketch**: Either add `environment`/`agents`/`subscriptions` stubs to `SKELETON_SECTIONS` so all fetched sections render, or — if only 3 sections are product-intended — remove the three unused entries from `CHECKS` so the IPC calls stop firing, and restrict `hasIssues` to rendered sections. Deriving the stub list from `CHECKS` (id + label) removes the drift class entirely.

## 3. Dead code: TrendIndicator component has zero importers; SectionCard carries unused `_mcpBusy` state and `stubIdx` prop
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/components/shared/TrendIndicator.tsx:12 (also src/features/overview/components/health/SectionCard.tsx:44, :14)
- **Scenario**: `TrendIndicator` is exported but no file under `src/` imports it (KpiTile builds its own inline trend display; grep over src shows only the definition). `SectionCard` declares `const [_mcpBusy, _setMcpBusy] = useState(false)` that is never read or written — the real busy state lives inside `ClaudeDesktopMcpButton` — and accepts a `stubIdx` prop it immediately discards, which every caller still has to supply.
- **Root cause**: Leftovers from refactors: trend rendering moved into KpiTile, and MCP busy-state moved into the extracted `ClaudeDesktopMcpButton`, without deleting the originals.
- **Impact**: ~44 dead lines plus a phantom hook slot and a phantom prop that mislead readers into thinking they participate in behavior; the unused prop also forces SystemHealthPanel to pass `stubIdx={stubIdx}` for nothing.
- **Fix sketch**: Delete `TrendIndicator.tsx` (after a repo-wide grep including tests/stories to confirm no dynamic use — none found in src). Remove the `_mcpBusy` useState line and drop `stubIdx` from SectionCard's props and from the SystemHealthPanel call site.

## 4. HealingToast triggers a redundant full-list refetch on every healing event, duplicating the selective-refresh subscription
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: duplicate-fetch
- **File**: src/features/overview/components/feedback/HealingToast.tsx:76
- **Scenario**: A critical/high healing event arrives: the `healing-event` listener adds a toast and calls `fetchHealingIssues()` (full list refetch), while the component's other subscription (`subscribeHealingEvents`, per its own doc comment) already selectively re-fetches the affected issue on the paired `healing-issue-updated` event.
- **Root cause**: The full-refresh call predates the selective `healing-issue-updated` subscription and was never removed when the selective path was added — the file's header comment even advertises "selectively re-fetch ... instead of polling the full list".
- **Impact**: Every qualifying healing event costs an extra full-table IPC/SQLite round trip on top of the selective refresh; during a healing burst (retries with backoff emit repeated events) this multiplies into N full-list scans for data the store already updates incrementally.
- **Fix sketch**: Drop the `fetchHealingIssues()` call from the `healing-event` handler and rely on the `healing-issue-updated` subscription for store consistency. If the backend does not emit `healing-issue-updated` for brand-new issues, emit it there (or debounce the full refetch) rather than refetching per toast.

## 5. Overview 'home' route goes through three indirection files with stale "WithSubtabs" names
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/overview/components/dashboard/DashboardWithSubtabs.tsx:8 (also DashboardHome.tsx:1, ExecutionsWithSubtabs.tsx:3)
- **Scenario**: Anyone tracing the home tab reads OverviewPage → lazy `DashboardWithSubtabs` (whose own comment says the subtabs were consolidated away; it only wraps an ErrorBoundary) → `DashboardHome.tsx` (a one-line re-export) → `DashboardHomeMissionControl`. `ExecutionsWithSubtabs` is likewise a subtab-less div around `GlobalExecutionList`.
- **Root cause**: The subtab consolidation kept the old wrapper files as shims instead of updating the OverviewPage imports.
- **Impact**: Three near-empty files with misleading names on the app's main route; the extra static import inside the lazy boundary also adds a pointless module hop to the home chunk. Maintenance cost only — no runtime cost worth noting.
- **Fix sketch**: Point OverviewPage's lazy imports directly at `sub_missionControl/DashboardHomeMissionControl` (wrapping ErrorBoundary at the call site, as it already does for the route) and at `sub_activity/components/GlobalExecutionList` (moving the fade-in div inline), then delete the three shim files. Only OverviewPage imports them, so the change is local.
