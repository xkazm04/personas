# Analytics, SLA & Usage — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 0, Medium: 3, Low: 2)

Note on context-map drift: `src/features/overview/sub_usage/charts/ChartTooltip.tsx` actually lives at `src/features/overview/sub_usage/components/ChartTooltip.tsx`, and `src/features/overview/sub_leaderboard/components/DetailPanel.tsx` does not exist (the leaderboard folder has EmptyStates/ScoreRadar/LeaderboardPage/LeaderboardMatrixView only).

## 1. Cost-preview pricing table misprices modern model IDs by 10–17x
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/cost.rs:15-60
- **Scenario**: A user opens the execution preview for a persona configured with `gemini-1.5-pro` or `gemini-2.5-pro`. The substring chain checks `contains("gemini-pro")` (which only matches the legacy bare `gemini-pro` id) before falling through to `contains("gemini")` — so a Pro-class model is priced at the Flash rate ($0.075/M in, $0.30/M out), ~17x under its ~$1.25/$5 list price. Symmetrically, `gpt-4.1` / `gpt-4-turbo` / `gpt-4.1-mini` all hit the `contains("gpt-4")` branch and get legacy GPT-4 pricing ($30/$60) — up to 15x OVER for gpt-4.1-mini. `claude-3-5-haiku` gets the old Haiku 3 rate ($0.25/$1.25 vs $0.80/$4).
- **Root cause**: Family matching by unordered substring assumes vendor IDs stay flat ("opus", "gpt-4", "gemini-pro"); real IDs embed versions/tiers between the family tokens (`gemini-1.5-pro`), so the specific branch never fires and the generic branch wins with the wrong tier's price.
- **Impact**: `build_preview` (surfaced via the execution-preview command, executions.rs:868) shows estimated costs next to `monthly_spend`/`budget_limit`; a user doing a budget sanity-check sees a Pro-model run as ~free or a mini-model run as prohibitively expensive, and makes model/budget decisions on numbers that are off by an order of magnitude.
- **Fix sketch**: Match tier tokens independently of position (e.g. lowercase id, then check `contains("gemini") && contains("pro")`, `contains("flash")`, `contains("gpt-4.1")` before `gpt-4`, `haiku-3-5`/`3-5-haiku`), or switch to a longest-prefix table keyed on normalized IDs; add a unit test with current real IDs.

## 2. Rotation countdowns and "expiring soon"/"due now" states are frozen at render time
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx:78-96,122,205-225
- **Scenario**: A user leaves the overview dashboard open in the Tauri desktop app (a normal long-lived monitoring posture). A credential's `next_rotation_at` passes 3 hours later. The row still shows the countdown computed at last render ("0d 3h"), never flips to the amber "due now" state or the amber gutter accent, and the header's "expiring soon" pill count stays stale — until some unrelated store write happens to re-render the panel.
- **Root cause**: `countdownParts()` and `summaryStats()` read `Date.now()` during render, and `stats` is memoized solely on `[rotationOverviewList]`; there is no time-based invalidation (no interval tick, and `fetchAllRotationStatuses` only runs when `credentials.length` changes). The component is `memo`-wrapped, compounding the freeze.
- **Impact**: The panel's core promise — telling you a rotation is due — silently lags by hours/days on an idle dashboard; a credential can breach its rotation deadline while the UI shows a healthy green countdown.
- **Fix sketch**: Add a coarse clock tick (e.g. `useState` bumped by a 60s `setInterval`, cleaned up on unmount) and include it in the `summaryStats` memo deps and countdown computation; optionally re-fetch statuses on the same tick when any item is within an hour of due.

## 3. SLA dashboard: window label disagrees with displayed data, and there is no loading indicator at all
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_sla/components/SLADashboard.tsx:53,112-120
- **Scenario**: (a) First visit: while the initial fetch runs, `body` is literally `null` — the content area is blank, no skeleton or spinner. (b) User on the 30d view clicks "90d": the section header immediately re-renders as "Daily success rate (90 days)" and the latency card tooltip says "last 90 days" (both interpolate the un-debounced `days`), while every number and bar below is still the 30-day dataset for at least 300ms debounce + fetch time — with zero pending indication. On a slow query the user reads 30d figures under a 90d label.
- **Root cause**: `body` renders from `data` (fetched for `debouncedDays`) but labels from `days`; the loading flag is only used to suppress the very first paint (`loading && !data → null`), never to communicate progress or dim stale content.
- **Impact**: Mislabeled metrics during every range switch (an SLA dashboard's numbers must be trustworthy against their stated window), plus a blank flash on entry; a failed first fetch decays into a permanent "no data" info banner (the toast is transient), reading as "your fleet has no SLA data" rather than "load failed, retry".
- **Fix sketch**: Render labels from the same value the data was fetched with (carry `days` inside the fetched state, or label with `debouncedDays`); show a skeleton on first load and an opacity/spinner overlay while `loading && data`; keep an `error` state that renders a retry banner distinct from `no_data`.

## 4. Heatmap tooltip strands at stale coordinates when the grid or page scrolls
- **Severity**: Low
- **Category**: ui
- **File**: src/features/overview/sub_analytics/components/ExecutionHeatmap.tsx:186,279-282,444-466
- **Scenario**: User hovers a day cell (tooltip appears above it), then scrolls — either the heatmap's own `overflow-x-auto` strip via trackpad/shift-wheel, or the page vertically. `mouseleave` does not fire on scroll and the tooltip's `fixed` position was captured once from `getBoundingClientRect()` at mouseenter, so the glass tooltip stays floating at the old viewport coordinates, now detached from its cell and overlapping unrelated content until the pointer crosses another cell boundary.
- **Root cause**: The imperative portal tooltip assumes the anchor rect is immutable for the hover's lifetime; scrolling invalidates viewport-relative rects without generating any of the events the component listens to.
- **Impact**: A visibly orphaned tooltip over the wrong day/content — precisely the polish regression the cell-anchored redesign (per the in-code comment) was meant to eliminate; misleading if the user reads the stranded value against the cell now under it.
- **Fix sketch**: While `hover` is set, attach a capture-phase `scroll` (and `resize`) listener on `window` that clears the hover state (simplest), or re-derive the rect from the hovered cell element on scroll; remove the listener on hover end.

## 5. Rotation panel's visibility gate is inverted: hidden exactly when its empty-state CTA would help
- **Severity**: Low
- **Category**: ui
- **File**: src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx:143-144,191-200
- **Scenario**: A user with several credentials but no rotation policies configured (the exact audience for this feature) opens the analytics dashboard: the panel returns `null` and the rotation feature is undiscoverable from here. Conversely, a fresh install with zero credentials — the only case where `rotationOverviewList.length === 0 && credentials.length > 0` is false while the list is empty — is the sole state that renders the "No rotation policies configured" empty state and hint, advice the user cannot act on because there is nothing to rotate yet (and the selector guarantees the inner empty state is unreachable in any other case).
- **Root cause**: The early-return guard treats "has credentials, none with policies" as the hide case and "no credentials at all" as the show case; the empty-state branch below assumes it can be reached with credentials present, but `useRotationOverviewList` (statuses keyed off existing credentials) makes that impossible.
- **Impact**: Zero discoverability of credential rotation for the users who need the nudge, plus a nonsensical prompt for brand-new installs; the carefully written empty-state copy is effectively dead in its intended case.
- **Fix sketch**: Invert the gate: return `null` when `credentials.length === 0`, and render the empty state (with the "Manage all" CTA) when credentials exist but `rotationOverviewList` is empty.
